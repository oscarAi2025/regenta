import "server-only";
import type { Tx } from "./db";
import type { FilaGasto } from "./gastos";
import { CATEGORIA_IDS } from "./gastos";
import { fechaValida } from "./reportes";

export type FiltroGastos = { desde?: string; hasta?: string; categoria?: string; estado?: "vigentes" | "anulados" | ""; q?: string };

/** Lee los filtros de la dirección (los que no son válidos se ignoran). */
export function filtroGastos(sp: URLSearchParams | Record<string, string | undefined>): Required<FiltroGastos> {
  const g = (k: string) => (sp instanceof URLSearchParams ? sp.get(k) : sp[k]) ?? "";
  const cat = g("categoria");
  const est = g("estado");
  return {
    desde: fechaValida(g("desde")) ? g("desde") : "", hasta: fechaValida(g("hasta")) ? g("hasta") : "",
    categoria: (CATEGORIA_IDS as readonly string[]).includes(cat) ? cat : "",
    estado: est === "vigentes" || est === "anulados" ? est : "", q: g("q").trim().slice(0, 60),
  };
}

/** Gastos de la droguería con filtros (más recientes primero, hasta 1.000). */
export async function listaGastos(c: Tx, empresa: string, f: FiltroGastos): Promise<FilaGasto[]> {
  const w = ["g.empresa_id = $1"], p: unknown[] = [empresa];
  if (f.desde) { p.push(f.desde); w.push(`g.fecha >= $${p.length}::date`); }
  if (f.hasta) { p.push(f.hasta); w.push(`g.fecha <= $${p.length}::date`); }
  if (f.categoria) { p.push(f.categoria); w.push(`g.categoria = $${p.length}`); }
  if (f.estado === "vigentes") w.push("not g.anulado");
  if (f.estado === "anulados") w.push("g.anulado");
  if (f.q) { p.push(`%${f.q.replace(/[\\%_]/g, (m) => "\\" + m)}%`); w.push(`(g.descripcion ilike $${p.length} or g.referencia ilike $${p.length} or ('G-' || g.numero) ilike $${p.length})`); }
  return (await c.query(`select g.id, g.numero, g.fecha::text fecha, g.categoria, g.descripcion, g.medio, g.valor::float valor, g.referencia, cj.nombre caja,
      g.anulado, g.motivo, m.nombre usuario, ma.nombre anula, to_char(g.creado at time zone 'America/Bogota', 'DD/MM/YYYY HH24:MI') creado
    from gastos g left join cajas cj on cj.id = g.caja_id
    left join miembros m on m.empresa_id = g.empresa_id and m.user_id = g.usuario_id
    left join miembros ma on ma.empresa_id = g.empresa_id and ma.user_id = g.anula_usuario
    where ${w.join(" and ")} order by g.fecha desc, g.numero desc limit 1000`, p)).rows as FilaGasto[];
}
