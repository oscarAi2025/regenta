import "server-only";
import type { Tx } from "./db";

// Operaciones con dinero que no deben repetirse por un doble clic o un reintento de red (recibos, abonos, devoluciones,
// movimientos de caja). La pantalla manda una `idem_key` por operación; la primera vez se ejecuta y se guarda el
// resultado, y las siguientes con la misma clave devuelven ese resultado sin volver a ejecutar. Todo en la misma
// transacción de la operación, con un candado por clave para que dos peticiones simultáneas no pasen a la vez.
export async function idempotente<T>(c: Tx, empresa: string, clave: string | null | undefined, fn: () => Promise<T>): Promise<T> {
  if (!clave) return fn();
  await c.query(`select pg_advisory_xact_lock(hashtext($1))`, [`${empresa}:idem:${clave}`]);
  const ya = (await c.query(`select resultado from operaciones_idem where empresa_id = $1 and clave = $2`, [empresa, clave])).rows[0];
  if (ya) return ya.resultado as T;
  const r = await fn();
  if (r !== null && r !== undefined) await c.query(`insert into operaciones_idem (empresa_id, clave, resultado) values ($1, $2, $3)`, [empresa, clave, JSON.stringify(r)]);
  return r;
}

/** Clave de idempotencia que manda la pantalla: un UUID o similar, corto. */
export const claveIdem = (v: unknown): string | null => (typeof v === "string" && /^[A-Za-z0-9-]{8,64}$/.test(v) ? v : null);
