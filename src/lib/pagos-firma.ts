import { createHash, createHmac, timingSafeEqual } from "node:crypto";

// Firmas de las pasarelas de pago. Funciones puras (sin red ni base de datos) para poder probarlas.

const sha256 = (s: string) => createHash("sha256").update(s, "utf8").digest("hex");
const iguales = (a: string, b: string) => {
  const x = Buffer.from(a.toLowerCase()), y = Buffer.from(b.toLowerCase());
  return x.length === y.length && timingSafeEqual(x, y);
};

/** Wompi · firma de integridad del Web Checkout: SHA256(referencia + monto en centavos + moneda + secreto de integridad).
 *  docs.wompi.co/en/docs/colombia/widget-checkout-web/ (sin expiration-time: su posición en la cadena no está clara). */
export const firmaIntegridadWompi = (referencia: string, centavos: number, moneda: string, secreto: string) =>
  sha256(`${referencia}${centavos}${moneda}${secreto}`);

export type EventoWompi = {
  event: string; data: { transaction?: Record<string, unknown> } & Record<string, unknown>;
  signature?: { properties?: string[]; checksum?: string }; timestamp?: number; sent_at?: string;
};

/** Wompi · checksum de un evento: valores de signature.properties (rutas dentro de data, en el orden en que vienen)
 *  + timestamp + secreto de eventos, en SHA256. docs.wompi.co/en/docs/colombia/eventos/ */
export function eventoWompiValido(e: EventoWompi, secreto: string) {
  const props = e.signature?.properties, checksum = e.signature?.checksum;
  if (!Array.isArray(props) || !props.length || typeof checksum !== "string" || typeof e.timestamp !== "number") return false;
  const valor = (ruta: string) => ruta.split(".").reduce<unknown>((o, k) => (o && typeof o === "object" ? (o as Record<string, unknown>)[k] : undefined), e.data);
  const partes = props.map(valor);
  if (partes.some((v) => v === undefined || v === null)) return false;
  return iguales(sha256(partes.map(String).join("") + e.timestamp + secreto), checksum);
}

/** Stripe · cabecera Stripe-Signature: t=…,v1=… ; HMAC-SHA256 de `${t}.${cuerpo}` con el secreto whsec_.
 *  Se acepta cualquier v1 válida (rotación de secretos) dentro de la tolerancia (5 min). docs.stripe.com/webhooks */
export function firmaStripeValida(cuerpo: string, cabecera: string | null, secreto: string, ahora = Date.now() / 1000, tolerancia = 300) {
  if (!cabecera) return false;
  const pares = cabecera.split(",").map((x) => x.trim().split("="));
  const t = Number(pares.find(([k]) => k === "t")?.[1]);
  const firmas = pares.filter(([k]) => k === "v1").map(([, v]) => v);
  if (!Number.isFinite(t) || !firmas.length || Math.abs(ahora - t) > tolerancia) return false;
  const esperada = createHmac("sha256", secreto).update(`${t}.${cuerpo}`, "utf8").digest("hex");
  return firmas.some((f) => iguales(f, esperada));
}
