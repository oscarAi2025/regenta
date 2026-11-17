import "server-only";
import type { Tx } from "./db";

/** Modo de la droguería: 'venta' (caja, factura y DIAN) o 'interno' (entregas, sin DIAN). Lo cambia solo la consola.
 *  Se lee sin nombrar la columna: antes de la migración 049 devuelve 'venta' y nada se rompe. */
export type Modo = "venta" | "interno";
export const SQL_MODO = `coalesce(to_jsonb(e) ->> 'modo', 'venta')`;
export async function modoDe(c: Pick<Tx, "query">, empresa: string): Promise<Modo> {
  const m = (await c.query(`select ${SQL_MODO} modo from empresas e where e.id = $1`, [empresa])).rows[0]?.modo;
  return m === "interno" ? "interno" : "venta";
}
