import "server-only";
import { sinRLS } from "./db";
import { BASE, palabras, parsearDetalle, parsearListado, registros, lotes, type ItemListado } from "./invima-parse";

// Lectura de las alertas sanitarias publicadas por el INVIMA (https://www.invima.gov.co/alertas-sanitarias).
// No hay API ni RSS: se lee el listado HTML y el detalle de cada alerta nueva. Todo lo que se extrae se guarda
// junto al enlace oficial; la droguería siempre puede abrir la alerta original.

async function traer(url: string) {
  const r = await fetch(url, { headers: { "user-agent": "Regenta/1.0 (+alertas sanitarias para droguerias)" }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`INVIMA respondió ${r.status} en ${url}`);
  return r.text();
}

/** Trae las alertas nuevas de medicamentos de las primeras páginas del listado y las guarda. Devuelve cuántas guardó. */
export async function sincronizarInvima(paginas = 3) {
  const conocidas = new Set((await sinRLS((c) => c.query(`select numero from alertas_invima`))).rows.map((r) => r.numero as string));
  const nuevas: (ItemListado & { registros: string[]; lotes: string[] })[] = [];
  for (let p = 1; p <= paginas; p++) {
    const items = parsearListado(await traer(`${BASE}/alertas-sanitarias${p > 1 ? `/page/${p}` : ""}?direccion=dm`));
    if (!items.length) break;
    for (const it of items) {
      if (conocidas.has(it.numero)) continue;
      const d = parsearDetalle(await traer(it.url));
      if (!d.medicamentos && !it.medicamentos) continue;
      nuevas.push({ ...it, registros: [...new Set([...registros(it.titulo), ...d.registros])], lotes: [...new Set([...lotes(it.titulo), ...d.lotes])] });
    }
  }
  for (const a of nuevas) {
    await sinRLS((c) => c.query(`insert into alertas_invima (numero, tipo, titulo, motivo, fecha, url, pdf, registros, lotes, palabras) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict (numero) do nothing`,
      [a.numero, a.tipo, a.titulo, a.motivo, a.fecha, a.url, a.pdf, a.registros, a.lotes, a.tipo === "alerta" ? palabras(a.titulo) : []]));
  }
  return nuevas.length;
}
