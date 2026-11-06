import "server-only";
import pg from "pg";
import type { Sesion } from "./sesion";
import { SUPABASE_ROOT_2021 } from "./supabase-ca";

// Una sola conexión al Postgres (local o Supabase). Las consultas de usuario corren SIEMPRE como «authenticated»
// con sus claims, igual que en Supabase: la seguridad por fila decide qué ve. La conexión privilegiada (sinRLS)
// solo la usan procesos internos del servidor (cola DIAN, consola Regenta).
const g = globalThis as unknown as { __regentaPool?: pg.Pool };
// Producción (Supabase): DATABASE_URL = pooler en modo transacción (puerto 6543). Ese modo no acepta parámetros de
// arranque, así que la zona horaria va en la base (migración 013) y en cada transacción. El certificado de Supabase lo
// firma su propia CA: se pega en DATABASE_CA (PEM, se descarga del panel) y la conexión se verifica siempre.
// La contraseña puede ir aparte en DATABASE_PASSWORD (se pega tal cual la genera Supabase, sin armar la URL a mano).
function conClave(u: string, clave?: string) {
  if (!clave) return u;
  const x = new URL(u);
  x.password = encodeURIComponent(clave.trim());
  return x.toString();
}
const url = conClave(process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/regenta?host=/tmp", process.env.DATABASE_PASSWORD);
const remota = !/localhost|127\.0\.0\.1|host=\/tmp/.test(url);

/** Rearma un PEM que llega de un panel de variables: con «\n» literales, espacios en vez de saltos o sin saltos. */
export function normalizarPem(v: string | undefined): string[] {
  if (!v) return [];
  return [...v.replace(/\\r|\\n/g, "\n").matchAll(/-----BEGIN CERTIFICATE-----([\s\S]*?)-----END CERTIFICATE-----/g)].map((m) => {
    const cuerpo = m[1].replace(/[^A-Za-z0-9+/=]/g, "");
    return `-----BEGIN CERTIFICATE-----\n${cuerpo.match(/.{1,64}/g)?.join("\n")}\n-----END CERTIFICATE-----\n`;
  });
}
// Con Supabase se confía además en su CA raíz pública (incluida en el código): si DATABASE_CA llega mal pegada, la
// conexión sigue verificándose contra la CA correcta en vez de caer.
const cas = [...normalizarPem(process.env.DATABASE_CA), ...(/supabase\.(com|co)/.test(url) ? [SUPABASE_ROOT_2021] : [])];
if (process.env.DATABASE_CA && !normalizarPem(process.env.DATABASE_CA).length) console.error("DATABASE_CA no contiene un certificado PEM legible");
export const pool = (g.__regentaPool ??= new pg.Pool({
  connectionString: url.replace(/[?&]sslmode=[^&]*/g, ""),
  max: remota ? 3 : 10, // en funciones serverless cada instancia abre pocas conexiones: el pooler reparte
  idleTimeoutMillis: remota ? 60000 : 30000, // reabrir una conexión TLS al pooler cuesta varias idas: se conserva más
  ...(remota
    ? { ssl: cas.length ? { ca: cas, rejectUnauthorized: true } : { rejectUnauthorized: true } }
    : { options: "-c timezone=America/Bogota" }), // «hoy» es el día de Bogotá en todas las consultas
}));

// Si la base cierra una conexión inactiva (reinicio, mantenimiento de Supabase), el pool la descarta y abre otra:
// sin este manejador, Node trataría el error como no capturado y tumbaría el servidor.
if (!(g as { __regentaPoolErr?: boolean }).__regentaPoolErr) {
  pool.on("error", (e) => console.error("Conexión inactiva cerrada por la base de datos:", (e as Error).message));
  (g as { __regentaPoolErr?: boolean }).__regentaPoolErr = true;
}

export type Tx = pg.PoolClient;

// Diagnóstico: con REGENTA_SQL_TIEMPOS=1 cada consulta escribe en el registro cuánto tardó (para encontrar las lentas).
const medir = (c: Tx) => {
  if (!process.env.REGENTA_SQL_TIEMPOS || (c as { __medido?: boolean }).__medido) return c;
  const q = c.query.bind(c) as (...a: unknown[]) => Promise<unknown>;
  (c as unknown as { query: unknown }).query = async (...a: unknown[]) => {
    const t = performance.now(); const r = await q(...a);
    const sql = String(typeof a[0] === "string" ? a[0] : (a[0] as { text?: string })?.text).replace(/\s+/g, " ").slice(0, 110);
    console.log(`[sql ${Math.round(performance.now() - t)} ms] ${sql}`);
    return r;
  };
  (c as { __medido?: boolean }).__medido = true;
  return c;
};

/** Ejecuta fn como el usuario de la sesión, en una transacción. El arranque (transacción, identidad del usuario, rol y
 *  zona horaria) va en UNA sola ida a la base: con la base lejos del servidor, cada ida cuenta. */
export async function comoUsuario<T>(s: Pick<Sesion, "uid"> & { soporte?: string }, fn: (c: Tx) => Promise<T>): Promise<T> {
  const c = medir(await pool.connect());
  try {
    // `soporte`: el superadministrador que entró como el cliente; la auditoría lo guarda junto al usuario (037).
    const claims = c.escapeLiteral(JSON.stringify({ sub: s.uid, role: "authenticated", ...(s.soporte ? { soporte: s.soporte } : {}) }));
    await c.query(`begin; select set_config('request.jwt.claims', ${claims}, true); set local role authenticated; set local timezone = 'America/Bogota'`);
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
  const c = medir(await pool.connect());
  try {
    await c.query("begin; set local timezone = 'America/Bogota'");
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
  if (err?.code === "22P02" || err?.code === "23514" || err?.code === "22007" || err?.code === "22008" || err?.code === "22003" || err?.code === "22021" || err?.code === "22001") return { status: 400, error: "Hay un dato con formato no válido" };
  if (err?.code === "23505") return { status: 409, error: "Ese registro ya existe" };
  if (err?.code === "40P01" || err?.code === "40001") return { status: 409, error: "Otra operación estaba usando los mismos productos. Intenta de nuevo." };
  console.error(e);
  return { status: 500, error: "Error interno. Inténtalo de nuevo." };
}

/** Escapa los comodines de LIKE (% _ \\) en lo que escribe el usuario. */
export const sinComodines = (w: string) => w.replace(/[\\%_]/g, (m) => "\\" + m);

/** Sede y caja de trabajo: la caja que eligió este equipo (si es de la empresa y está activa) o la primera caja activa. */
export async function puestoDeTrabajo(c: Tx, empresa: string, cajaElegida?: string | null): Promise<{ sede_id: string; caja_id: string | null }> {
  if (cajaElegida && /^[0-9a-f-]{36}$/i.test(cajaElegida)) {
    const e = (await c.query(`select id, sede_id from cajas where id = $1 and empresa_id = $2 and activa`, [cajaElegida, empresa])).rows[0];
    if (e) return { sede_id: e.sede_id, caja_id: e.id };
  }
  const caja = (await c.query(`select id, sede_id from cajas where empresa_id = $1 and activa order by nombre, id limit 1`, [empresa])).rows[0];
  if (caja) return { sede_id: caja.sede_id, caja_id: caja.id };
  const sede = (await c.query(`select id from sedes where empresa_id = $1 order by creado limit 1`, [empresa])).rows[0];
  if (!sede) throw Object.assign(new Error("La empresa no tiene sedes configuradas"), { code: "P0001" });
  return { sede_id: sede.id, caja_id: null };
}
