import { NextResponse } from "next/server";
import { sinRLS } from "@/lib/db";
import { firmaStripeValida } from "@/lib/pagos-firma";
import { alCambiarPago } from "@/lib/pagos-eventos";
import { encolar, enviarAhora } from "@/lib/correo";

type Obj = Record<string, any>;

/** Webhook de Stripe.
 *  - checkout.session.completed: aprueba la orden solo si la sesión es la que Regenta creó (id, modo suscripción, COP y
 *    el monto exacto de la orden). Guarda el id de la suscripción.
 *  - invoice.paid de una renovación: registra un pago nuevo que extiende el periodo (la primera factura ya la cubre el checkout).
 *  - invoice.payment_failed: avisa al cliente; un periodo ya pagado no se pierde.
 *  - customer.subscription.deleted: marca la suscripción cancelada; lo pagado sigue vigente hasta su vencimiento. */
export async function POST(req: Request) {
  const secreto = process.env.STRIPE_WEBHOOK_SECRET;
  if (!secreto) return NextResponse.json({ error: "Stripe no configurado" }, { status: 503 });
  const cuerpo = await req.text();
  if (!firmaStripeValida(cuerpo, req.headers.get("stripe-signature"), secreto)) return NextResponse.json({ error: "Firma no válida" }, { status: 400 });
  const ev = JSON.parse(cuerpo) as { type: string; data: { object: Obj } };
  const o = ev.data.object;
  const subDe = (x: Obj): string | null => (typeof x.subscription === "string" ? x.subscription : null)
    ?? x.parent?.subscription_details?.subscription ?? null; // API 2025-03-31 en adelante

  const claves = await sinRLS(async (c): Promise<string[]> => {
    if (ev.type === "checkout.session.completed") {
      const ref = o.client_reference_id as string | undefined;
      if (!ref) return [];
      const p = (await c.query(`select * from pagos_suscripcion where referencia = $1 and proveedor = 'stripe' for update`, [ref])).rows[0];
      if (!p) return [];
      const legitima = o.id === p.transaccion && o.mode === "subscription" && String(o.currency).toLowerCase() === "cop"
        && Number(o.amount_total) === Number(p.monto) * 100;
      if (!legitima) {
        await c.query(`update pagos_suscripcion set detalle = $2, actualizado = now() where referencia = $1`,
          [ref, JSON.stringify({ evento: ev.type, alerta: "sesion_no_coincide", sesion: o.id ?? null, monto: o.amount_total ?? null })]);
        return [];
      }
      if (o.payment_status !== "paid" || p.estado === "aprobado" || p.estado === "anulado") return [];
      await c.query(`update pagos_suscripcion set estado = 'aprobado', suscripcion = $2, metodo = 'CARD_STRIPE', detalle = $3, actualizado = now() where referencia = $1`,
        [ref, subDe(o), JSON.stringify({ evento: ev.type })]);
      return alCambiarPago(c, ref);
    }

    const sub = ev.type === "customer.subscription.deleted" ? (o.id as string) : subDe(o);
    if (!sub) return [];
    const p = (await c.query(`select * from pagos_suscripcion where suscripcion = $1 and proveedor = 'stripe' order by creado limit 1 for update`, [sub])).rows[0];
    if (!p) return [];

    if (ev.type === "invoice.paid") {
      if (o.billing_reason === "subscription_create" || !o.id) return []; // la primera factura la cubre el checkout
      if (String(o.currency).toLowerCase() !== "cop" || Number(o.amount_paid) !== Number(p.monto) * 100) {
        await c.query(`update pagos_suscripcion set detalle = $2, actualizado = now() where referencia = $1`,
          [p.referencia, JSON.stringify({ evento: ev.type, alerta: "renovacion_monto_distinto", factura: o.id, monto: o.amount_paid ?? null })]);
        return [];
      }
      const ref = `${p.referencia}-R${String(o.id).replace(/[^0-9A-Za-z]/g, "").slice(-12).toUpperCase()}`;
      const n = await c.query(`insert into pagos_suscripcion (referencia, plan, periodo, monto, proveedor, nombre, empresa, nit, email, telefono, empresa_id,
          estado, transaccion, suscripcion, metodo, detalle, atendido)
        select $2, plan, periodo, monto, 'stripe', nombre, empresa, nit, email, telefono, empresa_id, 'aprobado', $3, suscripcion, 'CARD_STRIPE', $4, empresa_id is not null
        from pagos_suscripcion where referencia = $1 on conflict (referencia) do nothing`,
        [p.referencia, ref, o.id, JSON.stringify({ evento: ev.type, renovacion: true })]);
      return n.rowCount ? alCambiarPago(c, ref) : []; // repetido: Stripe reintenta, no se cobra dos veces
    }

    if (ev.type === "invoice.payment_failed") {
      if (p.estado === "pendiente") {
        await c.query(`update pagos_suscripcion set estado = 'rechazado', detalle = $2, actualizado = now() where referencia = $1`, [p.referencia, JSON.stringify({ evento: ev.type })]);
        return alCambiarPago(c, p.referencia);
      }
      const clave = `stripe-fallo:${o.id ?? sub}`;
      return (await encolar(c, { clave, para: p.email, plantilla: "pago_rechazado", empresa: p.empresa_id, datos: { nombre: p.nombre, plan: p.plan === "pro" ? "Pro" : "Esencial", plan_id: p.plan } })) ? [clave] : [];
    }

    if (ev.type === "customer.subscription.deleted") {
      await c.query(`update pagos_suscripcion set detalle = coalesce(detalle, '{}'::jsonb) || '{"cancelada":true}'::jsonb, actualizado = now() where suscripcion = $1`, [sub]);
      if (p.estado === "pendiente") await c.query(`update pagos_suscripcion set estado = 'anulado' where referencia = $1`, [p.referencia]);
    }
    return [];
  });
  for (const k of claves) await enviarAhora(k);
  return NextResponse.json({ ok: true });
}
