import "server-only";
import type { Tx } from "./db";
import { sinComodines } from "./db";
import { rango, type Rango } from "./reportes";

// Documentos electrónicos ante la DIAN de una droguería (tiquetes POS, facturas, notas crédito y débito, documento soporte y
// su nota de ajuste): filtros comunes a la pantalla /documentos, su exportación CSV y la descarga de XML. Las fechas son
// de Bogotá; el rango nunca pasa de 366 días.

export const TIPOS = {
  pos: "Tiquete POS", factura: "Factura", nc_anulacion: "Nota crédito · anulación", nc_devolucion: "Nota crédito · devolución",
  nota_debito: "Nota débito", soporte: "Documento soporte", ajuste_soporte: "Nota de ajuste · soporte",
} as const;
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
  if (f.tipo === "pos" || f.tipo === "factura" || f.tipo === "nota_debito" || f.tipo === "soporte" || f.tipo === "ajuste_soporte") { params.push(f.tipo); w.push(`d.tipo = $${params.length}`); }
  if (f.tipo === "nc_anulacion") w.push(`d.tipo = 'nota_credito' and d.devolucion_id is null`);
  if (f.tipo === "nc_devolucion") w.push(`d.tipo = 'nota_credito' and d.devolucion_id is not null`);
  if (f.q) {
    params.push(`%${sinComodines(f.q)}%`);
    const p = `$${params.length}`;
    w.push(`((d.prefijo || d.numero) ilike ${p} or (v.prefijo || v.numero) ilike ${p} or c.nombre ilike ${p} or c.numero_doc ilike ${p} or pr.nombre ilike ${p} or pr.nit ilike ${p})`);
  }
  if (conEstado && f.estado) w.push(({
    aceptado: `d.estado = 'aceptado'`, simulado: `d.estado = 'aceptado' and d.simulado`, pendiente: `d.estado in ('pendiente', 'enviando')`,
    rechazado: `d.estado = 'rechazado'`, anulado: `d.estado = 'anulado'`,
  } as const)[f.estado]);
  return { sql: w.join(" and "), params };
}
// Fecha del documento: la de la venta para tiquetes y facturas; la propia para las notas y el documento soporte (como se emiten).
const FECHA = `(case when d.tipo in ('pos', 'factura') then v.creado else d.creado end)`;
// La nota débito y la nota de ajuste no tienen venta: llegan a ella (o al proveedor) por su documento de origen.
const DESDE = `from documentos_dian d left join documentos_dian o on o.id = d.origen_id left join ventas v on v.id = coalesce(d.venta_id, o.venta_id)
  left join clientes c on c.id = v.cliente_id left join devoluciones dv on dv.id = d.devolucion_id left join proveedores pr on pr.id = d.proveedor_id`;

/** Tipos que restan (se muestran en negativo). */
export const resta = (t: TipoDoc) => t === "nc_anulacion" || t === "nc_devolucion" || t === "ajuste_soporte";

export type Documento = {
  id: string; tipo: TipoDoc; numero: string; estado: EstadoDoc; fecha: string; venta_id: string | null; venta: string | null; venta_anulada: boolean;
  devolucion_id: string | null; cliente: string | null; cliente_doc: string | null; total: number; cufe: string | null; simulado: boolean;
  ultimo_error: string | null; intentos: number; pdf: string | null;
  origen_id: string | null; origen: string | null; proveedor: string | null; proveedor_doc: string | null; motivo: string | null; concepto: string | null;
  xml: boolean; compras: { id: string; numero: number }[] | null; anulado_por: string | null;
};

/** Una página de documentos, los más recientes primero. `limite` null = todos (exportación, con tope de seguridad). */
export async function listarDocumentos(c: Tx, empresa: string, f: Filtro, limite: number | null = POR_PAGINA): Promise<Documento[]> {
  const { sql, params } = condicion(empresa, f, true);
  const lim = limite ?? 20000;
  const rows = (await c.query(`
    select d.id::text, d.prefijo || d.numero numero, d.estado, d.simulado, d.cufe, d.ultimo_error, d.intentos,
           case when d.tipo = 'nota_credito' then case when d.devolucion_id is null then 'nc_anulacion' else 'nc_devolucion' end else d.tipo end tipo,
           to_char(${FECHA} at time zone 'America/Bogota', 'DD/MM/YYYY HH24:MI') fecha,
           v.id::text venta_id, v.prefijo || v.numero venta, coalesce(v.estado = 'anulada', false) venta_anulada, d.devolucion_id::text,
           c.nombre cliente, case when c.id is null then null else c.tipo_doc || ' ' || c.numero_doc || coalesce('-' || c.dv, '') end cliente_doc,
           coalesce(d.total, case when d.devolucion_id is not null then dv.total else v.total end)::float total,
           coalesce(case when d.pdf_url ~ '^https://' then d.pdf_url end, case when d.respuesta ->> 'pdf' ~ '^https://' then d.respuesta ->> 'pdf' end) pdf,
           d.origen_id::text, o.prefijo || o.numero origen, pr.nombre proveedor,
           case when pr.nit is null then null else 'NIT ' || pr.nit || coalesce('-' || pr.dv, '') end proveedor_doc, d.motivo, d.concepto, d.xml is not null xml,
           case when d.tipo in ('soporte', 'ajuste_soporte') then (select json_agg(json_build_object('id', k.id, 'numero', k.numero) order by k.numero)
             from soporte_compras s join compras k on k.id = s.compra_id where s.documento_id = coalesce(d.origen_id, d.id)) end compras,
           case when d.tipo = 'soporte' then (select a.prefijo || a.numero from documentos_dian a where a.origen_id = d.id and a.tipo = 'ajuste_soporte' and a.concepto = 'anulacion' limit 1) end anulado_por
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

/** Ruta de reenvío de un documento rechazado: los de una venta se reenvían por la venta; los demás, uno por uno. */
export const rutaReenvio = (d: { id: string; venta_id: string | null; tipo: TipoDoc }) =>
  d.tipo === "nota_debito" || d.tipo === "soporte" || d.tipo === "ajuste_soporte" || !d.venta_id ? `/api/documentos/${d.id}/reenviar` : `/api/ventas/${d.venta_id}/reenviar`;

/** Reenvíos de los documentos rechazados dentro del filtro (para «Reenviar todos»), sin repetir una venta. */
export async function reenviosRechazados(c: Tx, empresa: string, f: Filtro): Promise<string[]> {
  const { sql, params } = condicion(empresa, { ...f, estado: "rechazado" }, true);
  const filas = (await c.query(`select d.id::text, d.tipo, d.venta_id::text ${DESDE} where ${sql} limit 200`, params)).rows as { id: string; tipo: TipoDoc; venta_id: string | null }[];
  return [...new Set(filas.map(rutaReenvio))];
}

/** XML de los documentos del filtro (para el ZIP), con tope de seguridad. */
export async function xmlDocumentos(c: Tx, empresa: string, f: Filtro, tope = 2000): Promise<{ numero: string; tipo: string; xml: string }[]> {
  const { sql, params } = condicion(empresa, f, true);
  return (await c.query(`select d.prefijo || d.numero numero, d.tipo, d.xml ${DESDE} where ${sql} and d.xml is not null order by ${FECHA}, d.id limit ${tope}`, params)).rows;
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
