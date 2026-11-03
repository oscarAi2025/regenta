import "server-only";
import { randomBytes } from "node:crypto";
import { PLANES } from "./planes";
import { SITIO } from "./sitio";
import { firmaIntegridadWompi } from "./pagos-firma";

// Pasarelas para cobrar los planes. Las llaves solo viven en variables de entorno del servidor:
//   Wompi (Colombia: tarjeta, PSE, Nequi, Botón y QR Bancolombia, Daviplata): WOMPI_PUBLIC_KEY, WOMPI_INTEGRITY_SECRET,
//     WOMPI_EVENTS_SECRET; opcionales WOMPI_CHECKOUT_URL y WOMPI_API_URL.
//   Stripe (tarjeta internacional, suscripción que se renueva sola; requiere la cuenta de la LLC de EE. UU., Stripe no
//     abre cuentas en Colombia): STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET.

export type Plan = "esencial" | "pro";
export type Periodo = "mes" | "anio";

export const wompiActivo = () => !!(process.env.WOMPI_PUBLIC_KEY && process.env.WOMPI_INTEGRITY_SECRET && process.env.WOMPI_EVENTS_SECRET);
export const stripeActivo = () => !!(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_WEBHOOK_SECRET);
/** QR Bre-B de la cuenta empresarial Bancolombia de IA DEV INVESTIMENTS COLOMBIA S.A.S. (el mismo de Justicia Activa):
 *  sin pasarela, confirmación manual. Llave confirmada por Oscar: @iadevinvestiment. El QR no lleva monto fijo.
 *  REGENTA_QR_LLAVE / REGENTA_QR_IMAGEN / REGENTA_QR_TITULAR solo hacen falta para cambiarlos; REGENTA_QR_LLAVE=off lo apaga. */
const QR_LLAVE = "@iadevinvestiment";
export const qrActivo = () => process.env.REGENTA_QR_LLAVE !== "off";
export const datosQr = () => ({ llave: process.env.REGENTA_QR_LLAVE || QR_LLAVE, imagen: process.env.REGENTA_QR_IMAGEN || "/qr-pago.png", titular: process.env.REGENTA_QR_TITULAR || "IA DEV INVESTIMENTS COLOMBIA S.A.S." });

/** Precio en pesos: el año completo cuesta 10 meses (2 meses gratis, como dice la nota de precios). */
export function precio(plan: Plan, periodo: Periodo) {
  const p = PLANES.find((x) => x.id === plan)?.precio;
  if (!p) throw new Error("Plan sin precio publicado");
  return periodo === "anio" ? p * 10 : p;
}

export const nuevaReferencia = (plan: Plan) => `RG-${plan.toUpperCase()}-${Date.now().toString(36).toUpperCase()}-${randomBytes(4).toString("hex").toUpperCase()}`;

const urlWompiApi = () => process.env.WOMPI_API_URL
  ?? (process.env.WOMPI_PUBLIC_KEY?.startsWith("pub_test_") ? "https://sandbox.wompi.co/v1" : "https://production.wompi.co/v1");

/** Enlace al Web Checkout de Wompi (redirección por GET con la firma de integridad). */
export function enlaceWompi(d: { referencia: string; monto: number; email: string; nombre: string; telefono: string; nit?: string | null }) {
  const centavos = d.monto * 100;
  const q = new URLSearchParams({
    "public-key": process.env.WOMPI_PUBLIC_KEY!, currency: "COP", "amount-in-cents": String(centavos), reference: d.referencia,
    "signature:integrity": firmaIntegridadWompi(d.referencia, centavos, "COP", process.env.WOMPI_INTEGRITY_SECRET!),
    "redirect-url": `${SITIO}/contratar/resultado?ref=${encodeURIComponent(d.referencia)}`,
    "customer-data:email": d.email, "customer-data:full-name": d.nombre, "customer-data:phone-number": d.telefono.replace(/\D/g, "").slice(-10),
    "customer-data:phone-number-prefix": "+57",
  });
  if (d.nit) { q.set("customer-data:legal-id", d.nit.replace(/\D/g, "")); q.set("customer-data:legal-id-type", "NIT"); }
  return `${process.env.WOMPI_CHECKOUT_URL ?? "https://checkout.wompi.co/p/"}?${q}`;
}

/** Consulta una transacción de Wompi con la llave pública (para confirmar al volver del pago si el evento no ha llegado). */
export async function transaccionWompi(id: string) {
  const r = await fetch(`${urlWompiApi()}/transactions/${encodeURIComponent(id)}`, { headers: { authorization: `Bearer ${process.env.WOMPI_PUBLIC_KEY}` }, cache: "no-store" });
  if (!r.ok) return null;
  return ((await r.json()) as { data?: { id: string; status: string; reference: string; amount_in_cents: number; currency: string; payment_method_type?: string } }).data ?? null;
}

/** Sesión de Stripe Checkout en modo suscripción (se renueva cada mes o cada año). */
export async function sesionStripe(d: { referencia: string; plan: Plan; periodo: Periodo; monto: number; email: string }) {
  const nombre = PLANES.find((x) => x.id === d.plan)!.nombre;
  const f = new URLSearchParams({
    mode: "subscription", client_reference_id: d.referencia, customer_email: d.email, "metadata[referencia]": d.referencia,
    "subscription_data[metadata][referencia]": d.referencia,
    success_url: `${SITIO}/contratar/resultado?ref=${encodeURIComponent(d.referencia)}`, cancel_url: `${SITIO}/contratar?plan=${d.plan}&cancelado=1`,
    "line_items[0][quantity]": "1", "line_items[0][price_data][currency]": "cop",
    "line_items[0][price_data][unit_amount]": String(d.monto * 100), // COP en Stripe lleva dos decimales
    "line_items[0][price_data][recurring][interval]": d.periodo === "anio" ? "year" : "month",
    "line_items[0][price_data][product_data][name]": `Regenta ${nombre}`,
  });
  const r = await fetch("https://api.stripe.com/v1/checkout/sessions", { method: "POST", body: f,
    headers: { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, "content-type": "application/x-www-form-urlencoded" } });
  const j = await r.json() as { id?: string; url?: string; error?: { message?: string } };
  if (!r.ok || !j.url) throw new Error(j.error?.message ?? "Stripe no creó la sesión de pago");
  return { id: j.id!, url: j.url };
}

/** Cancela una suscripción de Stripe: al final del periodo ya pagado (el cliente se va) o de inmediato (suspensión de la
 *  consola). Devuelve false si Stripe no está configurado o no respondió bien. */
export async function cancelarSuscripcionStripe(id: string, alFinal: boolean) {
  if (!process.env.STRIPE_SECRET_KEY || !/^sub_[\w]+$/.test(id)) return false;
  const r = await fetch(`https://api.stripe.com/v1/subscriptions/${id}`, {
    method: alFinal ? "POST" : "DELETE", body: alFinal ? new URLSearchParams({ cancel_at_period_end: "true" }) : undefined,
    headers: { authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`, ...(alFinal ? { "content-type": "application/x-www-form-urlencoded" } : {}) },
  }).catch(() => null);
  return !!r?.ok;
}

/** Suscripción de Stripe vigente de una droguería (la que se renueva sola), si tiene. */
export async function suscripcionStripe(c: { query: (q: string, v: unknown[]) => Promise<{ rows: { suscripcion: string; al_final: boolean }[] }> }, empresa: string) {
  return (await c.query(`select suscripcion, coalesce((detalle ->> 'cancelar_al_final')::boolean, false) al_final from pagos_suscripcion
    where empresa_id = $1 and proveedor = 'stripe' and estado = 'aprobado' and suscripcion is not null and not coalesce((detalle ->> 'cancelada')::boolean, false)
    order by creado desc limit 1`, [empresa])).rows[0] ?? null;
}

/** Estado de Wompi → estado del pago en Regenta. */
export const estadoWompi = (s: string) => ({ APPROVED: "aprobado", DECLINED: "rechazado", VOIDED: "anulado", ERROR: "error" } as Record<string, string>)[s] ?? "pendiente";
