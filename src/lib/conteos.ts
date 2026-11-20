import "server-only";
import type { Tx } from "./db";
import { ubicacionSql } from "./ubicacion";

export type LineaConteo = {
  id: number; producto_id: string; nombre: string; laboratorio: string | null; ean: string | null; unidades_por_caja: number;
  lote_id: string; lote: string; vence: string | null; vencido: boolean; contado: number | null; sistema: number; costo: number | null; nuevo: boolean;
  /** Conteo a ciegas abierto, visto por quien no es la gerencia: «sistema» viene en 0 y no se muestra. */
  oculto: boolean;
};

/** Líneas de un conteo. Abierto: contra las existencias de este momento; cerrado: contra la foto que guardó el cierre.
 *  Conteo a ciegas abierto: a quien no es dueño ni administrador no se le entrega lo del sistema (`oculto`).
 *  El costo sale de lote_costos (la seguridad por fila solo se lo deja ver a la gerencia; `costos` evita pedirlo). */
export async function lineasConteo(c: Tx, conteo: string, costos: boolean): Promise<LineaConteo[]> {
  const U = await ubicacionSql(c);
  return (await c.query(
    `select cl.id::int, cl.producto_id, p.nombre, p.laboratorio, p.ean, ${U} ubicacion, p.unidades_por_caja, cl.lote_id, l.lote, l.vence::text,
            coalesce(l.vence < (now() at time zone 'America/Bogota')::date, false) vencido, cl.contado, cl.nuevo,
            -- Referencia de la diferencia: cerrado → la guardada al cerrar; abierto → la del momento en que se contó la línea
            -- (lo vendido después no cuenta como faltante), o la de ahora si aún no se cuenta.
            (k.a_ciegas and k.estado = 'abierto' and not $2) oculto,
            case when k.a_ciegas and k.estado = 'abierto' and not $2 then 0
                 when k.estado = 'cerrado' then coalesce(cl.sistema, 0)
                 when cl.contado is not null and cl.sistema_al_contar is not null then cl.sistema_al_contar
                 else coalesce((select s.unidades from v_stock_lotes s where s.lote_id = cl.lote_id), 0) end::int sistema,
            ${costos ? "(select lc.costo_unidad::float from lote_costos lc where lc.lote_id = cl.lote_id)" : "null::float"} costo
     from conteo_lineas cl join conteos k on k.id = cl.conteo_id join productos p on p.id = cl.producto_id join lotes l on l.id = cl.lote_id
     where cl.conteo_id = $1 order by ${U} nulls last, p.nombre, l.vence nulls last, l.lote` /* en el orden de la estantería */, [conteo, costos])).rows;
}

/** Causas de una diferencia de conteo (lo que la droguería explica de cada error). */
export const CAUSAS: Record<string, string> = {
  error_conteo: "Error de conteo", error_ingreso: "Error al ingresar al sistema", venta_sin_descargar: "Venta o pedido que no se descargó",
  no_llego: "Compra registrada que no llegó", pedido_no_entregado: "Pedido que el cliente no recibió", devolucion_sin_registrar: "Devolución sin registrar",
  muestra: "Muestra u obsequio sin registrar", averia: "Avería o rotura", vencido: "Vencido sin dar de baja", trueque: "Cruce con otro producto o lote",
  perdida: "Pérdida o robo", otro: "Otra causa",
};
export const CAUSA_IDS = Object.keys(CAUSAS) as [string, ...string[]];

export type Justificacion = { linea_id: number; causa: string; detalle: string; documento: string | null; usuario: string | null; fecha: string; anteriores: number };

/** La explicación vigente de cada línea (la última) y cuántas hubo antes. Tolera que la migración 056 aún no esté. */
export async function justificaciones(c: Tx, conteo: string): Promise<Map<number, Justificacion>> {
  const hay = (await c.query(`select to_regclass('public.conteo_justificaciones') is not null t`)).rows[0].t;
  if (!hay) return new Map();
  const filas = (await c.query(`select distinct on (j.linea_id) j.linea_id::int, j.causa, j.detalle, j.documento, mi.nombre usuario,
      to_char(j.creado at time zone 'America/Bogota', 'DD/MM/YYYY HH24:MI') fecha, (count(*) over (partition by j.linea_id) - 1)::int anteriores
    from conteo_justificaciones j left join miembros mi on mi.empresa_id = j.empresa_id and mi.user_id = j.usuario_id
    where j.conteo_id = $1 order by j.linea_id, j.creado desc, j.id desc`, [conteo])).rows as Justificacion[];
  return new Map(filas.map((f) => [f.linea_id, f]));
}
