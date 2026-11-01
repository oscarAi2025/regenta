import { NextResponse } from "next/server";
import { sinRLS } from "@/lib/db";
import { firmaStripeValida } from "@/lib/pagos-firma";

/** Webhook de Stripe: checkout.session.completed aprueba la orden; invoice.payment_failed y la cancelación se registran. */
export async function POST(req: Request) {
  const secreto = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secreto) return NextResponse.json({ error: "Stripe no configurado" }, { status: 503 });
  const cuerpo = await req.text();
  if (!firmaStripeValida(cuerpo, req.headers.get("stripe-signature"), secreto)) return NextResponse.json({ error: "Firma no válida" }, { status: 400 });
  const ev = JSON.parse(cuerpo) as { type: string; data: { object: Record<string, unknown> } };
  const o = ev.data.object;
  const ref = (o.client_reference_id as string) ?? ((o.metadata as Record<string, string> | undefined)?.referencia)
    ?? ((o.subscription_details as { metadata?: Record<string, string> } | undefined)?.metadata?.referencia);
  if (!ref) return NextResponse.json({ ok: true });
  const estado = ev.type === "checkout.session.completed" ? (o.payment_status === "paid" ? "aprobado" : "pendiente")
    : ev.type === "invoice.payment_failed" ? "rechazado" : ev.type === "customer.subscription.deleted" ? "anulado" : null;
  if (estado) await sinRLS((c) => c.query(
    `update pagos_suscripcion set estado = $2, transaccion = coalesce($3, transaccion), metodo = 'CARD_STRIPE', detalle = $4, actualizado = now() where referencia = $1 and proveedor = 'stripe'`,
    [ref, estado, (o.subscription as string) ?? null, JSON.stringify({ evento: ev.type })]));
  return NextResponse.json({ ok: true });
}
