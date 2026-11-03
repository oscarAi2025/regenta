import { z } from "zod";
import { NextResponse } from "next/server";
import { sinRLS } from "@/lib/db";
import { conAdmin, evento } from "@/lib/admin";
import { enviarPendientes } from "@/lib/correo";
import { enlaceInvitacion } from "@/lib/admin-datos";

const Cambio = z.object({ id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), accion: z.enum(["reintentar", "cancelar"]) });

/** Reintentar un correo con error o cancelar uno pendiente. */
export const PATCH = conAdmin(async (a, req) => {
  const p = Cambio.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Datos no válidos" }, { status: 400 });
  const { id, accion } = p.data;
  const n = await sinRLS(async (c) => {
    if (accion !== "reintentar") return c.query(`update correos set estado = 'cancelado', error = 'Cancelado desde la consola', datos = datos - 'enlace' where id = $1 and estado = 'pendiente'`, [id]);
    // Un correo de contraseña que falló ya no guarda su enlace (no se deja en claro): al reintentarlo se genera uno nuevo.
    const m = (await c.query(`select plantilla, para, datos ? 'enlace' tiene from correos where id = $1 and estado in ('error', 'cancelado')`, [id])).rows[0];
    if (m && ["invitacion", "restablecer"].includes(m.plantilla) && !m.tiene) {
      const cu = (await c.query(`select id from cuentas where lower(email) = lower($1) and activa`, [m.para])).rows[0];
      if (!cu) throw Object.assign(new Error("Esa cuenta ya no existe o está desactivada"), { code: "P0001" });
      const enlace = await enlaceInvitacion(c, cu.id);
      await c.query(`update correos set datos = datos || jsonb_build_object('enlace', $2::text) where id = $1`, [id, enlace]);
    }
    return c.query(`update correos set estado = 'pendiente', intentos = 0, programado = now(), error = null where id = $1 and estado in ('error', 'cancelado')`, [id]);
  }).catch((e) => { if ((e as { code?: string }).code === "P0001") return e as Error; throw e; });
  if (n instanceof Error) return NextResponse.json({ error: n.message }, { status: 409 });
  if (!n.rowCount) return NextResponse.json({ error: "Ese correo ya no se puede " + (accion === "reintentar" ? "reintentar" : "cancelar") }, { status: 409 });
  if (accion === "reintentar") await enviarPendientes(1, id);
  await evento(a, "correo_" + accion, null, { id });
  return NextResponse.json({ ok: true, mensaje: accion === "reintentar" ? "Reintentado" : "Cancelado" });
});
