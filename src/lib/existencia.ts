import "server-only";
import { puestoDeTrabajo, type Tx } from "./db";
import { ExistenciaInicial } from "./validar";
import type { z } from "zod";

/** Lee la existencia opcional que manda el formulario de producto (lote, vencimiento, unidades, costo). */
export function leerExistencia(cuerpo: unknown) {
  const ex = (cuerpo as { existencia?: unknown } | null)?.existencia;
  return ex == null ? null : ExistenciaInicial.safeParse(ex);
}

/** El costo del lote no cuadra con el precio de venta: se devuelve al formulario como error 400 con su explicación. */
export class CostoNoCuadra extends Error { code = "P0001"; }

/** Entra al inventario un lote con su fecha de vencimiento como inventario inicial, en la sede de la caja de este equipo.
 *  La base revisa todo: permisos, lote vencido, lote existente con otra fecha. */
export async function entrarExistencia(c: Tx, empresa: string, caja: string | null, producto_id: string, e: z.infer<typeof ExistenciaInicial>) {
  if (e.costo_unidad != null) {
    // El costo por unidad no puede pasar de 3 veces el precio de venta por unidad sin IVA: casi siempre es el costo de la caja
    // escrito como costo por unidad (11/11/2026: costo $31.280 «por unidad» de una caja x 500 que se vende a $74 la unidad).
    const p = (await c.query(`select unidades_por_caja::int upc, round(coalesce(precio_unidad, precio_caja / greatest(unidades_por_caja, 1)) / (1 + iva / 100.0), 2)::float pu
      from productos where id = $1 and empresa_id = $2`, [producto_id, empresa])).rows[0] as { upc: number; pu: number } | undefined;
    if (p && p.pu > 0 && e.costo_unidad > p.pu * 3) {
      const $ = (n: number) => "$" + Math.round(n).toLocaleString("es-CO");
      throw new CostoNoCuadra(`El costo por unidad (${$(e.costo_unidad)}) es mucho mayor que el precio de venta por unidad sin IVA (${$(p.pu)})${p.upc > 1 ? `: si es el costo de la caja, elige «Costo por caja» (${$(e.costo_unidad / p.upc)} por unidad)` : ": revisa el costo"}`);
    }
  }
  const { sede_id } = await puestoDeTrabajo(c, empresa, caja);
  await c.query(`select registrar_entrada($1)`, [{ empresa_id: empresa, sede_id, tipo: "inicial",
    lineas: [{ producto_id, lote: e.lote, vence: e.vence, unidades: e.unidades, ...(e.costo_unidad != null ? { costo_unidad: e.costo_unidad } : {}) }] }]);
}
