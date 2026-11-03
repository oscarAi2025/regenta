import { NextResponse } from "next/server";
import { sinRLS } from "@/lib/db";
import { firmaStripeValida } from "@/lib/pagos-firma";
import { alCambiarPago, cancelarReemplazadas } from "@/lib/pagos-eventos";
import { encolar, enviarAhora } from "@/lib/correo";

type Obj = Record<string, any>;
const detalleCancelada = (p: Obj) => !!p.detalle?.cancelada;

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
        // Cobro real que no cuadra con la orden: no se acredita solo, pero queda a la vista en la consola («sin atender»).
        await c.query(`update pagos_suscripcion set detalle = coalesce(detalle, '{}'::jsonb) || $2::jsonb, atendido = false, actualizado = now() where referencia = $1`,
          [p.referencia, JSON.stringify({ revisar: "renovacion_monto_distinto", factura: o.id, monto: o.amount_paid ?? null })]);
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
      // Renovación que no se pudo cobrar: el plan sigue hasta su vencimiento y Stripe reintenta solo. Se avisa a quien paga y a
      // los dueños, con la fecha límite y cómo pagar por otro medio (eso cancela esta renovación: no hay doble cobro).
      if (detalleCancelada(p)) return [];
      const vence = (await c.query(`select to_char(max(vence), 'DD/MM/YYYY') v from pagos_suscripcion where estado = 'aprobado' and (suscripcion = $1 or (empresa_id is not null and empresa_id = $2))`, [sub, p.empresa_id])).rows[0]?.v ?? null;
      const para = new Map<string, string>([[String(p.email).toLowerCase(), p.nombre]]);
      if (p.empresa_id) for (const d of (await c.query(`select cu.email, cu.nombre from miembros m join cuentas cu on cu.id = m.user_id where m.empresa_id = $1 and m.activo and m.rol = 'dueno'`, [p.empresa_id])).rows) para.set(String(d.email).toLowerCase(), d.nombre);
      const claves: string[] = [];
      for (const [email, nombre] of para) {
        const clave = `stripe-fallo:${o.id ?? sub}:${email}`;
        if (await encolar(c, { clave, para: email, plantilla: "renovacion_fallida", empresa: p.empresa_id, datos: { nombre, plan: p.plan === "pro" ? "Pro" : "Esencial", plan_id: p.plan, vence } })) claves.push(clave);
      }
      return claves;
    }

    if (ev.type === "customer.subscription.deleted") {
      const yaAvisado = !!(p.detalle?.cancelar_al_final || p.detalle?.reemplazada || p.detalle?.cancelada);
      await c.query(`update pagos_suscripcion set detalle = coalesce(detalle, '{}'::jsonb) || '{"cancelada":true}'::jsonb, actualizado = now() where suscripcion = $1`, [sub]);
      if (p.estado === "pendiente") await c.query(`update pagos_suscripcion set estado = 'anulado' where referencia = $1`, [p.referencia]);
      // Cancelada desde Stripe (por el banco, por cobros fallidos o desde el panel): el dueño sabe hasta cuándo va su plan.
      // Si la canceló el dueño en Regenta, la reemplazó otro pago o la cortó una suspensión, no se repite el aviso.
      const e = p.empresa_id ? (await c.query(`select estado, plan, coalesce(nombre_comercial, razon_social) nombre, (select to_char(max(vence), 'DD/MM/YYYY') from pagos_suscripcion where empresa_id = empresas.id and estado = 'aprobado') vence from empresas where id = $1`, [p.empresa_id])).rows[0] : null;
      if (yaAvisado || !e || e.estado !== "activa" || p.estado !== "aprobado") return [];
      const claves: string[] = [];
      for (const d of (await c.query(`select cu.email, cu.nombre from miembros m join cuentas cu on cu.id = m.user_id where m.empresa_id = $1 and m.activo and m.rol = 'dueno'`, [p.empresa_id])).rows) {
        const k = `renovacion-cancelada:${sub}:${d.email}`;
        if (await encolar(c, { clave: k, para: d.email, plantilla: "renovacion_cancelada", empresa: p.empresa_id, datos: { nombre: d.nombre, empresa: e.nombre, vence: e.vence, plan_id: e.plan } })) claves.push(k);
      }
      return claves;
    }
    return [];
  });
  for (const k of claves) await enviarAhora(k);
  await cancelarReemplazadas();
  return NextResponse.json({ ok: true });
}
