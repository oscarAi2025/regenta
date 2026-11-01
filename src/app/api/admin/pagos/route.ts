import { z } from "zod";
import { NextResponse } from "next/server";
import { sinRLS } from "@/lib/db";
import { conAdmin, evento } from "@/lib/admin";

const Cambio = z.object({ referencia: z.string().max(80), atendido: z.boolean().optional(), empresa_id: z.string().uuid().nullish() });

/** Marcar un pago como atendido o vincularlo a un cliente. */
export const PATCH = conAdmin(async (a, req) => {
  const p = Cambio.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Datos no válidos" }, { status: 400 });
  const d = p.data;
  const n = await sinRLS((c) => c.query(`update pagos_suscripcion set atendido = coalesce($2, atendido), empresa_id = case when $3::boolean then $4::uuid else empresa_id end, actualizado = now() where referencia = $1`,
    [d.referencia, d.atendido ?? null, d.empresa_id !== undefined, d.empresa_id ?? null]));
  if (!n.rowCount) return NextResponse.json({ error: "Pago no encontrado" }, { status: 404 });
  await evento(a, "pago_actualizado", d.empresa_id ?? null, d);
  return NextResponse.json({ ok: true, mensaje: "Guardado" });
});
