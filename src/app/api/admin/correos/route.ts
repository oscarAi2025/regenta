import { z } from "zod";
import { NextResponse } from "next/server";
import { sinRLS } from "@/lib/db";
import { conAdmin, evento } from "@/lib/admin";
import { enviarPendientes } from "@/lib/correo";

const Cambio = z.object({ id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), accion: z.enum(["reintentar", "cancelar"]) });

/** Reintentar un correo con error o cancelar uno pendiente. */
export const PATCH = conAdmin(async (a, req) => {
  const p = Cambio.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Datos no válidos" }, { status: 400 });
  const { id, accion } = p.data;
  const n = await sinRLS((c) => accion === "reintentar"
    ? c.query(`update correos set estado = 'pendiente', intentos = 0, programado = now(), error = null where id = $1 and estado in ('error', 'cancelado')`, [id])
    : c.query(`update correos set estado = 'cancelado', error = 'Cancelado desde la consola' where id = $1 and estado = 'pendiente'`, [id]));
  if (!n.rowCount) return NextResponse.json({ error: "Ese correo ya no se puede " + (accion === "reintentar" ? "reintentar" : "cancelar") }, { status: 409 });
  if (accion === "reintentar") await enviarPendientes(1, id);
  await evento(a, "correo_" + accion, null, { id });
  return NextResponse.json({ ok: true, mensaje: accion === "reintentar" ? "Reintentado" : "Cancelado" });
});
