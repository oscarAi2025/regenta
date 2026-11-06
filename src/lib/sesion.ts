import "server-only";
import { cookies } from "next/headers";
import { SignJWT, jwtVerify } from "jose";
import { cache } from "react";
import { sinRLS } from "./db";

// Sesión firmada en cookie (httpOnly). En producción el usuario entrará con Supabase Auth y aquí se verificará su JWT;
// mientras tanto existe el acceso de demostración con los usuarios sembrados (solo si REGENTA_DEMO=1 o en desarrollo).
export type Sesion = { uid: string; empresa: string; nombre: string; rol: Rol; soporte?: string };
export type Rol = "dueno" | "admin" | "cajero" | "bodeguero" | "vendedor";

const COOKIE = "regenta_sesion";
const clave = () => {
  const s = process.env.REGENTA_SESSION_SECRET ?? (process.env.NODE_ENV !== "production" ? "solo-desarrollo-cambiar-en-produccion-0123456789" : "");
  if (s.length < 32) throw new Error("Falta REGENTA_SESSION_SECRET (mínimo 32 caracteres)");
  return new TextEncoder().encode(s);
};

export const demoActiva = () => process.env.REGENTA_DEMO === "1" || process.env.NODE_ENV !== "production";

/** Usuarios sembrados de la droguería de demostración: los únicos con los que se entra sin contraseña. */
export const USUARIOS_DEMO = { dueno: "00000000-0000-4000-8000-000000000001", cajero: "00000000-0000-4000-8000-000000000002", bodega: "00000000-0000-4000-8000-000000000003" } as const;

/** Crea la sesión. `soporte` = id del superadministrador que entra como el cliente (dura 1 hora y depende de que siga
 *  siendo superadministrador). La versión de la cuenta va en la sesión: si cambia (contraseña nueva), la sesión muere. */
export async function crearSesion(s: Sesion) {
  const v = (await sinRLS((c) => c.query(`select version_sesion v from cuentas where id = $1`, [s.uid]))).rows[0]?.v ?? 0;
  const horas = s.soporte ? 1 : 12;
  const jwt = await new SignJWT({ ...s, v }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime(`${horas}h`).sign(clave());
  (await cookies()).set(COOKIE, jwt, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: horas * 3600 });
}

/** Lee la sesión y la vuelve a comprobar en la base en cada petición: empresa activa, miembro activo, cuenta activa,
 *  misma versión de contraseña y, si es soporte, que siga siendo superadministrador. El rol sale de la base (un cambio
 *  de rol aplica al instante). */
export const leerSesion = cache(async (): Promise<Sesion | null> => {
  const t = (await cookies()).get(COOKIE)?.value;
  if (!t) return null;
  let payload;
  try { payload = (await jwtVerify(t, clave())).payload; } catch { return null; }
  const uid = String(payload.uid), empresa = String(payload.empresa), soporte = payload.soporte ? String(payload.soporte) : undefined;
  if (!/^[0-9a-f-]{36}$/i.test(uid) || !/^[0-9a-f-]{36}$/i.test(empresa)) return null;
  const f = (await sinRLS((c) => c.query(
    `select m.rol, e.estado, cu.activa, coalesce(cu.version_sesion, 0) v,
            ($3::uuid is null or exists (select 1 from superadmins s join cuentas a on a.id = s.user_id where s.user_id = $3::uuid and a.activa)) soporte_ok
     from miembros m join empresas e on e.id = m.empresa_id left join cuentas cu on cu.id = m.user_id
     where m.empresa_id = $1 and m.user_id = $2 and m.activo`, [empresa, uid, soporte ?? null]))).rows[0];
  if (!f || f.estado !== "activa" || f.activa === false || !f.soporte_ok || f.v !== Number(payload.v ?? 0)) return null;
  return { uid, empresa, nombre: String(payload.nombre), rol: f.rol as Rol, soporte };
});

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
  /** Vender a crédito: la gerencia (también a clientes sin cupo, o pasándose con un motivo) y la cajera dentro del cupo
   *  del cliente. La base (registrar_venta → credito_cliente) es la que decide cada venta. */
  fiar: (r: Rol) => r === "dueno" || r === "admin" || r === "cajero",
};
