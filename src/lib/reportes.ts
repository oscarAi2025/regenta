import "server-only";
import type { Tx } from "./db";

// Reportes de gerencia (como los de un POS completo): ventas por día, por medio de pago, por cajero y por producto,
// estado de resultados, auxiliar de IVA y cierre del día. Fechas en zona Bogotá, ambas incluidas.
//
// Reglas de la utilidad (iguales en Reportes, Resultados e Inicio):
//   · Todo va SIN IVA: ventas = base de las líneas; costo = unidades × costo del lote (sin IVA desde la 031).
//   · Las devoluciones restan su base y su costo el día en que se hacen (como la nota crédito). Una venta anulada cuenta
//     en su fecha y su anulación resta el día de la nota crédito de anulación (E.T. art. 484: en el periodo en que
//     ocurre); así un mes ya cerrado no cambia. La anulada antes de emitirse a la DIAN no cuenta (nunca existió).
//   · La nota débito (mayor valor cobrado) suma por su fecha.
//   · Las líneas de lotes sin costo registrado NO entran en la utilidad (contarlas con costo 0 la inflaba): se informan
//     aparte como «vendidos sin costo registrado».
//   · Los lotes con costo heredado (anterior a las compras de la 031) sí entran, pero se marcan: ese costo puede incluir IVA.

export type Rango = { desde: string; hasta: string };
const RANGO_V = `v.empresa_id = $1 and v.origen is null and (v.creado at time zone 'America/Bogota')::date between $2::date and $3::date`;
const RANGO_D = `d.empresa_id = $1 and (d.creado at time zone 'America/Bogota')::date between $2::date and $3::date`;
const GRUPO = `case when lc.lote_id is null then 'sin_costo' when lc.heredado then 'heredado' else 'con_costo' end`;
/** La venta existe para la DIAN: cerrada, o anulada después de emitirse (tiene su nota crédito de anulación). */
const VENTA_FISCAL = `(v.estado = 'cerrada' or exists (select 1 from documentos_dian na where na.venta_id = v.id and na.tipo = 'nota_credito' and na.devolucion_id is null))`;
/** Notas crédito de anulación del rango (por su fecha). */
const RANGO_ANULA = `na.empresa_id = $1 and na.tipo = 'nota_credito' and na.devolucion_id is null and (na.creado at time zone 'America/Bogota')::date between $2::date and $3::date`;
/** Notas débito válidas del rango (por su fecha). */
const RANGO_DEBITO = `dn.empresa_id = $1 and dn.tipo = 'nota_debito' and dn.estado not in ('rechazado', 'anulado') and (dn.creado at time zone 'America/Bogota')::date between $2::date and $3::date`;

/** AAAA-MM-DD que existe de verdad (un mes 13 o el 31 de febrero no; antes, un mes 13 lanzaba un error y la pantalla caía). */
export const fechaValida = (f?: string | null) => { if (!f || !/^\d{4}-\d{2}-\d{2}$/.test(f)) return false; const d = new Date(f + "T12:00:00Z"); return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === f; };
export const hoyBogota = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
/** Redondeo a centavos (evita 0,1 + 0,2 = 0,30000000000000004 al sumar). */
export const cent = (n: number) => Math.round((Number(n) || 0) * 100) / 100;

/** Rango pedido o, por defecto, el mes en curso hasta hoy. Nunca más de 366 días. */
export function rango(desde?: string | null, hasta?: string | null): Rango {
  const hoy = hoyBogota();
  let h = fechaValida(hasta) ? hasta! : hoy;
  let d = fechaValida(desde) ? desde! : hoy.slice(0, 8) + "01";
  if (d > h) [d, h] = [h, d];
  const max = new Date(new Date(h + "T12:00:00Z").getTime() - 365 * 86400000).toISOString().slice(0, 10);
  if (d < max) d = max;
  return { desde: d, hasta: h };
}

/** Atajos de fechas para las pantallas de reportes: hoy, 7 días, este mes, mes pasado, 30 días. */
export function atajos(): [string, string, string][] {
  const hoy = hoyBogota();
  const menos = (n: number) => new Date(new Date(hoy + "T12:00:00Z").getTime() - n * 86400000).toISOString().slice(0, 10);
  const mesPasadoFin = menos(Number(hoy.slice(8, 10)));
  return [["Hoy", hoy, hoy], ["7 días", menos(6), hoy], ["Este mes", hoy.slice(0, 8) + "01", hoy], ["Mes pasado", mesPasadoFin.slice(0, 8) + "01", mesPasadoFin], ["30 días", menos(29), hoy]];
}

// ───────────────────────── Utilidad (estado de resultados) ─────────────────────────
export type Tramo = { ventas: number; devoluciones: number; netas: number; costo: number; utilidad: number };
export type Resultados = {
  rango: Rango;
  ventas: number; devoluciones: number; netas: number;          // todo lo vendido (sin IVA)
  con_costo: Tramo;                                              // lo que entra en la utilidad (incluye el heredado)
  heredado: Tramo;                                               // parte con costo anterior a compras (puede incluir IVA)
  sin_costo: Omit<Tramo, "costo" | "utilidad">;                  // vendido sin costo registrado: fuera de la utilidad
  utilidad_bruta: number; margen: number | null;
  gastos: { categoria: string; valor: number; n: number }[]; total_gastos: number;
  utilidad_operativa: number;
};

/** Ventas, costo de lo vendido y utilidad del rango, netos de devoluciones; gastos por categoría y utilidad operativa. */
export async function resultados(c: Tx, empresa: string, r: Rango): Promise<Resultados> {
  const p = [empresa, r.desde, r.hasta];
  const filas = (await c.query(`
    with ln as (
      select ${GRUPO} grupo, l.base venta, l.unidades * lc.costo_unidad costo, 0::numeric dev, 0::numeric dev_costo
      from venta_lineas l join ventas v on v.id = l.venta_id left join lote_costos lc on lc.lote_id = l.lote_id
      where ${RANGO_V} and ${VENTA_FISCAL}
      union all
      select ${GRUPO}, 0, 0, dl.base, dl.unidades * lc.costo_unidad
      from devolucion_lineas dl join devoluciones d on d.id = dl.devolucion_id join venta_lineas l on l.id = dl.venta_linea_id
      left join lote_costos lc on lc.lote_id = l.lote_id
      where ${RANGO_D}
      union all
      select ${GRUPO}, 0, 0, l.base, l.unidades * lc.costo_unidad
      from documentos_dian na join venta_lineas l on l.venta_id = na.venta_id left join lote_costos lc on lc.lote_id = l.lote_id
      where ${RANGO_ANULA}
      union all
      select 'con_costo', dl.base, 0, 0, 0
      from documento_lineas dl join documentos_dian dn on dn.id = dl.documento_id
      where ${RANGO_DEBITO}
    )
    select grupo, coalesce(sum(venta), 0)::float ventas, coalesce(sum(dev), 0)::float devoluciones,
           round(coalesce(sum(costo), 0) - coalesce(sum(dev_costo), 0), 2)::float costo
    from ln group by grupo`, p)).rows as { grupo: string; ventas: number; devoluciones: number; costo: number }[];
  const g = (k: string) => filas.find((f) => f.grupo === k) ?? { ventas: 0, devoluciones: 0, costo: 0 };
  const tramo = (...ks: string[]): Tramo => {
    const ventas = cent(ks.reduce((a, k) => a + g(k).ventas, 0)), devoluciones = cent(ks.reduce((a, k) => a + g(k).devoluciones, 0));
    const costo = cent(ks.reduce((a, k) => a + g(k).costo, 0)), netas = cent(ventas - devoluciones);
    return { ventas, devoluciones, netas, costo, utilidad: cent(netas - costo) };
  };
  const con = tramo("con_costo", "heredado"), her = tramo("heredado"), sin = tramo("sin_costo"), todo = tramo("con_costo", "heredado", "sin_costo");
  const gastos = (await c.query(`select categoria, sum(valor)::float valor, count(*)::int n from gastos
    where empresa_id = $1 and not anulado and fecha between $2::date and $3::date group by categoria order by 2 desc`, p)).rows as Resultados["gastos"];
  const total_gastos = cent(gastos.reduce((a, x) => a + x.valor, 0));
  return {
    rango: r, ventas: todo.ventas, devoluciones: todo.devoluciones, netas: todo.netas,
    con_costo: con, heredado: her, sin_costo: { ventas: sin.ventas, devoluciones: sin.devoluciones, netas: sin.netas },
    utilidad_bruta: con.utilidad, margen: con.netas > 0 ? Math.round((con.utilidad / con.netas) * 1000) / 10 : null,
    gastos, total_gastos, utilidad_operativa: cent(con.utilidad - total_gastos),
  };
}

// ───────────────────────── Reporte de ventas ─────────────────────────
export async function datosReporte(c: Tx, empresa: string, r: Rango, costos: boolean) {
  const p = [empresa, r.desde, r.hasta];
  const resumen = (await c.query(`select count(*) filter (where estado = 'cerrada')::int ventas, count(*) filter (where estado = 'anulada')::int anuladas,
      coalesce(sum(total) filter (where estado = 'cerrada'), 0)::float bruto, coalesce(sum(iva) filter (where estado = 'cerrada'), 0)::float iva,
      coalesce(sum(total) filter (where estado = 'cerrada' and condicion = 'credito'), 0)::float credito
    from ventas v where ${RANGO_V}`, p)).rows[0];
  const dev = (await c.query(`select count(*)::int n, coalesce(sum(total), 0)::float total, coalesce(sum(iva), 0)::float iva from devoluciones d where ${RANGO_D}`, p)).rows[0];
  // Lo aplicado por medio de pago: al efectivo se le resta el cambio.
  const medios = (await c.query(`select pg.medio, sum(pg.valor - case when pg.medio = 'efectivo' and pg.primero then v.cambio else 0 end)::float valor, count(distinct v.id)::int ventas
    from (select *, row_number() over (partition by venta_id, medio order by id) = 1 primero from pagos) pg join ventas v on v.id = pg.venta_id
    where ${RANGO_V} and v.estado = 'cerrada' group by 1 order by 2 desc`, p)).rows;
  const cajeros = (await c.query(`select coalesce(m.nombre, 'Sin nombre') cajero, count(*)::int ventas, sum(v.total)::float total, round(avg(v.total))::float promedio
    from ventas v left join miembros m on m.empresa_id = v.empresa_id and m.user_id = v.usuario_id
    where ${RANGO_V} and v.estado = 'cerrada' group by 1 order by 3 desc`, p)).rows;
  // Por producto: lo vendido en el rango y, de eso, lo que ya se devolvió (en cualquier fecha). La ganancia es solo de las
  // líneas con costo y neta de lo devuelto; lo vendido sin costo se muestra aparte.
  const productos = (await c.query(`select l.descripcion producto, sum(l.unidades)::int unidades, sum(l.total)::float total, sum(l.base)::float base,
      coalesce(sum(dv.unidades), 0)::int devueltas
      ${costos ? `, bool_or(lc.lote_id is not null) con_costo, bool_or(lc.heredado) heredado,
        round(coalesce(sum(l.base - coalesce(dv.base, 0)) filter (where lc.lote_id is not null), 0) - coalesce(sum((l.unidades - coalesce(dv.unidades, 0)) * lc.costo_unidad), 0), 2)::float ganancia,
        coalesce(sum(l.base - coalesce(dv.base, 0)) filter (where lc.lote_id is null), 0)::float sin_costo` : ""}
    from venta_lineas l join ventas v on v.id = l.venta_id ${costos ? "left join lote_costos lc on lc.lote_id = l.lote_id" : ""}
    left join lateral (select sum(dl.unidades) unidades, sum(dl.base) base from devolucion_lineas dl where dl.venta_linea_id = l.id) dv on true
    where ${RANGO_V} and v.estado = 'cerrada' group by l.producto_id, l.descripcion order by 3 desc limit 200`, p)).rows as
    { producto: string; unidades: number; total: number; base: number; devueltas: number; con_costo?: boolean; heredado?: boolean; ganancia?: number; sin_costo?: number }[];
  const dias = (await c.query(`select (v.creado at time zone 'America/Bogota')::date::text dia, count(*)::int ventas, sum(v.total)::float total
    from ventas v where ${RANGO_V} and v.estado = 'cerrada' group by 1 order by 1`, p)).rows;
  const horas = (await c.query(`select extract(hour from v.creado at time zone 'America/Bogota')::int hora, count(*)::int ventas, sum(v.total)::float total
    from ventas v where ${RANGO_V} and v.estado = 'cerrada' group by 1 order by 1`, p)).rows;
  const res = costos ? await resultados(c, empresa, r) : null;
  return {
    rango: r, resumen, devoluciones: dev,
    netas: resumen.bruto - dev.total, promedio: resumen.ventas ? Math.round(resumen.bruto / resumen.ventas) : 0,
    ganancia: res ? res.utilidad_bruta : null, margen: res ? res.margen : null, resultados: res,
    medios, cajeros, productos, dias, horas,
  };
}

// ───────────────────────── Auxiliar de IVA ─────────────────────────
export const TARIFAS = [0, 5, 19] as const;
export type FilaIva = { tarifa: number; base: number; iva: number };
export type AuxiliarIva = {
  rango: Rango; responsable: boolean;
  ventas: FilaIva[]; notas_debito: FilaIva[]; notas: FilaIva[]; ventas_netas: FilaIva[];
  compras: FilaIva[]; nc_proveedor: FilaIva[]; descontable: FilaIva[];
  n_compras: number; por_costear: number; n_notas: number; n_anulaciones: number; n_debito: number;
};
const porTarifa = (filas: { tarifa: number | string; base: number | string; iva: number | string }[]): FilaIva[] =>
  TARIFAS.map((t) => { const f = filas.filter((x) => Number(x.tarifa) === t); return { tarifa: t, base: cent(f.reduce((a, x) => a + Number(x.base), 0)), iva: cent(f.reduce((a, x) => a + Number(x.iva), 0)) }; });
const resta = (a: FilaIva[], b: FilaIva[]) => a.map((x, i) => ({ tarifa: x.tarifa, base: cent(x.base - b[i].base), iva: cent(x.iva - b[i].iva) }));
const suma = (a: FilaIva[], b: FilaIva[]) => a.map((x, i) => ({ tarifa: x.tarifa, base: cent(x.base + b[i].base), iva: cent(x.iva + b[i].iva) }));
export const sumaIva = (f: FilaIva[]) => ({ base: cent(f.reduce((a, x) => a + x.base, 0)), iva: cent(f.reduce((a, x) => a + x.iva, 0)) });

/** Ventas por tarifa (base e IVA) más notas débito y menos notas crédito (devoluciones y anulaciones, por su fecha), e IVA
 *  de las compras registradas (por la fecha de la factura del proveedor, con fletes y otros cargos) menos las notas crédito
 *  de proveedores aplicadas en el periodo. */
export async function auxiliarIva(c: Tx, empresa: string, r: Rango): Promise<AuxiliarIva> {
  const p = [empresa, r.desde, r.hasta];
  const responsable = (await c.query(`select responsable_iva from empresas where id = $1`, [empresa])).rows[0]?.responsable_iva !== false;
  const ventas = porTarifa((await c.query(`select l.iva_pct tarifa, sum(l.base) base, sum(l.iva) iva from venta_lineas l join ventas v on v.id = l.venta_id
    where ${RANGO_V} and ${VENTA_FISCAL} group by 1`, p)).rows);
  const devoluciones = porTarifa((await c.query(`select l.iva_pct tarifa, sum(dl.base) base, sum(dl.iva) iva from devolucion_lineas dl join devoluciones d on d.id = dl.devolucion_id
    join venta_lineas l on l.id = dl.venta_linea_id where ${RANGO_D} group by 1`, p)).rows);
  const anulaciones = porTarifa((await c.query(`select l.iva_pct tarifa, sum(l.base) base, sum(l.iva) iva from documentos_dian na join venta_lineas l on l.venta_id = na.venta_id
    where ${RANGO_ANULA} group by 1`, p)).rows);
  const notas = suma(devoluciones, anulaciones);
  const notas_debito = porTarifa((await c.query(`select dl.iva_pct tarifa, sum(dl.base) base, sum(dl.iva) iva from documento_lineas dl join documentos_dian dn on dn.id = dl.documento_id
    where ${RANGO_DEBITO} group by 1`, p)).rows);
  const cq = (await c.query(`select cl.iva_pct tarifa, sum(cl.base) base, sum(cl.iva) iva from compra_lineas cl join compras k on k.id = cl.compra_id
    where k.empresa_id = $1 and k.estado = 'registrada' and k.fecha_factura between $2::date and $3::date group by 1
    union all
    select case when k.cargos_iva = 0 then 0 when abs(k.cargos_iva / k.cargos * 100 - 5) < 1 then 5 else 19 end, k.cargos, k.cargos_iva from compras k
    where k.empresa_id = $1 and k.estado = 'registrada' and k.cargos > 0 and k.fecha_factura between $2::date and $3::date`, p)).rows;
  const compras = porTarifa(cq);
  const cuenta = (await c.query(`select count(*) filter (where estado = 'registrada')::int registradas, count(*) filter (where estado = 'por_costear')::int por_costear
    from compras where empresa_id = $1 and fecha_factura between $2::date and $3::date`, p)).rows[0];
  // Nota crédito del proveedor: su valor (con IVA) se reparte entre las líneas devueltas y se separa base e IVA por tarifa.
  const nc = (await c.query(`select cl.iva_pct tarifa, sum(dpl.valor * d.valor_nc / d.valor) valor
    from devolucion_proveedor_lineas dpl join devoluciones_proveedor d on d.id = dpl.devolucion_id join compra_lineas cl on cl.id = dpl.compra_linea_id
    where d.empresa_id = $1 and d.estado = 'aplicada' and d.valor > 0 and (d.aplicada at time zone 'America/Bogota')::date between $2::date and $3::date group by 1`, p)).rows;
  const nc_proveedor = TARIFAS.map((t) => {
    const v = cent(nc.filter((x) => Number(x.tarifa) === t).reduce((a, x) => a + Number(x.valor), 0));
    const base = cent(v / (1 + t / 100));
    return { tarifa: t, base, iva: cent(v - base) };
  });
  const n = (await c.query(`select (select count(*) from devoluciones d where ${RANGO_D})::int dev, (select count(*) from documentos_dian na where ${RANGO_ANULA})::int anula,
    (select count(*) from documentos_dian dn where ${RANGO_DEBITO})::int debito`, p)).rows[0];
  return { rango: r, responsable, ventas, notas_debito, notas, ventas_netas: resta(suma(ventas, notas_debito), notas), compras, nc_proveedor, descontable: resta(compras, nc_proveedor),
    n_compras: cuenta.registradas, por_costear: cuenta.por_costear, n_notas: n.dev + n.anula, n_anulaciones: n.anula, n_debito: n.debito };
}

// ───────────────────────── Cierre del día ─────────────────────────
type ResumenTurno = { ventas?: number; n_ventas?: number; medios?: Record<string, number>; credito?: number; efectivo_ventas?: number; abonos_efectivo?: number;
  abonos_medios?: Record<string, number>; ingresos?: number; egresos?: number; base?: number; devoluciones?: number; devoluciones_efectivo?: number; efectivo_esperado?: number; ventas_netas?: number };
export type TurnoDia = { id: string; caja: string; estado: string; abierto: string; cerrado: string | null; abre: string | null; cierra: string | null;
  base: number; ventas: number; devoluciones: number; abonos: number; ingresos: number; egresos: number; esperado: number; contado: number | null; diferencia: number | null; observaciones: string | null };

/** Todas las cajas y turnos del día (los que estuvieron abiertos en algún momento de ese día) y lo del día en toda la droguería. */
export async function cierreDia(c: Tx, empresa: string, dia: string) {
  const p = [empresa, dia, dia];
  const t = (await c.query(`select t.id, cj.nombre caja, t.estado, to_char(t.abierto at time zone 'America/Bogota', 'DD/MM HH24:MI') abierto,
      to_char(t.cerrado at time zone 'America/Bogota', 'DD/MM HH24:MI') cerrado, ma.nombre abre, mc.nombre cierra, t.base::float base,
      case when t.estado = 'cerrado' and t.resumen is not null then t.resumen else resumen_turno(t.id) end r,
      t.efectivo_contado::float contado, t.diferencia::float diferencia, t.observaciones
    from turnos t join cajas cj on cj.id = t.caja_id
    left join miembros ma on ma.empresa_id = t.empresa_id and ma.user_id = t.abre_usuario
    left join miembros mc on mc.empresa_id = t.empresa_id and mc.user_id = t.cierra_usuario
    where t.empresa_id = $1 and t.abierto < (($2::date + 1)::timestamp at time zone 'America/Bogota')
      and coalesce(t.cerrado, now()) >= ($2::date::timestamp at time zone 'America/Bogota')
    order by cj.nombre, t.abierto`, [empresa, dia])).rows as (Omit<TurnoDia, "ventas" | "devoluciones" | "abonos" | "ingresos" | "egresos" | "esperado"> & { r: ResumenTurno })[];
  const n = (v: unknown) => Number(v ?? 0) || 0;
  const turnos: TurnoDia[] = t.map(({ r, ...x }) => ({ ...x, ventas: n(r.ventas), devoluciones: n(r.devoluciones), abonos: n(r.abonos_efectivo),
    ingresos: n(r.ingresos), egresos: n(r.egresos), esperado: n(r.efectivo_esperado) }));
  const sum = (k: keyof TurnoDia) => cent(turnos.reduce((a, x) => a + n(x[k]), 0));
  const totales = { base: sum("base"), ventas: sum("ventas"), devoluciones: sum("devoluciones"), abonos: sum("abonos"), ingresos: sum("ingresos"), egresos: sum("egresos"),
    esperado: sum("esperado"), contado: sum("contado"), diferencia: sum("diferencia"), abiertos: turnos.filter((x) => x.estado === "abierto").length };
  const medios = (await c.query(`select pg.medio, sum(pg.valor - case when pg.medio = 'efectivo' and pg.primero then v.cambio else 0 end)::float valor, count(distinct v.id)::int ventas
    from (select *, row_number() over (partition by venta_id, medio order by id) = 1 primero from pagos) pg join ventas v on v.id = pg.venta_id
    where ${RANGO_V} and v.estado = 'cerrada' group by 1 order by 2 desc`, p)).rows as { medio: string; valor: number; ventas: number }[];
  const ventas = (await c.query(`select count(*) filter (where estado = 'cerrada')::int n, coalesce(sum(total) filter (where estado = 'cerrada'), 0)::float total,
      coalesce(sum(total) filter (where estado = 'cerrada' and condicion = 'credito'), 0)::float credito, count(*) filter (where estado = 'anulada')::int anuladas
    from ventas v where ${RANGO_V}`, p)).rows[0] as { n: number; total: number; credito: number; anuladas: number };
  const devoluciones = (await c.query(`select count(*)::int n, coalesce(sum(total), 0)::float total, coalesce(sum(reembolso) filter (where medio = 'efectivo'), 0)::float efectivo
    from devoluciones d where ${RANGO_D}`, p)).rows[0] as { n: number; total: number; efectivo: number };
  const abonos = (await c.query(`select a.medio, sum(a.valor)::float valor, count(*)::int n from abonos a
    where a.empresa_id = $1 and not a.anulado and (a.creado at time zone 'America/Bogota')::date = $2::date group by 1 order by 2 desc`, [empresa, dia])).rows as { medio: string; valor: number; n: number }[];
  const recibos = (await c.query(`select count(*)::int n from recibos_caja where empresa_id = $1 and not anulado and (creado at time zone 'America/Bogota')::date = $2::date`, [empresa, dia])).rows[0].n as number;
  const gastos = (await c.query(`select coalesce(sum(valor), 0)::float total, coalesce(sum(valor) filter (where caja_id is not null), 0)::float caja, count(*)::int n
    from gastos where empresa_id = $1 and not anulado and fecha = $2::date`, [empresa, dia])).rows[0] as { total: number; caja: number; n: number };
  const pagos = (await c.query(`select coalesce(sum(valor), 0)::float total, coalesce(sum(valor) filter (where caja_id is not null), 0)::float caja, count(*)::int n
    from pagos_proveedor where empresa_id = $1 and not anulado and (creado at time zone 'America/Bogota')::date = $2::date`, [empresa, dia])).rows[0] as { total: number; caja: number; n: number };
  return { dia, turnos, totales, medios, ventas, devoluciones, abonos, recibos, gastos, pagos };
}

/** CSV con separador «;» y BOM, para que Excel en español lo abra con tildes y columnas. */
export function csv(filas: Record<string, unknown>[], columnas: [string, string][]) {
  // Texto que empieza por = + - @ se abriría como fórmula en Excel (inyección): se antepone un apóstrofo.
  const celda = (v: unknown) => { let s = v === null || v === undefined ? "" : typeof v === "number" ? String(v).replace(".", ",") : String(v);
    if (typeof v !== "number" && /^[=+\-@\t\r]/.test(s)) s = "'" + s; return /[;"\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s; };
  return "﻿" + [columnas.map(([, t]) => t).join(";"), ...filas.map((f) => columnas.map(([k]) => celda(f[k])).join(";"))].join("\r\n");
}

/** Respuesta HTTP de un CSV para descargar. */
export const respuestaCsv = (cuerpo: string, archivo: string) =>
  new Response(cuerpo, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="${archivo}"`, "cache-control": "no-store" } });

/** Líneas del estado de resultados, en orden, para la pantalla y el CSV. nivel: 0 = total, 1 = renglón, 2 = aclaración. */
export function lineasResultado(d: Resultados): { concepto: string; valor: number; nivel: 0 | 1 | 2; nota?: string }[] {
  const nombres: Record<string, string> = { arriendo: "Arriendo", servicios: "Servicios públicos", nomina: "Nómina", transporte: "Transporte", impuestos: "Impuestos", mantenimiento: "Mantenimiento", otros: "Otros" };
  return [
    { concepto: "Ventas (sin IVA)", valor: d.ventas, nivel: 1 },
    { concepto: "Menos devoluciones (notas crédito)", valor: -d.devoluciones, nivel: 1 },
    { concepto: "Ventas netas", valor: d.netas, nivel: 0 },
    ...(d.sin_costo.netas ? [{ concepto: "Menos vendido sin costo registrado", valor: -d.sin_costo.netas, nivel: 2 as const, nota: "No entra en la utilidad: registra el costo de esos lotes" }] : []),
    { concepto: "Ventas netas con costo", valor: d.con_costo.netas, nivel: 1 },
    { concepto: "Menos costo de lo vendido", valor: -d.con_costo.costo, nivel: 1, nota: "Neto de devoluciones" },
    { concepto: "Utilidad bruta", valor: d.utilidad_bruta, nivel: 0, nota: d.margen === null ? undefined : `Margen ${String(d.margen).replace(".", ",")} %` },
    ...(d.heredado.netas || d.heredado.costo ? [{ concepto: "De ella, con costo anterior a compras", valor: d.heredado.utilidad, nivel: 2 as const, nota: "Costo anterior a compras: puede incluir IVA" }] : []),
    ...d.gastos.map((g) => ({ concepto: `Gasto: ${nombres[g.categoria] ?? g.categoria}`, valor: -g.valor, nivel: 1 as const, nota: g.categoria === "nomina" ? "Valor total pagado" : undefined })),
    { concepto: "Total gastos", valor: -d.total_gastos, nivel: 1 },
    { concepto: "Utilidad operativa", valor: d.utilidad_operativa, nivel: 0 },
  ];
}
