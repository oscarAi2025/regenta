// Lectura (sin red) del HTML de alertas del INVIMA: funciones puras, probadas en tests/invima.test.mjs.
export const BASE = "https://www.invima.gov.co";
const PALABRAS_VACIAS = new Set(["falsificacion", "falsificado", "fraudulento", "producto", "productos", "alerta", "tabletas", "tableta", "recubiertas",
  "capsulas", "capsula", "solucion", "inyectable", "suspension", "jarabe", "crema", "comprimidos", "grageas", "polvo", "oral", "orales", "lote", "lotes",
  "riesgo", "asociado", "asociada", "uso", "con", "del", "los", "las", "para", "por", "sin", "registro", "sanitario", "comercializacion", "venta", "ilegal"]);

const sinTildes = (t: string) => t.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/** Registros sanitarios de medicamentos en un texto, normalizados («INVIMA 2020M-003171-R4»). */
export function registros(texto: string) {
  const r = new Set<string>();
  for (const m of texto.matchAll(/INVIMA\s*(\d{4})\s*M\s*-\s*(\d{3,8})(?:\s*-\s*R\s*(\d+))?/gi)) r.add(`INVIMA ${m[1]}M-${m[2]}${m[3] ? `-R${m[3]}` : ""}`);
  return [...r];
}

/** Lotes nombrados en un texto: «LOTE F0537A», «lotes A123, B456 y C789», «Lote(s) / Serial(es): X1» (rótulo del PDF). */
export function lotes(texto: string) {
  const r = new Set<string>();
  for (const m of texto.matchAll(/\blotes?(?:\s*\(s\))?(?:\s*\/\s*serial(?:\(es\)|es)?)?\s*(?:n[°o.º]*\s*)?:?\s*((?:[A-Z0-9][A-Z0-9/-]{2,}(?:\s*(?:,|y|e)\s*)?)+)/gi)) {
    for (const x of m[1].split(/\s*(?:,|\by\b|\be\b)\s*/i)) {
      const l = x.trim().toUpperCase();
      if (l.length >= 3 && /\d/.test(l) && !/^\d{1,2}\/\d{2}$/.test(l)) r.add(l);
    }
  }
  return [...r];
}

/** Palabras clave del producto alertado (las dos primeras significativas del título), para cruzar por nombre. */
export function palabras(titulo: string) {
  const limpio = sinTildes(titulo).replace(/[®™©]/g, " ").replace(/\blotes?\b.*$/, " ");
  return limpio.split(/[^a-z0-9]+/).filter((w) => w.length >= 5 && !PALABRAS_VACIAS.has(w) && !/^\d+$/.test(w)).slice(0, 2);
}

const texto = (html: string) => html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, " ").replace(/<br\s*\/?>|<\/(p|div|li|tr|h\d|td|th)>/gi, "\n")
  .replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/&#39;|&apos;/g, "'").replace(/&quot;/g, '"').replace(/[ \t]+/g, " ").replace(/\n\s*\n+/g, "\n").trim();

export type ItemListado = { numero: string; titulo: string; tipo: "alerta" | "informe"; fecha: string; motivo: string | null; url: string; pdf: string | null; medicamentos: boolean };

/** Elementos del listado: cada uno trae número NNN-AAAA, título enlazado a /alertas-sanitarias/<slug>, tipo, fecha y PDF. */
export function parsearListado(html: string): ItemListado[] {
  const out: ItemListado[] = [];
  const enlaces = [...html.matchAll(/<a[^>]+href="((?:https:\/\/www\.invima\.gov\.co)?\/alertas-sanitarias\/(?!page\/|\d+\/pdf)[a-z0-9][^"?#]*)"[^>]*>([\s\S]*?)<\/a>/gi)];
  for (let i = 0; i < enlaces.length; i++) {
    const ini = enlaces[i].index!, fin = i + 1 < enlaces.length ? enlaces[i + 1].index! : html.length;
    const antes = texto(html.slice(Math.max(0, ini - 600), ini)), despues = texto(html.slice(ini, Math.min(fin, ini + 1500)));
    const numero = [...antes.matchAll(/\b(\d{1,4}-20\d{2})\b/g)].pop()?.[1];
    const fecha = despues.match(/\b(\d{2})-(\d{2})-(20\d{2})\b/);
    const titulo = texto(enlaces[i][2]);
    if (!numero || !fecha || !titulo) continue;
    const pdf = html.slice(ini, fin).match(/href="([^"]*\/alertas-sanitarias\/\d+\/pdf)"/i)?.[1];
    const motivo = despues.match(/\d{2}-\d{2}-20\d{2}\s*[·•|-]\s*([^\n]+)/)?.[1]?.trim() ?? null;
    out.push({
      numero, titulo, fecha: `${fecha[3]}-${fecha[2]}-${fecha[1]}`, motivo,
      tipo: /informe de seguridad/i.test(despues) ? "informe" : "alerta",
      url: new URL(enlaces[i][1], BASE).toString(), pdf: pdf ? new URL(pdf, BASE).toString() : null,
      medicamentos: /medicamento|biol[oó]gic/i.test(antes.slice(-300)),
    });
  }
  return out.filter((x, i, a) => a.findIndex((y) => y.numero === x.numero) === i);
}

/** Del detalle: registros, lotes y si es de la dirección de medicamentos. */
export function parsearDetalle(html: string) {
  const t = texto(html);
  const direccion = t.match(/Direcci[oó]n\s*\n?\s*(Direcci[oó]n de [^\n]+)/i)?.[1] ?? "";
  return { registros: registros(t), lotes: lotes(t), medicamentos: /medicamentos/i.test(direccion) || (!direccion && /medicamento/i.test(t)) };
}

