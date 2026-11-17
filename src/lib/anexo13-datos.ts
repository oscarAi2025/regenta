import "server-only";
import type { Tx } from "./db";
import {
  aplicarPlantilla, consolidar, libroConSaldo, limitesMes, nombreMes, plazo, PLANTILLA_BASE, revisarInforme, totales, validarPlantilla,
  type Agregado, type ColumnaPlantilla, type FichaControl, type MovimientoLibro, type ProductoAnexo,
} from "./anexo13";

// Control especial · consultas del libro completo y del informe mensual (Anexo 13). Siempre como el usuario (RLS): solo
// dueño y administrador ven fichas, configuración, informes y datos de pacientes. Las cantidades salen de los movimientos
// de inventario; la sede es opcional (null = toda la droguería).

/** La migración 048 está aplicada (el código nuevo se publica antes o después de aplicarla sin romper nada). */
export async function moduloListo(c: Tx): Promise<boolean> {
  return !!(await c.query(`select to_regclass('public.control_informes') is not null listo`)).rows[0]?.listo;
}

export type ConfigAnexo = {
  departamento: string | null; fondo: string | null; canal: string | null; destino: string | null;
  responsable: string | null; responsable_registro: string | null; plantilla: ColumnaPlantilla[]; propia: boolean;
};
export const CANALES: Record<string, string> = { correo: "Correo electrónico", plataforma: "Plataforma web del fondo", presencial: "Radicado en físico", otro: "Otro" };

export async function leerConfig(c: Tx, empresa: string): Promise<ConfigAnexo> {
  const r = (await c.query(`select departamento, fondo, canal, destino, responsable, responsable_registro, plantilla from control_config where empresa_id = $1`, [empresa])).rows[0];
  const v = r?.plantilla ? validarPlantilla(r.plantilla) : null;
  return {
    departamento: r?.departamento ?? null, fondo: r?.fondo ?? null, canal: r?.canal ?? null, destino: r?.destino ?? null,
    responsable: r?.responsable ?? null, responsable_registro: r?.responsable_registro ?? null,
    plantilla: v?.ok ? v.plantilla : PLANTILLA_BASE, propia: !!v?.ok,
  };
}

/** Productos del control especial: los marcados hoy y los que tuvieron dispensaciones de control (aunque se desmarquen). */
export async function productosAnexo(c: Tx, empresa: string): Promise<ProductoAnexo[]> {
  const rows = (await c.query(`select p.id, p.nombre, p.laboratorio, p.registro_sanitario, p.unidades_por_caja, p.control_especial,
      f.principio_activo, f.concentracion, f.forma_farmaceutica, f.cum, f.categoria, f.producto_id is not null tiene_ficha
    from productos p left join control_fichas f on f.producto_id = p.id
    where p.empresa_id = $1 and (p.control_especial or exists (select 1 from venta_formulas v where v.producto_id = p.id and v.control))
    order by coalesce(f.principio_activo, p.nombre), p.nombre`, [empresa])).rows;
  return rows.map((r) => ({
    id: r.id, nombre: r.nombre, laboratorio: r.laboratorio, registro_sanitario: r.registro_sanitario, unidades_por_caja: r.unidades_por_caja,
    control_especial: r.control_especial,
    ficha: r.tiene_ficha ? ({ principio_activo: r.principio_activo, concentracion: r.concentracion, forma_farmaceutica: r.forma_farmaceutica, cum: r.cum, categoria: r.categoria } as FichaControl) : null,
  }));
}

/** Sedes de la droguería (el informe se presenta por establecimiento). */
export async function sedes(c: Tx, empresa: string): Promise<{ id: string; nombre: string; ciudad: string | null }[]> {
  return (await c.query(`select id, nombre, ciudad from sedes where empresa_id = $1 order by creado`, [empresa])).rows;
}

// Movimientos de los productos del control especial con su día en Bogotá y si la venta (o la entrega interna) tuvo
// fórmula de control.
const MOVS = `select m.id, m.producto_id, m.lote_id, m.tipo, m.cantidad, m.ref_id, m.motivo, m.usuario_id, m.creado,
    (m.creado at time zone 'America/Bogota')::date d,
    (exists (select 1 from venta_formulas f where f.venta_id = m.ref_id and f.producto_id = m.producto_id and f.control)
      or (m.tipo = 'entrega' and exists (select 1 from entrega_formulas f where f.entrega_id = m.ref_id and f.producto_id = m.producto_id and f.control))) con_formula
  from movimientos m
  where m.empresa_id = $1 and m.producto_id = any($2::uuid[]) and ($3::uuid is null or m.sede_id = $3)`;

/** Informe del mes: una fila por medicamento (con ceros si no se movió) y los lotes en existencia al cierre. */
export async function datosAnexo(c: Tx, empresa: string, sede: string | null, mes: string) {
  const { desde, hasta } = limitesMes(mes);
  const productos = await productosAnexo(c, empresa);
  const ids = productos.map((p) => p.id);
  const ag = (await c.query(`with m as (${MOVS} and (m.creado at time zone 'America/Bogota')::date <= $5::date)
    select producto_id,
      coalesce(sum(cantidad) filter (where d < $4::date), 0)::int inicial,
      coalesce(sum(cantidad) filter (where d >= $4::date and cantidad > 0), 0)::int entradas,
      coalesce(-sum(cantidad) filter (where d >= $4::date and cantidad < 0), 0)::int salidas,
      coalesce(-sum(cantidad) filter (where d >= $4::date and tipo in ('venta', 'entrega') and cantidad < 0 and con_formula), 0)::int dispensado,
      coalesce(-sum(cantidad) filter (where d >= $4::date and tipo in ('venta', 'entrega') and cantidad < 0 and not con_formula), 0)::int sin_formula,
      coalesce(sum(cantidad) filter (where d >= $4::date and tipo in ('venta', 'anulacion', 'devolucion', 'entrega') and cantidad > 0), 0)::int reintegros,
      coalesce(-sum(cantidad) filter (where d >= $4::date and tipo = 'devolucion' and cantidad < 0), 0)::int devolucion_proveedor,
      coalesce(-sum(cantidad) filter (where d >= $4::date and tipo in ('ajuste', 'inicial', 'anulacion') and cantidad < 0), 0)::int bajas
    from m group by producto_id`, [empresa, ids, sede, desde, hasta])).rows as (Agregado & { producto_id: string })[];
  const formulas = (await c.query(`select producto_id, count(*)::int n from (
      select f.producto_id from venta_formulas f join ventas v on v.id = f.venta_id
      where f.empresa_id = $1 and f.control and f.producto_id = any($2::uuid[]) and ($3::uuid is null or v.sede_id = $3)
        and (v.creado at time zone 'America/Bogota')::date between $4::date and $5::date
      union all
      select f.producto_id from entrega_formulas f join entregas en on en.id = f.entrega_id
      where f.empresa_id = $1 and f.control and f.producto_id = any($2::uuid[]) and ($3::uuid is null or en.sede_id = $3)
        and (en.creado at time zone 'America/Bogota')::date between $4::date and $5::date) x group by producto_id`, [empresa, ids, sede, desde, hasta])).rows;
  const lotes = (await c.query(`with m as (${MOVS} and (m.creado at time zone 'America/Bogota')::date <= $4::date),
      s as (select producto_id, lote_id, sum(cantidad)::int u from m group by 1, 2 having sum(cantidad) <> 0)
    select s.producto_id, string_agg(l.lote || coalesce(' (vence ' || to_char(l.vence, 'MM/YYYY') || ')', '') || ': ' || s.u, ' · ' order by l.vence nulls last, l.lote) txt
    from s join lotes l on l.id = s.lote_id group by s.producto_id`, [empresa, ids, sede, hasta])).rows;
  const agregados: Record<string, Partial<Agregado>> = {};
  for (const a of ag) agregados[a.producto_id] = a;
  for (const f of formulas) agregados[f.producto_id] = { ...(agregados[f.producto_id] ?? {}), formulas: f.n };
  const filas = consolidar(productos, agregados, Object.fromEntries(lotes.map((l) => [l.producto_id, l.txt])));
  return { desde, hasta, filas };
}

/** Libro completo del rango: todos los movimientos de los productos del control especial con su soporte y el saldo
 *  resultante después de cada asiento. */
export async function libroCompleto(c: Tx, empresa: string, sede: string | null, desde: string, hasta: string, producto: string | null) {
  const productos = await productosAnexo(c, empresa);
  const ids = (producto && productos.some((p) => p.id === producto) ? [producto] : productos.map((p) => p.id));
  const inicial = Object.fromEntries((await c.query(`with m as (${MOVS} and (m.creado at time zone 'America/Bogota')::date < $4::date)
    select producto_id, sum(cantidad)::int s from m group by 1`, [empresa, ids, sede, desde])).rows.map((r) => [r.producto_id, r.s]));
  const movs = (await c.query(`with m as (${MOVS} and (m.creado at time zone 'America/Bogota')::date between $4::date and $5::date)
    select m.id::text, to_char(m.creado at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI') fecha, m.producto_id, m.tipo, m.cantidad, m.con_formula,
      l.lote, l.vence::text vence,
      case
        when m.tipo = 'compra' then 'Compra N.º ' || co.numero || coalesce(' · ' || pv.nombre, '') || ' · factura ' || co.numero_factura
        when v.id is not null then 'Venta ' || v.prefijo || v.numero || coalesce(' · ' || nullif(trim(m.motivo), ''), '')
        when en.id is not null and m.cantidad > 0 then nullif(trim(m.motivo), '')
        when en.id is not null then 'Entrega interna EI-' || en.numero || ' · ' || en.destinatario || coalesce(' · ' || en.servicio, '')
        else nullif(trim(m.motivo), '')
      end soporte,
      coalesce(f.formula_numero, fe.formula_numero) formula_numero,
      coalesce(f.medico_nombre || ' · reg. ' || f.medico_registro, fe.medico_nombre || ' · reg. ' || fe.medico_registro) medico,
      coalesce(f.paciente_nombre || ' · ' || f.paciente_tipo_doc || ' ' || f.paciente_doc, fe.paciente_nombre || ' · ' || fe.paciente_tipo_doc || ' ' || fe.paciente_doc) paciente,
      split_part(coalesce(mi.nombre, ''), ' (', 1) usuario
    from m
    left join lotes l on l.id = m.lote_id
    left join compras co on m.tipo = 'compra' and co.id = m.ref_id
    left join proveedores pv on pv.id = co.proveedor_id
    left join ventas v on m.tipo in ('venta', 'anulacion', 'devolucion') and v.id = m.ref_id
    left join venta_formulas f on f.venta_id = m.ref_id and f.producto_id = m.producto_id and f.control
    left join entregas en on m.tipo = 'entrega' and en.id = m.ref_id
    left join entrega_formulas fe on fe.entrega_id = m.ref_id and fe.producto_id = m.producto_id and fe.control
    left join miembros mi on mi.user_id = m.usuario_id and mi.empresa_id = $1
    order by m.creado, m.id limit 20000`, [empresa, ids, sede, desde, hasta])).rows as MovimientoLibro[];
  return { productos, elegido: ids.length === 1 && producto ? producto : null, inicial, asientos: libroConSaldo(movs, inicial) };
}

/** Relación de fórmulas (recetarios oficiales) dispensadas en el mes, para anexar al informe. */
export async function recetariosMes(c: Tx, empresa: string, sede: string | null, mes: string) {
  const { desde, hasta } = limitesMes(mes);
  // Ventas con recetario y, en la droguería interna, entregas con recetario (EI-n).
  return (await c.query(`select fecha, venta, producto, unidades, formula_numero, formula_fecha, medico_nombre, medico_registro, paciente_tipo_doc, paciente_doc, paciente_nombre from (
      select v.creado, to_char(v.creado at time zone 'America/Bogota', 'YYYY-MM-DD') fecha, v.prefijo || v.numero venta, p.nombre producto,
        (select coalesce(sum(vl.unidades), 0)::int from venta_lineas vl where vl.venta_id = f.venta_id and vl.producto_id = f.producto_id) unidades,
        f.formula_numero, f.formula_fecha::text formula_fecha, f.medico_nombre, f.medico_registro, f.paciente_tipo_doc, f.paciente_doc, f.paciente_nombre
      from venta_formulas f join ventas v on v.id = f.venta_id join productos p on p.id = f.producto_id
      where f.empresa_id = $1 and f.control and ($2::uuid is null or v.sede_id = $2)
        and (v.creado at time zone 'America/Bogota')::date between $3::date and $4::date
      union all
      select en.creado, to_char(en.creado at time zone 'America/Bogota', 'YYYY-MM-DD'), 'EI-' || en.numero, p.nombre,
        (select coalesce(sum(el.unidades), 0)::int from entrega_lineas el where el.entrega_id = f.entrega_id and el.producto_id = f.producto_id),
        f.formula_numero, f.formula_fecha::text, f.medico_nombre, f.medico_registro, f.paciente_tipo_doc, f.paciente_doc, f.paciente_nombre
      from entrega_formulas f join entregas en on en.id = f.entrega_id join productos p on p.id = f.producto_id
      where f.empresa_id = $1 and f.control and ($2::uuid is null or en.sede_id = $2)
        and (en.creado at time zone 'America/Bogota')::date between $3::date and $4::date) x
    order by creado limit 20000`, [empresa, sede, desde, hasta])).rows as {
      fecha: string; venta: string; producto: string; unidades: number; formula_numero: string; formula_fecha: string;
      medico_nombre: string; medico_registro: string; paciente_tipo_doc: string; paciente_doc: string; paciente_nombre: string;
    }[];
}
export const COLUMNAS_RECETARIOS: [string, string][] = [
  ["fecha", "Fecha de dispensación"], ["venta", "Venta"], ["producto", "Medicamento"], ["unidades", "Unidades"], ["formula_numero", "N.º de recetario"],
  ["formula_fecha", "Fecha del recetario"], ["medico_nombre", "Prescriptor"], ["medico_registro", "Registro profesional"],
  ["paciente_tipo_doc", "Tipo de documento"], ["paciente_doc", "Documento del paciente"], ["paciente_nombre", "Paciente"],
];

/** Informes presentados (el último de cada mes y sede manda; los anteriores quedan como historial). */
export async function informesPresentados(c: Tx, empresa: string) {
  return (await c.query(`select i.id::int, to_char(i.periodo, 'YYYY-MM') mes, i.sede_id, s.nombre sede, i.presentado::text presentado, i.canal, i.radicado,
      i.observacion, i.totales, i.reemplaza::int, to_char(i.creado at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI') creado,
      split_part(coalesce(mi.nombre, ''), ' (', 1) usuario,
      not exists (select 1 from control_informes x where x.reemplaza = i.id) vigente
    from control_informes i left join sedes s on s.id = i.sede_id left join miembros mi on mi.user_id = i.usuario_id and mi.empresa_id = i.empresa_id
    where i.empresa_id = $1 order by i.periodo desc, i.id desc limit 120`, [empresa])).rows as {
      id: number; mes: string; sede_id: string | null; sede: string | null; presentado: string; canal: string; radicado: string | null;
      observacion: string | null; totales: Record<string, number>; reemplaza: number | null; creado: string; usuario: string; vigente: boolean;
    }[];
}

/** Datos de la droguería para el encabezado del informe. */
export async function encabezado(c: Tx, empresa: string, sede: string | null) {
  return (await c.query(`select coalesce(e.nombre_comercial, e.razon_social) nombre, e.razon_social, e.nit, e.dv, e.direccion, e.ciudad, e.telefono, e.email,
      s.nombre sede, s.direccion sede_direccion, s.ciudad sede_ciudad
    from empresas e left join sedes s on s.id = $2::uuid and s.empresa_id = e.id where e.id = $1`, [empresa, sede])).rows[0] as {
      nombre: string; razon_social: string; nit: string; dv: string | null; direccion: string | null; ciudad: string | null; telefono: string | null;
      email: string | null; sede: string | null; sede_direccion: string | null; sede_ciudad: string | null;
    };
}

/** Informe completo del mes (lo usan la pantalla, la descarga, la impresión y el registro de «presentado»): filas por
 *  medicamento, totales, revisión antes de exportar y la tabla con las columnas de la plantilla de la droguería. */
export async function informeMes(c: Tx, empresa: string, sede: string | null, mes: string, hoy: string) {
  const config = await leerConfig(c, empresa);
  const { desde, hasta, filas } = await datosAnexo(c, empresa, sede, mes);
  const e = await encabezado(c, empresa, sede);
  const avisos = revisarInforme(filas, { mesAbierto: hasta >= hoy, hayConfig: !!(config.departamento && config.fondo) });
  const contexto = { periodo: nombreMes(mes), departamento: config.departamento ?? "", droguería: e.nombre, nit: `${e.nit}${e.dv ? `-${e.dv}` : ""}`, sede: e.sede ?? "" };
  return { mes, desde, hasta, filas, totales: totales(filas), avisos, config, encabezado: e, tabla: aplicarPlantilla(filas, config.plantilla, contexto) };
}

/** Estado del plazo del informe del mes anterior (para el aviso del módulo): null si no aplica (sin migración o sin
 *  productos de control especial). Presentado = hay un informe registrado de ese mes (de cualquier sede). */
export async function estadoPlazo(c: Tx, empresa: string, hoy: string) {
  if (!(await moduloListo(c))) return null;
  const p = plazo(hoy);
  const r = (await c.query(`select exists (select 1 from productos where empresa_id = $1 and control_especial) hay,
      exists (select 1 from control_informes where empresa_id = $1 and periodo = $2::date) presentado`, [empresa, `${p.periodo}-01`])).rows[0];
  return r.hay ? { ...p, presentado: !!r.presentado } : null;
}
