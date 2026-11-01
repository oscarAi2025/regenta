import { z } from "zod";
import { NextResponse } from "next/server";
import { sinRLS } from "@/lib/db";
import { esUuid } from "@/lib/api";
import { conAdmin, evento } from "@/lib/admin";

const Cambio = z.object({ estado: z.enum(["activa", "suspendida"]).optional(), plan: z.enum(["esencial", "pro", "cadena", "socio"]).optional(), nota: z.string().trim().max(2000).nullish() });

/** Activar o suspender, cambiar el plan o la nota interna de un cliente. */
export const PATCH = conAdmin(async (a, req, ctx) => {
  const { id } = await ctx.params;
  if (!esUuid(id)) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const p = Cambio.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Datos no válidos" }, { status: 400 });
  const d = p.data;
  const n = await sinRLS((c) => c.query(`update empresas set estado = coalesce($2, estado), plan = coalesce($3, plan), nota_admin = case when $4::boolean then $5 else nota_admin end where id = $1 and not demo`,
    [id, d.estado ?? null, d.plan ?? null, d.nota !== undefined, d.nota ?? null]));
  if (!n.rowCount) return NextResponse.json({ error: "Cliente no encontrado (la demo no se modifica desde aquí)" }, { status: 404 });
  await evento(a, d.estado ? (d.estado === "activa" ? "activar_cliente" : "suspender_cliente") : d.plan ? "cambiar_plan" : "nota_cliente", id, d);
  return NextResponse.json({ ok: true, mensaje: d.estado === "suspendida" ? "Cliente suspendido" : d.estado === "activa" ? "Cliente activado" : "Guardado" });
});
