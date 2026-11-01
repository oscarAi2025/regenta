import { z } from "zod";
import { NextResponse } from "next/server";
import { sinRLS } from "@/lib/db";
import { esUuid } from "@/lib/api";
import { conAdmin, evento } from "@/lib/admin";
import { enlaceInvitacion, invitar } from "@/lib/admin-datos";
import { encolar, enviarAhora } from "@/lib/correo";

const Nuevo = z.object({ nombre: z.string().trim().min(3, "Escribe el nombre").max(120), email: z.string().trim().email("Correo no válido").max(160), rol: z.enum(["dueno", "admin", "cajero", "bodeguero"]) });
const Cambio = z.object({ cuenta_id: z.string().uuid(), activo: z.boolean().optional(), enlace: z.literal(true).optional() });

/** Agregar un usuario a un cliente (con su enlace de invitación). */
export const POST = conAdmin(async (a, req, ctx) => {
  const { id } = await ctx.params;
  if (!esUuid(id)) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const p = Nuevo.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message ?? "Revisa los datos" }, { status: 400 });
  const r = await sinRLS(async (c) => {
    const inv = await invitar(c, id, p.data);
    const correo = inv.enlace ? `invitacion:${inv.cuenta_id}:${Date.now()}` : null;
    if (correo) {
      const empresa = (await c.query(`select coalesce(nombre_comercial, razon_social) n from empresas where id = $1`, [id])).rows[0]?.n;
      await encolar(c, { clave: correo, para: p.data.email, plantilla: "invitacion", empresa: id, datos: { nombre: p.data.nombre, empresa, enlace: inv.enlace } });
    }
    return { ...inv, correo };
  });
  if (r.correo) await enviarAhora(r.correo);
  await evento(a, "agregar_usuario", id, { email: p.data.email, rol: p.data.rol });
  return NextResponse.json({ cuenta_id: r.cuenta_id, enlace: r.enlace, mensaje: r.enlace ? "Usuario creado: le enviamos el enlace por correo y puedes mandárselo por WhatsApp" : "Usuario agregado (ya tenía contraseña)" }, { status: 201 });
});

/** Activar o desactivar a un usuario en el cliente, o generarle un enlace nuevo para poner contraseña. */
export const PATCH = conAdmin(async (a, req, ctx) => {
  const { id } = await ctx.params;
  if (!esUuid(id)) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const p = Cambio.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Datos no válidos" }, { status: 400 });
  const r = await sinRLS(async (c) => {
    const ok = (await c.query(`select e.demo from miembros m join empresas e on e.id = m.empresa_id where m.empresa_id = $1 and m.user_id = $2`, [id, p.data.cuenta_id])).rows[0];
    if (!ok) return null;
    if (ok.demo) throw Object.assign(new Error("Los usuarios de la demostración no se modifican"), { code: "P0001" });
    if (p.data.activo !== undefined) await c.query(`update miembros set activo = $3 where empresa_id = $1 and user_id = $2`, [id, p.data.cuenta_id, p.data.activo]);
    if (p.data.enlace) {
      const cu = (await c.query(`select email, nombre, clave_hash is not null tenia from cuentas where id = $1`, [p.data.cuenta_id])).rows[0];
      const enlace = await enlaceInvitacion(c, p.data.cuenta_id); // rechaza cuentas de superadministrador
      await c.query(`update cuentas set clave_hash = null, version_sesion = version_sesion + 1 where id = $1`, [p.data.cuenta_id]); // el enlace reemplaza la contraseña olvidada y cierra sus sesiones
      const correo = `${cu.tenia ? "restablecer" : "invitacion"}:${p.data.cuenta_id}:${Date.now()}`;
      const empresa = (await c.query(`select coalesce(nombre_comercial, razon_social) n from empresas where id = $1`, [id])).rows[0]?.n;
      await encolar(c, { clave: correo, para: cu.email, plantilla: cu.tenia ? "restablecer" : "invitacion", empresa: id, datos: { nombre: cu.nombre, empresa, enlace } });
      return { enlace, correo };
    }
    return {};
  });
  if (!r) return NextResponse.json({ error: "Ese usuario no es de este cliente" }, { status: 404 });
  if ("correo" in r && r.correo) await enviarAhora(r.correo);
  await evento(a, p.data.enlace ? "nuevo_enlace" : p.data.activo ? "activar_usuario" : "desactivar_usuario", id, { cuenta: p.data.cuenta_id });
  return NextResponse.json({ ok: true, enlace: "enlace" in r ? r.enlace : undefined, mensaje: "enlace" in r ? "Enlace nuevo generado y enviado por correo" : "Guardado" });
});
