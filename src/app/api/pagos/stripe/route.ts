import { NextResponse } from "next/server";
import { sinRLS } from "@/lib/db";
import { firmaStripeValida } from "@/lib/pagos-firma";
import { alCambiarPago } from "@/lib/pagos-eventos";
import { enviarAhora } from "@/lib/correo";

/** Webhook de Stripe: checkout.session.completed aprueba la orden; invoice.payment_failed y la cancelación se registran. */
export async function POST(req: Request) {
  const secreto = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secreto) return NextResponse.json({ error: "Stripe no configurado" }, { status: 503 });
  const cuerpo = await req.text();
  if (!firmaStripeValida(cuerpo, req.headers.get("stripe-signature"), secreto)) return NextResponse.json({ error: "Firma no válida" }, { status: 400 });
  const ev = JSON.parse(cuerpo) as { type: string; data: { object: Record<string, unknown> } };
  const o = ev.data.object;
  const meta = (x: unknown) => (x as { metadata?: Record<string, string> } | undefined)?.metadata?.referencia;
  const ref = (o.client_reference_id as string) ?? meta(o) ?? meta(o.subscription_details)
    ?? meta((o.parent as { subscription_details?: unknown } | undefined)?.subscription_details); // API 2025-03-31 en adelante
  if (!ref) return NextResponse.json({ ok: true });
  const estado = ev.type === "checkout.session.completed" ? (o.payment_status === "paid" ? "aprobado" : "pendiente")
    : ev.type === "invoice.paid" ? "aprobado" : ev.type === "invoice.payment_failed" ? "rechazado" : ev.type === "customer.subscription.deleted" ? "anulado" : null;
  // Transiciones: una suscripción anulada no revive por un evento atrasado; un cobro fallido se recupera con invoice.paid.
  const clave = estado ? await sinRLS(async (c) => {
    const antes = (await c.query(`select estado from pagos_suscripcion where referencia = $1 and proveedor = 'stripe' for update`, [ref])).rows[0];
    const n = await c.query(
      `update pagos_suscripcion set estado = $2, transaccion = coalesce($3, transaccion), metodo = 'CARD_STRIPE', detalle = $4, actualizado = now()
       where referencia = $1 and proveedor = 'stripe' and estado <> 'anulado' and not (estado = 'aprobado' and $2 = 'pendiente')`,
      [ref, estado, (o.subscription as string) ?? null, JSON.stringify({ evento: ev.type })]);
    return n.rowCount && antes && antes.estado !== estado ? alCambiarPago(c, ref) : null;
  }) : null;
  for (const k of clave ?? []) await enviarAhora(k);
  return NextResponse.json({ ok: true });
}
