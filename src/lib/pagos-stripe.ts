import "server-only";
import { sinRLS } from "./db";
import { alCambiarPago, cancelarReemplazadas } from "./pagos-eventos";
import { encolar, enviarAhora } from "./correo";
import { apiStripe, stripeActivo } from "./pagos";

type Obj = Record<string, any>;
const detalleCancelada = (p: Obj) => !!p.detalle?.cancelada;

/** Aplica un evento de Stripe (llegue por el webhook o lo traiga la sincronización desde la API). Idempotente: aplicarlo
 *  dos veces no cobra ni avisa dos veces.
 *  - checkout.session.completed: aprueba la orden solo si la sesión es la que Regenta creó (id, modo suscripción, COP y
 *    el monto exacto de la orden). Guarda el id de la suscripción.
 *  - invoice.paid de una renovación: registra un pago nuevo que extiende el periodo (la primera factura ya la cubre el checkout).
 *  - invoice.payment_failed: avisa al cliente; un periodo ya pagado no se pierde.
 *  - customer.subscription.deleted: marca la suscripción cancelada; lo pagado sigue vigente hasta su vencimiento. */
export async function procesarEventoStripe(tipo: string, o: Obj) {
  const subDe = (x: Obj): string | null => (typeof x.subscription === "string" ? x.subscription : null)
    ?? x.parent?.subscription_details?.subscription ?? null; // API 2025-03-31 en adelante

  const claves = await sinRLS(async (c): Promise<string[]> => {
    if (tipo === "checkout.session.completed") {
      const ref = o.client_reference_id as string | undefined;
      if (!ref) return [];
      const p = (await c.query(`select * from pagos_suscripcion where referencia = $1 and proveedor = 'stripe' for update`, [ref])).rows[0];
      if (!p) return [];
      const legitima = o.id === p.transaccion && o.mode === "subscription" && String(o.currency).toLowerCase() === "cop"
        && Number(o.amount_total) === Number(p.monto) * 100;
      if (!legitima) {
        await c.query(`update pagos_suscripcion set detalle = $2, actualizado = now() where referencia = $1`,
          [ref, JSON.stringify({ evento: tipo, alerta: "sesion_no_coincide", sesion: o.id ?? null, monto: o.amount_total ?? null })]);
        return [];
      }
      if (o.payment_status !== "paid" || p.estado === "aprobado" || p.estado === "anulado") return [];
      await c.query(`update pagos_suscripcion set estado = 'aprobado', suscripcion = $2, metodo = 'CARD_STRIPE', detalle = $3, actualizado = now() where referencia = $1`,
        [ref, subDe(o), JSON.stringify({ evento: tipo })]);
      return alCambiarPago(c, ref);
    }

    const sub = tipo === "customer.subscription.deleted" ? (o.id as string) : subDe(o);
    if (!sub) return [];
    const p = (await c.query(`select * from pagos_suscripcion where suscripcion = $1 and proveedor = 'stripe' order by creado limit 1 for update`, [sub])).rows[0];
    if (!p) return [];

    if (tipo === "invoice.paid") {
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
        [p.referencia, ref, o.id, JSON.stringify({ evento: tipo, renovacion: true })]);
      return n.rowCount ? alCambiarPago(c, ref) : []; // repetido: Stripe reintenta, no se cobra dos veces
    }

    if (tipo === "invoice.payment_failed") {
      if (p.estado === "pendiente") {
        await c.query(`update pagos_suscripcion set estado = 'rechazado', detalle = $2, actualizado = now() where referencia = $1`, [p.referencia, JSON.stringify({ evento: tipo })]);
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

    if (tipo === "customer.subscription.deleted") {
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
}

/** Confirma contra la API una sesión de pago pendiente (al volver del pago, sin esperar al webhook). true si la orden quedó aprobada. */
export async function confirmarSesionStripe(sesion: string) {
  if (!stripeActivo() || !/^cs_\w+$/.test(sesion)) return false;
  const r = await apiStripe(`checkout/sessions/${sesion}`);
  if (!r?.ok) return false;
  const s = await r.json() as Obj;
  if (s.status !== "complete") return false;
  await procesarEventoStripe("checkout.session.completed", s);
  const ref = typeof s.client_reference_id === "string" ? s.client_reference_id : "";
  return (await sinRLS((c) => c.query(`select estado from pagos_suscripcion where referencia = $1 and transaccion = $2`, [ref, sesion]))).rows[0]?.estado === "aprobado";
}

/** Sincronización con la API de Stripe (tarea de cada hora). Hace lo mismo que el webhook para quien no lo configuró,
 *  y recupera los avisos que se hayan perdido: sesiones pagadas que siguen pendientes, renovaciones cobradas,
 *  cobros fallidos y suscripciones canceladas desde Stripe. */
export async function sincronizarStripe() {
  if (!stripeActivo()) return { activo: false };
  const r = { sesiones: 0, renovaciones: 0, fallidas: 0, canceladas: 0, errores: 0 };
  const leer = async (ruta: string) => { const x = await apiStripe(ruta); if (!x?.ok) { r.errores++; return null; } return x.json() as Promise<Obj>; };
  const pendientes = (await sinRLS((c) => c.query(`select transaccion from pagos_suscripcion where proveedor = 'stripe' and estado = 'pendiente'
    and transaccion like 'cs_%' and creado > now() - interval '2 days' order by creado desc limit 30`))).rows;
  for (const p of pendientes) if (await confirmarSesionStripe(p.transaccion)) r.sesiones++;
  const subs = (await sinRLS((c) => c.query(`select distinct suscripcion from pagos_suscripcion where proveedor = 'stripe' and estado = 'aprobado'
    and suscripcion like 'sub_%' and not coalesce((detalle ->> 'cancelada')::boolean, false) limit 60`))).rows;
  for (const { suscripcion } of subs) {
    const facturas = await leer(`invoices?subscription=${encodeURIComponent(suscripcion)}&status=paid&limit=3`);
    for (const f of (facturas?.data ?? []) as Obj[]) {
      if (f.billing_reason === "subscription_create") continue;
      const antes = (await sinRLS((c) => c.query(`select count(*)::int n from pagos_suscripcion where suscripcion = $1`, [suscripcion]))).rows[0].n;
      await procesarEventoStripe("invoice.paid", { ...f, subscription: suscripcion });
      if ((await sinRLS((c) => c.query(`select count(*)::int n from pagos_suscripcion where suscripcion = $1`, [suscripcion]))).rows[0].n > antes) r.renovaciones++;
    }
    const s = await leer(`subscriptions/${encodeURIComponent(suscripcion)}`);
    if (!s) continue;
    if (s.status === "canceled") { await procesarEventoStripe("customer.subscription.deleted", s); r.canceladas++; }
    else if ((s.status === "past_due" || s.status === "unpaid") && typeof s.latest_invoice === "string") {
      const f = await leer(`invoices/${encodeURIComponent(s.latest_invoice)}`);
      if (f && f.status !== "paid") { await procesarEventoStripe("invoice.payment_failed", { ...f, subscription: suscripcion }); r.fallidas++; }
    }
  }
  return r;
}
