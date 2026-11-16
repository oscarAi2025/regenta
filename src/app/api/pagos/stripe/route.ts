import { NextResponse } from "next/server";
import { firmaStripeValida } from "@/lib/pagos-firma";
import { procesarEventoStripe } from "@/lib/pagos-stripe";

/** Webhook de Stripe (opcional: sin STRIPE_WEBHOOK_SECRET los pagos se confirman al volver del pago y con la tarea de cada
 *  hora). Solo verifica la firma; lo que hace cada evento está en lib/pagos-stripe. */
export async function POST(req: Request) {
  const secreto = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secreto) return NextResponse.json({ error: "Webhook de Stripe no configurado" }, { status: 503 });
  const cuerpo = await req.text();
  if (!firmaStripeValida(cuerpo, req.headers.get("stripe-signature"), secreto)) return NextResponse.json({ error: "Firma no válida" }, { status: 400 });
  const ev = JSON.parse(cuerpo) as { type: string; data: { object: Record<string, any> } };
  await procesarEventoStripe(ev.type, ev.data.object);
  return NextResponse.json({ ok: true });
}
