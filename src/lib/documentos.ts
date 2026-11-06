import "server-only";
import type { Tx } from "./db";
import { sinComodines } from "./db";
import { rango, type Rango } from "./reportes";

// Documentos electrónicos ante la DIAN de una droguería (tiquetes POS, facturas y notas crédito): filtros comunes a la
// pantalla /documentos y a su exportación CSV. Las fechas son de Bogotá; el rango nunca pasa de 366 días.

export const TIPOS = { pos: "Tiquete POS", factura: "Factura", nc_anulacion: "Nota crédito · anulación", nc_devolucion: "Nota crédito · devolución" } as const;
export const ESTADOS = { aceptado: "Aceptado", simulado: "Simulado", pendiente: "Enviando", rechazado: "Rechazado", anulado: "No emitido" } as const;
export type TipoDoc = keyof typeof TIPOS;
export type EstadoDoc = keyof typeof ESTADOS;
export const POR_PAGINA = 50;

export type Filtro = Rango & { tipo: TipoDoc | null; estado: EstadoDoc | null; q: string; pagina: number };

/** Lee los filtros de la URL; lo que no es válido se ignora (nunca rompe la pantalla). */
export function leerFiltro(sp: Record<string, string | undefined>): Filtro {
  const tipo = sp.tipo && sp.tipo in TIPOS ? (sp.tipo as TipoDoc) : null;
  const estado = sp.estado && sp.estado in ESTADOS ? (sp.estado as EstadoDoc) : null;
  const q = String(sp.q ?? "").trim().slice(0, 60);
  const pagina = Math.min(10000, Math.max(1, Math.trunc(Number(sp.pagina)) || 1));
  return { ...rango(sp.desde, sp.hasta), tipo, estado, q, pagina };
}

/** Condición SQL de los filtros. Sin `estado` sirve para los contadores (que muestran el reparto por estado). */
function condicion(empresa: string, f: Filtro, conEstado: boolean) {
  const params: unknown[] = [empresa, f.desde, f.hasta];
  // d.creado nunca es anterior a la fecha del documento: sirve de cota inferior con índice; la fecha exacta va después.
  const w = [`d.empresa_id = $1`, `d.creado >= ($2::date)::timestamp at time zone 'America/Bogota'`,
    `${FECHA} >= ($2::date)::timestamp at time zone 'America/Bogota'`, `${FECHA} < ($3::date + 1)::timestamp at time zone 'America/Bogota'`];
  if (f.tipo === "pos" || f.tipo === "factura") { params.push(f.tipo); w.push(`d.tipo = $${params.length}`); }
  if (f.tipo === "nc_anulacion") w.push(`d.tipo = 'nota_credito' and d.devolucion_id is null`);
  if (f.tipo === "nc_devolucion") w.push(`d.tipo = 'nota_credito' and d.devolucion_id is not null`);
  if (f.q) {
    params.push(`%${sinComodines(f.q)}%`);
    const p = `$${params.length}`;
    w.push(`((d.prefijo || d.numero) ilike ${p} or (v.prefijo || v.numero) ilike ${p} or c.nombre ilike ${p} or c.numero_doc ilike ${p})`);
  }
  if (conEstado && f.estado) w.push(({
    aceptado: `d.estado = 'aceptado'`, simulado: `d.estado = 'aceptado' and d.simulado`, pendiente: `d.estado in ('pendiente', 'enviando')`,
    rechazado: `d.estado = 'rechazado'`, anulado: `d.estado = 'anulado'`,
  } as const)[f.estado]);
  return { sql: w.join(" and "), params };
}
// Fecha del documento: la de la venta para tiquetes y facturas; la propia para las notas crédito (como se emiten).
const FECHA = `(case when d.tipo = 'nota_credito' then d.creado else v.creado end)`;
const DESDE = `from documentos_dian d join ventas v on v.id = d.venta_id left join clientes c on c.id = v.cliente_id left join devoluciones dv on dv.id = d.devolucion_id`;

export type Documento = {
  id: string; tipo: TipoDoc; numero: string; estado: EstadoDoc; fecha: string; venta_id: string; venta: string; venta_anulada: boolean;
  devolucion_id: string | null; cliente: string | null; cliente_doc: string | null; total: number; cufe: string | null; simulado: boolean;
  ultimo_error: string | null; intentos: number; pdf: string | null;
};

/** Una página de documentos, los más recientes primero. `limite` null = todos (exportación, con tope de seguridad). */
export async function listarDocumentos(c: Tx, empresa: string, f: Filtro, limite: number | null = POR_PAGINA): Promise<Documento[]> {
  const { sql, params } = condicion(empresa, f, true);
  const lim = limite ?? 20000;
  const rows = (await c.query(`
    select d.id::text, d.prefijo || d.numero numero, d.estado, d.simulado, d.cufe, d.ultimo_error, d.intentos,
           case when d.tipo = 'nota_credito' then case when d.devolucion_id is null then 'nc_anulacion' else 'nc_devolucion' end else d.tipo end tipo,
           to_char(${FECHA} at time zone 'America/Bogota', 'DD/MM/YYYY HH24:MI') fecha,
           v.id::text venta_id, v.prefijo || v.numero venta, v.estado = 'anulada' venta_anulada, d.devolucion_id::text,
           c.nombre cliente, case when c.id is null then null else c.tipo_doc || ' ' || c.numero_doc || coalesce('-' || c.dv, '') end cliente_doc,
           (case when d.devolucion_id is not null then dv.total else v.total end)::float total,
           case when d.respuesta ->> 'pdf' ~ '^https://' then d.respuesta ->> 'pdf' end pdf
    ${DESDE} where ${sql} order by ${FECHA} desc, d.id desc limit ${lim} offset ${limite === null ? 0 : (f.pagina - 1) * limite}`, params)).rows;
  return rows.map((r) => ({ ...r, estado: r.estado === "enviando" ? "pendiente" : r.estado === "aceptado" && r.simulado ? "simulado" : r.estado }));
}

/** Cuántos documentos hay por estado con los demás filtros (los contadores de arriba). */
export async function contarDocumentos(c: Tx, empresa: string, f: Filtro) {
  const { sql, params } = condicion(empresa, f, false);
  const r = (await c.query(`select count(*) filter (where d.estado = 'aceptado')::int aceptado, count(*) filter (where d.estado = 'aceptado' and d.simulado)::int simulado,
      count(*) filter (where d.estado in ('pendiente', 'enviando'))::int pendiente, count(*) filter (where d.estado = 'rechazado')::int rechazado,
      count(*) filter (where d.estado = 'anulado')::int anulado, count(*)::int total ${DESDE} where ${sql}`, params)).rows[0];
  return r as Record<EstadoDoc | "total", number>;
}

/** Ventas con documentos rechazados dentro del filtro (para «Reenviar todos»). */
export async function ventasRechazadas(c: Tx, empresa: string, f: Filtro): Promise<string[]> {
  const { sql, params } = condicion(empresa, { ...f, estado: "rechazado" }, true);
  return (await c.query(`select distinct v.id::text ${DESDE} where ${sql} limit 200`, params)).rows.map((r) => r.id);
}

/** Consulta pública del documento en la DIAN (solo documentos reales: los simulados no existen allí). */
export const consultaDian = (cufe: string) => `https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=${encodeURIComponent(cufe)}`;

/** Querystring de los filtros (para enlaces y exportar), sin la página salvo que se pida. */
export function qs(f: Filtro, cambios: Partial<Record<"tipo" | "estado" | "q" | "pagina" | "desde" | "hasta", string | number | null>> = {}) {
  const base: Record<string, string | number | null> = { desde: f.desde, hasta: f.hasta, tipo: f.tipo, estado: f.estado, q: f.q || null, pagina: null, ...cambios };
  const u = new URLSearchParams();
  for (const [k, v] of Object.entries(base)) if (v !== null && v !== undefined && v !== "" && !(k === "pagina" && v === 1)) u.set(k, String(v));
  return u.toString();
}
