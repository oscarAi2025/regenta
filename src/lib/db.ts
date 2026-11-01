import "server-only";
import pg from "pg";
import type { Sesion } from "./sesion";

// Una sola conexión al Postgres (local o Supabase). Las consultas de usuario corren SIEMPRE como «authenticated»
// con sus claims, igual que en Supabase: la seguridad por fila decide qué ve. La conexión privilegiada (sinRLS)
// solo la usan procesos internos del servidor (cola DIAN, consola Regenta).
const g = globalThis as unknown as { __regentaPool?: pg.Pool };
export const pool = (g.__regentaPool ??= new pg.Pool({
  connectionString: process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/regenta?host=/tmp",
  max: 10,
}));

export type Tx = pg.PoolClient;

/** Ejecuta fn como el usuario de la sesión, en una transacción. */
export async function comoUsuario<T>(s: Pick<Sesion, "uid">, fn: (c: Tx) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: s.uid, role: "authenticated" })]);
    await c.query("set local role authenticated");
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** Conexión del servidor sin RLS: solo para procesos internos. */
export async function sinRLS<T>(fn: (c: Tx) => Promise<T>): Promise<T> {
  const c = await pool.connect();
  try {
    await c.query("begin");
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback").catch(() => {});
    throw e;
  } finally {
    c.release();
  }
}

/** Mensaje legible de un error lanzado por la base de datos (errores de negocio con código P0001 o permisos 42501). */
export function mensajeError(e: unknown): { status: number; error: string } {
  const err = e as { code?: string; message?: string };
  if (err?.code === "P0001") return { status: 422, error: err.message ?? "Operación no válida" };
  if (err?.code === "42501") return { status: 403, error: /permission denied|row-level security/.test(err.message ?? "") ? "No tienes permiso para esta acción" : err.message ?? "Sin permiso" };
  console.error(e);
  return { status: 500, error: "Error interno. Inténtalo de nuevo." };
}
