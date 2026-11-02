import { z } from "zod";
import { NextResponse } from "next/server";
import { sinRLS } from "@/lib/db";
import { conAdmin, evento } from "@/lib/admin";
import { alCambiarPago } from "@/lib/pagos-eventos";
import { enviarAhora } from "@/lib/correo";

const Cambio = z.object({ referencia: z.string().max(80), atendido: z.boolean().optional(), empresa_id: z.string().uuid().nullish(), confirmar: z.enum(["aprobado", "rechazado"]).optional() });

/** Marcar un pago como atendido o vincularlo a un cliente. */
export const PATCH = conAdmin(async (a, req) => {
  const p = Cambio.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Datos no válidos" }, { status: 400 });
  const d = p.data;
  if (d.confirmar) {
    // Pago por QR: el superadministrador lo confirma al ver el dinero en la cuenta (o lo rechaza si no llegó).
    const clave = await sinRLS(async (c) => {
      const r = await c.query(`update pagos_suscripcion set estado = $2, confirmado_por = $3, metodo = 'QR Bre-B', actualizado = now() where referencia = $1 and proveedor = 'qr' and estado = 'pendiente'`, [d.referencia, d.confirmar, a.uid]);
      if (!r.rowCount) return null;
      await evento(a, d.confirmar === "aprobado" ? "confirmar_pago_qr" : "rechazar_pago_qr", null, { referencia: d.referencia }, c);
      return await alCambiarPago(c, d.referencia);
    });
    if (clave === null) return NextResponse.json({ error: "Ese pago ya no está pendiente" }, { status: 409 });
    for (const k of clave) await enviarAhora(k);
    return NextResponse.json({ ok: true, mensaje: d.confirmar === "aprobado" ? (clave.length > 1 ? "Pago confirmado: cuenta creada y correo de acceso enviado" : "Pago confirmado: le enviamos el correo") : "Marcado como no recibido" });
  }
  const n = await sinRLS((c) => c.query(`update pagos_suscripcion set atendido = coalesce($2, atendido), empresa_id = case when $3::boolean then $4::uuid else empresa_id end, actualizado = now() where referencia = $1`,
    [d.referencia, d.atendido ?? null, d.empresa_id !== undefined, d.empresa_id ?? null]));
  if (!n.rowCount) return NextResponse.json({ error: "Pago no encontrado" }, { status: 404 });
  await evento(a, "pago_actualizado", d.empresa_id ?? null, d);
  return NextResponse.json({ ok: true, mensaje: "Guardado" });
});
