import "server-only";
import type { Tx } from "./db";

// Reportes de gerencia (como los de un POS completo): ventas por día, por medio de pago, por cajero y por producto,
// con devoluciones y ganancia (la ganancia solo si el rol ve costos). Fechas en zona Bogotá, ambas incluidas.

export type Rango = { desde: string; hasta: string };
const RANGO_V = `v.empresa_id = $1 and (v.creado at time zone 'America/Bogota')::date between $2::date and $3::date`;

export const fechaValida = (f?: string | null) => !!f && /^\d{4}-\d{2}-\d{2}$/.test(f) && new Date(f + "T12:00:00Z").toISOString().slice(0, 10) === f;

/** Rango pedido o, por defecto, el mes en curso hasta hoy. Nunca más de 366 días. */
export function rango(desde?: string | null, hasta?: string | null): Rango {
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
  let h = fechaValida(hasta) ? hasta! : hoy;
  let d = fechaValida(desde) ? desde! : hoy.slice(0, 8) + "01";
  if (d > h) [d, h] = [h, d];
  const max = new Date(new Date(h + "T12:00:00Z").getTime() - 365 * 86400000).toISOString().slice(0, 10);
  if (d < max) d = max;
  return { desde: d, hasta: h };
}

export async function datosReporte(c: Tx, empresa: string, r: Rango, costos: boolean) {
  const p = [empresa, r.desde, r.hasta];
  const resumen = (await c.query(`select count(*) filter (where estado = 'cerrada')::int ventas, count(*) filter (where estado = 'anulada')::int anuladas,
      coalesce(sum(total) filter (where estado = 'cerrada'), 0)::float bruto, coalesce(sum(iva) filter (where estado = 'cerrada'), 0)::float iva,
      coalesce(sum(total) filter (where estado = 'cerrada' and condicion = 'credito'), 0)::float credito
    from ventas v where ${RANGO_V}`, p)).rows[0];
  const dev = (await c.query(`select count(*)::int n, coalesce(sum(total), 0)::float total, coalesce(sum(iva), 0)::float iva from devoluciones d
    where d.empresa_id = $1 and (d.creado at time zone 'America/Bogota')::date between $2::date and $3::date`, p)).rows[0];
  // Lo aplicado por medio de pago: al efectivo se le resta el cambio.
  const medios = (await c.query(`select pg.medio, sum(pg.valor - case when pg.medio = 'efectivo' and pg.primero then v.cambio else 0 end)::float valor, count(distinct v.id)::int ventas
    from (select *, row_number() over (partition by venta_id, medio order by id) = 1 primero from pagos) pg join ventas v on v.id = pg.venta_id
    where ${RANGO_V} and v.estado = 'cerrada' group by 1 order by 2 desc`, p)).rows;
  const cajeros = (await c.query(`select coalesce(m.nombre, 'Sin nombre') cajero, count(*)::int ventas, sum(v.total)::float total, round(avg(v.total))::float promedio
    from ventas v left join miembros m on m.empresa_id = v.empresa_id and m.user_id = v.usuario_id
    where ${RANGO_V} and v.estado = 'cerrada' group by 1 order by 3 desc`, p)).rows;
  const productos = (await c.query(`select l.descripcion producto, sum(l.unidades)::int unidades, sum(l.total)::float total, sum(l.base)::float base
      ${costos ? ", sum(l.unidades * coalesce(lc.costo_unidad, 0))::float costo, bool_or(lc.costo_unidad is null) sin_costo" : ""},
      coalesce(sum((select sum(dl.unidades) from devolucion_lineas dl where dl.venta_linea_id = l.id)), 0)::int devueltas
    from venta_lineas l join ventas v on v.id = l.venta_id ${costos ? "left join lote_costos lc on lc.lote_id = l.lote_id" : ""}
    where ${RANGO_V} and v.estado = 'cerrada' group by l.producto_id, l.descripcion order by 3 desc limit 200`, p)).rows;
  const dias = (await c.query(`select (v.creado at time zone 'America/Bogota')::date::text dia, count(*)::int ventas, sum(v.total)::float total
    from ventas v where ${RANGO_V} and v.estado = 'cerrada' group by 1 order by 1`, p)).rows;
  const horas = (await c.query(`select extract(hour from v.creado at time zone 'America/Bogota')::int hora, count(*)::int ventas, sum(v.total)::float total
    from ventas v where ${RANGO_V} and v.estado = 'cerrada' group by 1 order by 1`, p)).rows;
  const costo = costos ? productos.reduce((s, x) => s + Number(x.costo ?? 0), 0) : null;
  const base = productos.reduce((s, x) => s + Number(x.base), 0);
  return {
    rango: r, resumen, devoluciones: dev,
    netas: resumen.bruto - dev.total, promedio: resumen.ventas ? Math.round(resumen.bruto / resumen.ventas) : 0,
    ganancia: costo === null ? null : base - costo, margen: costo === null || !base ? null : Math.round(((base - costo) / base) * 100),
    medios, cajeros, productos, dias, horas,
  };
}

/** CSV con separador «;» y BOM, para que Excel en español lo abra con tildes y columnas. */
export function csv(filas: Record<string, unknown>[], columnas: [string, string][]) {
  const celda = (v: unknown) => { const s = v === null || v === undefined ? "" : typeof v === "number" ? String(v).replace(".", ",") : String(v); return /[;"\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; };
  return "﻿" + [columnas.map(([, t]) => t).join(";"), ...filas.map((f) => columnas.map(([k]) => celda(f[k])).join(";"))].join("\r\n");
}
