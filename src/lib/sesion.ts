import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";

// Sesión firmada en cookie (httpOnly). En producción el usuario entrará con Supabase Auth y aquí se verificará su JWT;
// mientras tanto existe el acceso de demostración con los usuarios sembrados (solo si REGENTA_DEMO=1 o en desarrollo).
export type Sesion = { uid: string; empresa: string; nombre: string; rol: Rol };
export type Rol = "dueno" | "admin" | "cajero" | "bodeguero" | "vendedor";

const COOKIE = "regenta_sesion";
const clave = () => {
  const s = process.env.REGENTA_SESSION_SECRET ?? (process.env.NODE_ENV !== "production" ? "solo-desarrollo-cambiar-en-produccion-0123456789" : "");
  if (s.length < 32) throw new Error("Falta REGENTA_SESSION_SECRET (mínimo 32 caracteres)");
  return new TextEncoder().encode(s);
};

export const demoActiva = () => process.env.REGENTA_DEMO === "1" || process.env.NODE_ENV !== "production";

export async function crearSesion(s: Sesion) {
  const jwt = await new SignJWT({ ...s }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("12h").sign(clave());
  (await cookies()).set(COOKIE, jwt, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 12 * 3600 });
}

export async function leerSesion(): Promise<Sesion | null> {
  const t = (await cookies()).get(COOKIE)?.value;
  if (!t) return null;
  try {
    const { payload } = await jwtVerify(t, clave());
    return { uid: String(payload.uid), empresa: String(payload.empresa), nombre: String(payload.nombre), rol: payload.rol as Rol };
  } catch {
    return null;
  }
}

export async function cerrarSesion() {
  (await cookies()).delete(COOKIE);
}

/** Permisos de interfaz por rol (la base de datos vuelve a comprobarlos siempre). */
export const puede = {
  vender: (r: Rol) => r === "dueno" || r === "admin" || r === "cajero",
  verCostos: (r: Rol) => r === "dueno" || r === "admin",
  moverInventario: (r: Rol) => r === "dueno" || r === "admin" || r === "bodeguero",
  anular: (r: Rol) => r === "dueno" || r === "admin",
  cartera: (r: Rol) => r === "dueno" || r === "admin",
  /** Vender a crédito: quien responde por la cartera. */
  fiar: (r: Rol) => r === "dueno" || r === "admin",
};
