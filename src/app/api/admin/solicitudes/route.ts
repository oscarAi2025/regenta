import { z } from "zod";
import { NextResponse } from "next/server";
import { sinRLS } from "@/lib/db";
import { conAdmin, evento } from "@/lib/admin";

const Cambio = z.object({ id: z.number().int().positive().max(Number.MAX_SAFE_INTEGER), estado: z.enum(["nueva", "contactada", "cliente", "descartada"]), nota: z.string().trim().max(1000).nullish() });

/** Cambiar el estado de una solicitud de demo. */
export const PATCH = conAdmin(async (a, req) => {
  const p = Cambio.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Datos no válidos" }, { status: 400 });
  const n = await sinRLS((c) => c.query(`update solicitudes_demo set estado = $2, nota = coalesce($3, nota) where id = $1`, [p.data.id, p.data.estado, p.data.nota ?? null]));
  if (!n.rowCount) return NextResponse.json({ error: "Solicitud no encontrada" }, { status: 404 });
  await evento(a, "solicitud_" + p.data.estado, null, { id: p.data.id });
  return NextResponse.json({ ok: true });
});
