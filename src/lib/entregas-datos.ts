import "server-only";
import type { Tx } from "./db";
import type { Rol } from "./sesion";
import { ubicacionSql } from "./ubicacion";

// Entregas internas (modo droguería interna): consultas del servidor. Las escrituras van solo por registrar_entrega y
// anular_entrega (migración 049).

/** Quién trabaja con entregas: la gerencia, la caja (auxiliar de farmacia) y la bodega. Anular, solo la gerencia. */
export const puedeEntregar = (r: Rol) => r === "dueno" || r === "admin" || r === "cajero" || r === "bodeguero";
export const puedeAnularEntrega = (r: Rol) => r === "dueno" || r === "admin";

export type FilaEntrega = {
  id: string; numero: number; fecha: string; destinatario_tipo: string; destinatario: string; documento: string | null; servicio: string | null;
  autoriza: string; observacion: string | null; unidades: number; productos: number; anulada: string | null; anulada_motivo: string | null; usuario: string;
};

const CAMPOS = `en.id, en.numero, to_char(en.creado at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI') fecha, en.destinatario_tipo, en.destinatario,
  en.documento, en.servicio, en.autoriza, en.observacion, en.unidades,
  (select count(distinct el.producto_id) from entrega_lineas el where el.entrega_id = en.id)::int productos,
  to_char(en.anulada at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI') anulada, en.anulada_motivo,
  split_part(coalesce(mi.nombre, '—'), ' (', 1) usuario`;

/** Entregas del rango (más recientes primero). `q` busca en destinatario, documento, servicio y quien autoriza. */
export async function listaEntregas(c: Tx, empresa: string, desde: string, hasta: string, q = ""): Promise<FilaEntrega[]> {
  const w = q.trim().slice(0, 60);
  return (await c.query(`select ${CAMPOS}
    from entregas en left join miembros mi on mi.user_id = en.usuario_id and mi.empresa_id = en.empresa_id
    where en.empresa_id = $1 and (en.creado at time zone 'America/Bogota')::date between $2::date and $3::date
      and ($4 = '' or en.destinatario ilike '%' || $4 || '%' or en.documento ilike '%' || $4 || '%' or en.servicio ilike '%' || $4 || '%'
           or en.autoriza ilike '%' || $4 || '%' or ('EI-' || en.numero) ilike $4)
    order by en.creado desc limit 1000`, [empresa, desde, hasta, w])).rows;
}

/** Consumo del rango (sin las entregas anuladas): por servicio o área y por producto. */
export async function consumo(c: Tx, empresa: string, desde: string, hasta: string) {
  const filtro = `en.empresa_id = $1 and en.anulada is null and (en.creado at time zone 'America/Bogota')::date between $2::date and $3::date`;
  const servicio = `coalesce(en.servicio, case when en.destinatario_tipo in ('servicio', 'sede') then en.destinatario else 'Sin servicio' end)`;
  const porServicio = (await c.query(`select ${servicio} servicio, count(*)::int entregas, sum(en.unidades)::int unidades
    from entregas en where ${filtro} group by 1 order by 3 desc, 1 limit 200`, [empresa, desde, hasta])).rows as { servicio: string; entregas: number; unidades: number }[];
  const porProducto = (await c.query(`select p.id, p.nombre, p.unidades_por_caja, sum(el.unidades)::int unidades, count(distinct en.id)::int entregas
    from entregas en join entrega_lineas el on el.entrega_id = en.id join productos p on p.id = el.producto_id
    where ${filtro} group by p.id order by 4 desc, 2 limit 500`, [empresa, desde, hasta])).rows as { id: string; nombre: string; unidades_por_caja: number; unidades: number; entregas: number }[];
  return { porServicio, porProducto, entregas: porServicio.reduce((a, x) => a + x.entregas, 0), unidades: porServicio.reduce((a, x) => a + x.unidades, 0) };
}

/** Una entrega con sus líneas (producto, lote y vencimiento), su fórmula y los datos del comprobante. */
export async function detalleEntrega(c: Tx, empresa: string, id: string) {
  const e = (await c.query(`select ${CAMPOS}, s.nombre sede, s.ciudad, coalesce(em.nombre_comercial, em.razon_social) empresa, em.razon_social, em.nit, em.dv, em.direccion,
      split_part(coalesce(ma.nombre, ''), ' (', 1) anulo
    from entregas en join sedes s on s.id = en.sede_id join empresas em on em.id = en.empresa_id
    left join miembros mi on mi.user_id = en.usuario_id and mi.empresa_id = en.empresa_id
    left join miembros ma on ma.user_id = en.anulada_por and ma.empresa_id = en.empresa_id
    where en.id = $1 and en.empresa_id = $2`, [id, empresa])).rows[0] as (FilaEntrega & { sede: string; ciudad: string | null; empresa: string; razon_social: string; nit: string; dv: string | null; direccion: string | null; anulo: string }) | undefined;
  if (!e) return null;
  const U = await ubicacionSql(c);
  const lineas = (await c.query(`select el.producto_id, el.descripcion, el.presentacion, el.cantidad::float, el.unidades, p.unidades_por_caja, lo.lote, lo.vence::text vence,
      p.control_especial, p.requiere_formula, ${U} ubicacion
    from entrega_lineas el join lotes lo on lo.id = el.lote_id join productos p on p.id = el.producto_id
    where el.entrega_id = $1 order by el.id`, [id])).rows as { producto_id: string; descripcion: string; presentacion: string; cantidad: number; unidades: number;
      unidades_por_caja: number; lote: string; vence: string | null; control_especial: boolean; requiere_formula: boolean; ubicacion: string | null }[];
  const formula = (await c.query(`select bool_or(control) control, max(paciente_tipo_doc) paciente_tipo_doc, max(paciente_doc) paciente_doc, max(paciente_nombre) paciente_nombre,
      max(medico_nombre) medico_nombre, max(medico_registro) medico_registro, max(formula_numero) formula_numero, max(formula_fecha)::text formula_fecha, count(*)::int productos
    from entrega_formulas where entrega_id = $1`, [id])).rows[0] as { control: boolean | null; paciente_tipo_doc: string | null; paciente_doc: string | null; paciente_nombre: string | null;
      medico_nombre: string | null; medico_registro: string | null; formula_numero: string | null; formula_fecha: string | null; productos: number };
  return { entrega: e, lineas, formula: formula.productos ? formula : null };
}

/** Columnas del Excel de entregas. */
export const COLUMNAS_ENTREGAS: [string, string][] = [
  ["numero", "Entrega"], ["fecha", "Fecha y hora"], ["tipo", "Se entregó a"], ["destinatario", "Quién recibe"], ["documento", "Documento"],
  ["servicio", "Servicio o área"], ["autoriza", "Autoriza"], ["producto", "Producto"], ["lote", "Lote"], ["vence", "Vence"], ["unidades", "Unidades"],
  ["usuario", "Registró"], ["estado", "Estado"],
];

/** Una fila por lote entregado, para el Excel del rango. */
export async function lineasRango(c: Tx, empresa: string, desde: string, hasta: string) {
  return (await c.query(`select 'EI-' || en.numero numero, to_char(en.creado at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI') fecha, en.destinatario_tipo,
      en.destinatario, en.documento, en.servicio, en.autoriza, el.descripcion producto, lo.lote, lo.vence::text vence, el.unidades,
      split_part(coalesce(mi.nombre, '—'), ' (', 1) usuario,
      case when en.anulada is null then 'Entregada' else 'Anulada: ' || en.anulada_motivo end estado
    from entregas en join entrega_lineas el on el.entrega_id = en.id join lotes lo on lo.id = el.lote_id
    left join miembros mi on mi.user_id = en.usuario_id and mi.empresa_id = en.empresa_id
    where en.empresa_id = $1 and (en.creado at time zone 'America/Bogota')::date between $2::date and $3::date
    order by en.creado, el.id limit 20000`, [empresa, desde, hasta])).rows as Record<string, unknown>[];
}
