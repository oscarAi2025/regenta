import { z } from "zod";
import { NextResponse } from "next/server";
import { sinRLS } from "@/lib/db";
import { conAdmin, evento } from "@/lib/admin";
import { alCambiarPago } from "@/lib/pagos-eventos";
import { enviarAhora } from "@/lib/correo";
import { expirarSesionStripe } from "@/lib/pagos";

const Cambio = z.object({ referencia: z.string().max(80), atendido: z.boolean().optional(), empresa_id: z.string().uuid().nullish(), confirmar: z.enum(["aprobado", "rechazado"]).optional(), descartar: z.literal(true).optional() });

/** Marcar un pago como atendido o vincularlo a un cliente. */
export const PATCH = conAdmin(async (a, req) => {
  const p = Cambio.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Datos no válidos" }, { status: 400 });
  const d = p.data;
  if (d.descartar) {
    // Orden que nadie pagó (Stripe o Wompi): se cierra el enlace de pago y queda «rechazado» sin avisar al cliente. Si aun
    // así llega un pago (Wompi no permite cerrar su enlace), el aviso de la pasarela lo aprueba y el cliente recibe su acceso.
    const o = await sinRLS(async (c) => (await c.query(`select proveedor, estado, transaccion from pagos_suscripcion where referencia = $1`, [d.referencia])).rows[0]);
    if (!o) return NextResponse.json({ error: "Pago no encontrado" }, { status: 404 });
    if (!["pendiente", "error"].includes(o.estado) || o.proveedor === "qr") return NextResponse.json({ error: o.proveedor === "qr" ? "Un pago por QR se marca con «No llegó»" : "Solo se descarta una orden sin pagar" }, { status: 409 });
    if (o.proveedor === "stripe" && o.transaccion) {
      const r = await expirarSesionStripe(o.transaccion);
      if (r === "pagada") return NextResponse.json({ error: "En Stripe ya figura pagada: no se descarta, en minutos llega el aviso y se crea la cuenta" }, { status: 409 });
      if (r === null) return NextResponse.json({ error: "Stripe no respondió: intenta de nuevo en un momento" }, { status: 502 });
    }
    const n = await sinRLS(async (c) => {
      const r = await c.query(`update pagos_suscripcion set estado = 'rechazado', atendido = true, detalle = coalesce(detalle, '{}'::jsonb) || $2::jsonb, actualizado = now()
        where referencia = $1 and estado in ('pendiente', 'error')`, [d.referencia, JSON.stringify({ descartado: true, por: a.nombre })]);
      if (r.rowCount) await evento(a, "descartar_orden", null, { referencia: d.referencia }, c);
      return r.rowCount;
    });
    if (!n) return NextResponse.json({ error: "Esa orden ya cambió: recarga la página" }, { status: 409 });
    return NextResponse.json({ ok: true, mensaje: "Orden descartada" });
  }
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
