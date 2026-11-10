import type { PoolClient } from "pg";
import { sinComodines } from "@/lib/db";

// Historial de ventas traído de Alegra (ventas_externas): filtros, resumen, por mes, productos y clientes. Lo usan la
// pantalla /ventas/historial y su descarga en Excel, con los mismos filtros.

export type FiltroHistorial = { q: string; cliente: string | null; desde: string | null; hasta: string | null };

const fechaValida = (s?: string | null) => (s && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s + "T00:00:00Z")) ? s : null);

export function leerFiltro(sp: { q?: string; cliente?: string; desde?: string; hasta?: string }): FiltroHistorial {
  return {
    q: (sp.q ?? "").replace(/\0/g, "").trim().slice(0, 80),
    cliente: /^[0-9a-f-]{36}$/i.test(sp.cliente ?? "") ? sp.cliente! : null,
    desde: fechaValida(sp.desde), hasta: fechaValida(sp.hasta),
  };
}

/** Condición SQL y parámetros ($1 empresa, $2 cliente, $3 palabras, $4 desde, $5 hasta). */
export function donde(empresa: string, f: FiltroHistorial) {
  const palabras = f.q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 5).map(sinComodines);
  return {
    sql: `x.empresa_id = $1 and ($2::uuid is null or x.cliente_id = $2) and ($4::date is null or x.fecha >= $4::date) and ($5::date is null or x.fecha <= $5::date)
      and (cardinality($3::text[]) = 0 or (select bool_and(sin_tildes(lower(coalesce(x.prefijo, '') || coalesce(x.numero::text, '') || ' ' || coalesce(x.cliente_nombre, '') || ' ' || coalesce(x.cliente_doc, '') || ' ' ||
        coalesce((select string_agg(l ->> 'nombre', ' ') from jsonb_array_elements(x.lineas) l), ''))) like '%' || sin_tildes(w) || '%') from unnest($3::text[]) w))`,
    params: [empresa, f.cliente, palabras, f.desde, f.hasta] as unknown[],
  };
}

export type Resumen = { n: number; facturado: number; iva: number; por_cobrar: number; anuladas: number; clientes: number; desde: string | null; hasta: string | null; minimo: string | null; maximo: string | null };

export async function resumenHistorial(c: PoolClient, empresa: string, f: FiltroHistorial) {
  const w = donde(empresa, f);
  const resumen = (await c.query(`select count(*) filter (where estado <> 'anulada')::int n, coalesce(sum(total) filter (where estado <> 'anulada'), 0)::float facturado,
      coalesce(sum(iva) filter (where estado <> 'anulada'), 0)::float iva, coalesce(sum(saldo) filter (where estado = 'por_cobrar'), 0)::float por_cobrar,
      count(*) filter (where estado = 'anulada')::int anuladas, count(distinct coalesce(cliente_doc, cliente_nombre)) filter (where estado <> 'anulada')::int clientes,
      min(fecha)::text desde, max(fecha)::text hasta,
      (select min(fecha)::text from ventas_externas where empresa_id = $1) minimo, (select max(fecha)::text from ventas_externas where empresa_id = $1) maximo
    from ventas_externas x where ${w.sql}`, w.params)).rows[0] as Resumen;
  const meses = (await c.query(`select to_char(fecha, 'YYYY-MM') mes, count(*)::int documentos, sum(total)::float total, sum(iva)::float iva
    from ventas_externas x where ${w.sql} and estado <> 'anulada' group by 1 order by 1 desc`, w.params)).rows as { mes: string; documentos: number; total: number; iva: number }[];
  const productos = (await c.query(`select l ->> 'nombre' producto, sum((l ->> 'cantidad')::numeric)::float cantidad, sum((l ->> 'total')::numeric)::float total, count(distinct x.id)::int documentos
    from ventas_externas x cross join jsonb_array_elements(x.lineas) l where ${w.sql} and estado <> 'anulada'
    group by 1 order by 3 desc limit 30`, w.params)).rows as { producto: string; cantidad: number; total: number; documentos: number }[];
  const clientes = (await c.query(`select coalesce(x.cliente_nombre, 'Sin nombre') cliente, x.cliente_doc doc, max(x.cliente_id::text) cliente_id, count(*)::int documentos, sum(x.total)::float total,
      max(x.fecha)::text ultima from ventas_externas x where ${w.sql} and estado <> 'anulada' group by 1, 2 order by 5 desc limit 20`, w.params)).rows as
    { cliente: string; doc: string | null; cliente_id: string | null; documentos: number; total: number; ultima: string }[];
  return { resumen, meses, productos, clientes };
}

export type DocHistorial = { id: string; numero: string; documento: string; fecha: string; vence: string | null; cliente_nombre: string | null; cliente_doc: string | null;
  subtotal: number; descuento: number; iva: number; total: number; pagado: number; saldo: number; estado: string; forma_pago: string | null; lineas: number };

export async function documentosHistorial(c: PoolClient, empresa: string, f: FiltroHistorial, limite: number, desplazar = 0) {
  const w = donde(empresa, f);
  return (await c.query(`select x.id, coalesce(x.prefijo, '') || coalesce(x.numero::text, '') numero, x.documento, x.fecha::text, x.vence::text, x.cliente_nombre, x.cliente_doc,
      x.subtotal::float, x.descuento::float, x.iva::float, x.total::float, x.pagado::float, x.saldo::float, x.estado, x.forma_pago, jsonb_array_length(x.lineas)::int lineas
    from ventas_externas x where ${w.sql} order by x.fecha desc, x.numero desc nulls last limit ${limite} offset ${desplazar}`, w.params)).rows as DocHistorial[];
}

export async function lineasHistorial(c: PoolClient, empresa: string, f: FiltroHistorial) {
  const w = donde(empresa, f);
  return (await c.query(`select coalesce(x.prefijo, '') || coalesce(x.numero::text, '') numero, x.fecha::text, x.cliente_nombre, x.cliente_doc, x.estado,
      l ->> 'nombre' producto, (l ->> 'cantidad')::float cantidad, (l ->> 'precio')::float precio, coalesce((l ->> 'descuento')::float, 0) descuento,
      coalesce((l ->> 'iva_pct')::float, 0) iva_pct, (l ->> 'total')::float total, l ->> 'lote' lote, l ->> 'vence' vence
    from ventas_externas x cross join jsonb_array_elements(x.lineas) l where ${w.sql} order by x.fecha desc, x.numero desc nulls last`, w.params)).rows as
    { numero: string; fecha: string; cliente_nombre: string | null; cliente_doc: string | null; estado: string; producto: string; cantidad: number; precio: number;
      descuento: number; iva_pct: number; total: number; lote: string | null; vence: string | null }[];
}

export const ESTADO_HISTORIAL: Record<string, string> = { pagada: "Pagada", por_cobrar: "Por cobrar", anulada: "Anulada", borrador: "Borrador" };
