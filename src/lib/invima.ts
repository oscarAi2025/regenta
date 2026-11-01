import "server-only";
import { sinRLS } from "./db";
import { BASE, palabras, parsearDetalle, parsearListado, registros, lotes } from "./invima-parse";

// Lectura de las alertas sanitarias publicadas por el INVIMA (https://www.invima.gov.co/alertas-sanitarias).
// No hay API ni RSS: se lee el listado HTML y el detalle de cada alerta nueva. Todo lo que se extrae se guarda
// junto al enlace oficial; la droguería siempre puede abrir la alerta original.

async function traer(url: string) {
  const r = await fetch(url, { headers: { "user-agent": "Regenta/1.0 (+alertas sanitarias para droguerias)" }, signal: AbortSignal.timeout(20000) });
  if (!r.ok) throw new Error(`INVIMA respondió ${r.status} en ${url}`);
  return r.text();
}

/** Trae las alertas nuevas de medicamentos de las primeras páginas del listado y las guarda una por una
 *  (si falla una, las demás quedan guardadas). Las que no son de medicamentos se anotan para no volver a descargarlas. */
export async function sincronizarInvima(paginas = 3) {
  const conocidas = new Set((await sinRLS((c) => c.query(`select numero from alertas_invima union select numero from invima_descartadas`))).rows.map((r) => r.numero as string));
  let nuevas = 0;
  const errores: string[] = [];
  for (let p = 1; p <= paginas; p++) {
    const items = parsearListado(await traer(`${BASE}/alertas-sanitarias${p > 1 ? `/page/${p}` : ""}?direccion=dm`));
    if (!items.length) break;
    for (const it of items) {
      if (conocidas.has(it.numero)) continue;
      try {
        const d = parsearDetalle(await traer(it.url));
        if (!d.medicamentos && !it.medicamentos) {
          await sinRLS((c) => c.query(`insert into invima_descartadas (numero) values ($1) on conflict do nothing`, [it.numero]));
          continue;
        }
        const regs = [...new Set([...registros(it.titulo), ...d.registros])], ls = [...new Set([...lotes(it.titulo), ...d.lotes])];
        await sinRLS((c) => c.query(`insert into alertas_invima (numero, tipo, titulo, motivo, fecha, url, pdf, registros, lotes, palabras) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) on conflict (numero) do nothing`,
          [it.numero, it.tipo, it.titulo, it.motivo, it.fecha, it.url, it.pdf, regs, ls, it.tipo === "alerta" ? palabras(it.titulo) : []]));
        nuevas++;
      } catch (e) { errores.push(`${it.numero}: ${(e as Error).message}`); }
    }
  }
  return { nuevas, errores };
}
