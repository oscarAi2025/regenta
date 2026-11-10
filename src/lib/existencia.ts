import "server-only";
import { puestoDeTrabajo, type Tx } from "./db";
import { ExistenciaInicial } from "./validar";
import type { z } from "zod";

/** Lee la existencia opcional que manda el formulario de producto (lote, vencimiento, unidades, costo). */
export function leerExistencia(cuerpo: unknown) {
  const ex = (cuerpo as { existencia?: unknown } | null)?.existencia;
  return ex == null ? null : ExistenciaInicial.safeParse(ex);
}

/** Entra al inventario un lote con su fecha de vencimiento como inventario inicial, en la sede de la caja de este equipo.
 *  La base revisa todo: permisos, lote vencido, lote existente con otra fecha. */
export async function entrarExistencia(c: Tx, empresa: string, caja: string | null, producto_id: string, e: z.infer<typeof ExistenciaInicial>) {
  const { sede_id } = await puestoDeTrabajo(c, empresa, caja);
  await c.query(`select registrar_entrada($1)`, [{ empresa_id: empresa, sede_id, tipo: "inicial",
    lineas: [{ producto_id, lote: e.lote, vence: e.vence, unidades: e.unidades, ...(e.costo_unidad != null ? { costo_unidad: e.costo_unidad } : {}) }] }]);
}
