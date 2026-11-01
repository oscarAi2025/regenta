import "server-only";
import "./zod-es";
import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { SignJWT, jwtVerify } from "jose";
import { sinRLS, type Tx } from "./db";
import { mismoOrigen } from "./api";

// Sesión de la consola de superadministración: cookie aparte, 8 horas, SameSite estricto. Cada uso se vuelve a
// comprobar contra la tabla superadmins (quitar a alguien de la tabla le corta el acceso al instante).
export type Admin = { uid: string; nombre: string };
const COOKIE = "regenta_admin";
const clave = () => {
  const s = process.env.REGENTA_SESSION_SECRET ?? (process.env.NODE_ENV !== "production" ? "solo-desarrollo-cambiar-en-produccion-0123456789" : "");
  if (s.length < 32) throw new Error("Falta REGENTA_SESSION_SECRET (mínimo 32 caracteres)");
  return new TextEncoder().encode("admin:" + s);
};

export async function crearSesionAdmin(a: Admin) {
  const jwt = await new SignJWT({ ...a, tipo: "admin" }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("8h").sign(clave());
  (await cookies()).set(COOKIE, jwt, { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 8 * 3600 });
}
export async function cerrarSesionAdmin() { (await cookies()).delete(COOKIE); }

export async function leerAdmin(): Promise<Admin | null> {
  const t = (await cookies()).get(COOKIE)?.value;
  if (!t) return null;
  try {
    const { payload } = await jwtVerify(t, clave());
    if (payload.tipo !== "admin") return null;
    const uid = String(payload.uid);
    const ok = await sinRLS(async (c) => (await c.query(`select 1 from superadmins s join cuentas c on c.id = s.user_id where s.user_id = $1 and c.activa`, [uid])).rowCount);
    return ok ? { uid, nombre: String(payload.nombre) } : null;
  } catch { return null; }
}

/** Registra en la bitácora lo que hace el superadministrador. */
/** Con `tx` se escribe en la misma transacción de la acción: si la bitácora falla, la acción tampoco queda. */
export const evento = (a: Admin, accion: string, empresa: string | null, datos?: unknown, tx?: Tx) => {
  const q = (c: Tx) => c.query(`insert into admin_eventos (cuenta_id, accion, empresa_id, datos) values ($1, $2, $3, $4)`, [a.uid, accion, empresa, datos ? JSON.stringify(datos) : null]);
  return tx ? q(tx) : sinRLS(q);
};

/** Envuelve una ruta de la consola: mismo origen, sesión de superadministrador y errores claros. */
export function conAdmin(fn: (a: Admin, req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>) {
  return async (req: Request, ctx: { params: Promise<Record<string, string>> }) => {
    if (!mismoOrigen(req)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
    const a = await leerAdmin();
    if (!a) return NextResponse.json({ error: "Tu sesión de administrador venció: vuelve a entrar" }, { status: 401 });
    try { return await fn(a, req, ctx); }
    catch (e) {
      const c = (e as { code?: string }).code;
      if (c === "23505") return NextResponse.json({ error: "Ya existe un registro con esos datos (NIT o correo repetido)" }, { status: 409 });
      if (c === "P0001" || c === "23514") return NextResponse.json({ error: (e as Error).message }, { status: 400 });
      if (c === "22P02" || c === "22003" || c === "22007" || c === "22008" || c === "22021" || c === "22001") return NextResponse.json({ error: "Hay un dato fuera de rango o con formato no válido" }, { status: 400 });
      console.error("admin", e);
      return NextResponse.json({ error: "No se pudo completar la acción" }, { status: 500 });
    }
  };
}
