import { z } from "zod";
import { comoUsuario, mensajeError } from "@/lib/db";
import { conSesion, json } from "@/lib/api";
import { puedeCompras } from "@/lib/compras";
import { cuentasPorPagar, listaProveedores } from "@/lib/compras-datos";
import { dvNit, nitSinDv } from "@/lib/validar";

const texto = (max: number) => z.string().trim().max(max).nullish().transform((v) => v || null);
const Datos = z.object({
  nombre: z.string().trim().min(2, "Escribe el nombre del proveedor").max(160),
  nit: z.string().trim().max(20).nullish().transform((v) => (v ? nitSinDv(v) : null)).refine((v) => !v || /^\d{5,12}$/.test(v), "El NIT va con 5 a 12 números, sin dígito de verificación"),
  telefono: texto(30), email: z.string().trim().email("Correo no válido").max(160).nullish().or(z.literal("")).transform((v) => v || null),
  contacto: texto(120), direccion: texto(160), ciudad: texto(80),
  plazo_dias: z.number().int("El plazo va en días").min(0).max(365, "El plazo máximo es 365 días").nullish(),
  responsable_iva: z.boolean().default(true), obligado_facturar: z.boolean().default(true),
});
const Cambio = Datos.partial().extend({ id: z.string().uuid(), activo: z.boolean().optional() });

const respuesta = (e: unknown) => {
  const m = mensajeError(e);
  return json({ error: m.status === 409 ? "Ya tienes un proveedor con ese nombre" : m.error }, m.status);
};

/** Proveedores (dueño, administrador y bodega). Con ?id= la ficha con historial; el saldo y los pagos solo la gerencia. */
export const GET = conSesion(async (s, req) => {
  if (!puedeCompras.ver(s.rol)) return json({ error: "Los proveedores los ven el dueño, el administrador o la bodega" }, 403);
  const id = new URL(req.url).searchParams.get("id");
  const dinero = puedeCompras.dinero(s.rol);
  if (id) {
    if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) return json({ error: "Proveedor no válido" }, 400);
    const r = await comoUsuario(s, async (c) => {
      const p = (await listaProveedores(c, s.empresa, dinero, id))[0];
      if (!p) return null;
      return { proveedor: p, cuentas: dinero ? await cuentasPorPagar(c, s.empresa, id) : [] };
    });
    return r ? json(r) : json({ error: "Ese proveedor no existe en tu droguería" }, 404);
  }
  return json({ proveedores: await comoUsuario(s, (c) => listaProveedores(c, s.empresa, dinero)) });
});

/** Crear un proveedor (dueño, administrador o bodega). */
export const POST = conSesion(async (s, req) => {
  if (!puedeCompras.ver(s.rol)) return json({ error: "Solo el dueño, el administrador o la bodega crean proveedores" }, 403);
  const p = Datos.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Datos del proveedor incompletos" }, 400);
  const d = p.data;
  try {
    const r = await comoUsuario(s, async (c) => {
      const id = (await c.query(`insert into proveedores (empresa_id, nombre, nit, dv, telefono, email, contacto, direccion, ciudad, plazo_dias, responsable_iva, obligado_facturar)
        values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id`,
        [s.empresa, d.nombre, d.nit, d.nit ? dvNit(d.nit) : null, d.telefono, d.email, d.contacto, d.direccion, d.ciudad, d.plazo_dias ?? null, d.responsable_iva, d.obligado_facturar])).rows[0].id;
      return (await listaProveedores(c, s.empresa, puedeCompras.dinero(s.rol), id))[0];
    });
    return json({ proveedor: r }, 201);
  } catch (e) { return respuesta(e); }
});

/** Corregir los datos de un proveedor o desactivarlo (dueño o administrador). */
export const PATCH = conSesion(async (s, req) => {
  if (!puedeCompras.dinero(s.rol)) return json({ error: "Solo el dueño o el administrador cambian los datos de un proveedor" }, 403);
  const p = Cambio.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Datos del proveedor incompletos" }, 400);
  const { id, ...d } = p.data;
  const campos = Object.entries({ ...d, ...(d.nit !== undefined ? { dv: d.nit ? dvNit(d.nit) : null } : {}) }).filter(([, v]) => v !== undefined);
  if (!campos.length) return json({ error: "No hay cambios" }, 400);
  try {
    const r = await comoUsuario(s, async (c) => {
      const n = await c.query(`update proveedores set ${campos.map(([k], i) => `${k} = $${i + 3}`).join(", ")} where id = $1 and empresa_id = $2`, [id, s.empresa, ...campos.map(([, v]) => v)]);
      return n.rowCount ? (await listaProveedores(c, s.empresa, true, id))[0] : null;
    });
    return r ? json({ proveedor: r }) : json({ error: "Ese proveedor no existe en tu droguería" }, 404);
  } catch (e) { return respuesta(e); }
});
