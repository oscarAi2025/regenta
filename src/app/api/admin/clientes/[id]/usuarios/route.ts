import { z } from "zod";
import { NextResponse } from "next/server";
import { sinRLS } from "@/lib/db";
import { esUuid } from "@/lib/api";
import { conAdmin, evento } from "@/lib/admin";
import { enlaceInvitacion, invitar } from "@/lib/admin-datos";

const Nuevo = z.object({ nombre: z.string().trim().min(3, "Escribe el nombre").max(120), email: z.string().trim().email("Correo no válido").max(160), rol: z.enum(["dueno", "admin", "cajero", "bodeguero"]) });
const Cambio = z.object({ cuenta_id: z.string().uuid(), activo: z.boolean().optional(), enlace: z.literal(true).optional() });

/** Agregar un usuario a un cliente (con su enlace de invitación). */
export const POST = conAdmin(async (a, req, ctx) => {
  const { id } = await ctx.params;
  if (!esUuid(id)) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const p = Nuevo.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message ?? "Revisa los datos" }, { status: 400 });
  const r = await sinRLS((c) => invitar(c, id, p.data));
  await evento(a, "agregar_usuario", id, { email: p.data.email, rol: p.data.rol });
  return NextResponse.json({ ...r, mensaje: r.enlace ? "Usuario creado: envíale el enlace" : "Usuario agregado (ya tenía contraseña)" }, { status: 201 });
});

/** Activar o desactivar a un usuario en el cliente, o generarle un enlace nuevo para poner contraseña. */
export const PATCH = conAdmin(async (a, req, ctx) => {
  const { id } = await ctx.params;
  if (!esUuid(id)) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const p = Cambio.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Datos no válidos" }, { status: 400 });
  const r = await sinRLS(async (c) => {
    const ok = (await c.query(`select 1 from miembros where empresa_id = $1 and user_id = $2`, [id, p.data.cuenta_id])).rowCount;
    if (!ok) return null;
    if (p.data.activo !== undefined) await c.query(`update miembros set activo = $3 where empresa_id = $1 and user_id = $2`, [id, p.data.cuenta_id, p.data.activo]);
    if (p.data.enlace) {
      await c.query(`update cuentas set clave_hash = null where id = $1 and not exists (select 1 from superadmins where user_id = $1)`, [p.data.cuenta_id]); // el enlace reemplaza la contraseña olvidada
      return { enlace: await enlaceInvitacion(c, p.data.cuenta_id) };
    }
    return {};
  });
  if (!r) return NextResponse.json({ error: "Ese usuario no es de este cliente" }, { status: 404 });
  await evento(a, p.data.enlace ? "nuevo_enlace" : p.data.activo ? "activar_usuario" : "desactivar_usuario", id, { cuenta: p.data.cuenta_id });
  return NextResponse.json({ ok: true, ...r, mensaje: "enlace" in r ? "Enlace nuevo generado" : "Guardado" });
});
