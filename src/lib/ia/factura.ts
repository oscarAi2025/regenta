import "server-only";
import { z } from "zod";
import { ErrorIA } from "./claude";
import { fechaIso, loteEnDescripcion, type DocumentoLeido } from "../factura-proveedor";

// Foto o PDF de la factura del proveedor → el mismo DocumentoLeido que da el XML, con Regenta IA (visión).
// La IA solo transcribe lo que ve: no completa, no calcula ni adivina; lo que no se lee queda vacío y lo revisa la persona.

const URL_API = () => (process.env.REGENTA_IA_URL ?? "https://api.anthropic.com") + "/v1/messages";
const MODELO = () => process.env.REGENTA_IA_MODELO_FACTURAS ?? process.env.REGENTA_IA_MODELO ?? "claude-sonnet-5-5";

const HERRAMIENTA = {
  name: "factura_leida",
  description: "Devuelve lo que está escrito en la factura o remisión del proveedor, tal cual se lee.",
  input_schema: {
    type: "object",
    properties: {
      es_factura: { type: "boolean", description: "true si la imagen es una factura, remisión, tiquete o nota de un proveedor con productos" },
      tipo: { type: "string", enum: ["factura", "nota_credito", "nota_debito"] },
      numero: { type: "string", description: "Número del documento con su prefijo, p. ej. FE-1234 o POSF1003" },
      fecha: { type: "string", description: "Fecha de expedición en AAAA-MM-DD" },
      vence_pago: { type: ["string", "null"], description: "Fecha de vencimiento del pago en AAAA-MM-DD, si aparece" },
      cufe: { type: ["string", "null"], description: "CUFE o CUDE completo si aparece escrito" },
      proveedor_nombre: { type: "string", description: "Quien vende (el emisor), no el cliente" },
      proveedor_nit: { type: ["string", "null"], description: "NIT del emisor, solo dígitos y sin dígito de verificación" },
      comprador_nit: { type: ["string", "null"], description: "NIT o documento del cliente/comprador, solo dígitos" },
      lineas: {
        type: "array",
        items: {
          type: "object",
          properties: {
            descripcion: { type: "string", description: "Descripción completa del producto tal cual (incluye lo que diga de lote y vencimiento)" },
            codigo: { type: ["string", "null"], description: "Código del producto o código de barras si aparece" },
            cantidad: { type: "number" },
            precio_unitario: { type: ["number", "null"], description: "Precio unitario SIN IVA, en pesos (sin puntos de miles)" },
            descuento_pct: { type: ["number", "null"] },
            iva_pct: { type: ["number", "null"], description: "0, 5 o 19 si aparece" },
            total_linea: { type: ["number", "null"] },
            lote: { type: ["string", "null"] },
            vence: { type: ["string", "null"], description: "Vencimiento del lote en AAAA-MM-DD" },
          },
          required: ["descripcion", "cantidad"],
        },
      },
      subtotal: { type: ["number", "null"] },
      iva: { type: ["number", "null"] },
      total: { type: ["number", "null"] },
    },
    required: ["es_factura", "lineas"],
  },
} as const;

const fechaOk = (v: unknown) => (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v) ? fechaIso(v.slice(0, 4), v.slice(5, 7), v.slice(8, 10)) : null);
const n = z.number().finite().nullish().catch(null);
const Leida = z.object({
  es_factura: z.boolean(),
  tipo: z.enum(["factura", "nota_credito", "nota_debito"]).nullish().catch("factura"),
  numero: z.string().max(60).nullish().catch(null), fecha: z.unknown(), vence_pago: z.unknown(), cufe: z.string().max(120).nullish().catch(null),
  proveedor_nombre: z.string().max(160).nullish().catch(null), proveedor_nit: z.string().max(20).nullish().catch(null), comprador_nit: z.string().max(20).nullish().catch(null),
  lineas: z.array(z.object({
    descripcion: z.string().min(1).max(300), codigo: z.string().max(40).nullish().catch(null), cantidad: z.number().finite().min(0).max(1_000_000),
    precio_unitario: n, descuento_pct: n, iva_pct: n, total_linea: n, lote: z.string().max(40).nullish().catch(null), vence: z.unknown(),
  })).max(300),
  subtotal: n, iva: n, total: n,
});

export class NoEsFactura extends Error {}

/** Lee la imagen (jpeg/png/webp) o el PDF con Regenta IA. Lanza NoEsFactura si no lo es; ErrorIA si la IA falla. */
export async function leerFacturaConIA(datos: Uint8Array, tipo: string): Promise<DocumentoLeido> {
  const b64 = Buffer.from(datos).toString("base64");
  const archivo = tipo === "application/pdf"
    ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: b64 } }
    : { type: "image", source: { type: "base64", media_type: tipo, data: b64 } };
  const cuerpo = {
    model: MODELO(), max_tokens: 8000,
    system: "Transcribes facturas de proveedores de droguerías colombianas. Copias exactamente lo que está escrito: no inventas, no completas, no calculas valores que no aparecen. Si un dato no se lee con claridad, lo dejas en null. Los precios en Colombia usan punto para miles: $4.950 son 4950 pesos. Los valores tachados o corregidos a mano: usa el valor final legible.",
    tools: [HERRAMIENTA], tool_choice: { type: "tool", name: HERRAMIENTA.name },
    messages: [{ role: "user", content: [archivo, { type: "text", text: "Lee esta factura del proveedor y devuélvela con la herramienta factura_leida. Una línea por producto, en el mismo orden." }] }],
  };
  const pedir = (sinRazonar: boolean) => fetch(URL_API(), {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(sinRazonar ? { ...cuerpo, thinking: { type: "disabled" } } : cuerpo),
    signal: AbortSignal.timeout(90000),
  });
  // Herramienta obligatoria: sin razonamiento extendido. Si el modelo no acepta ese campo, se repite sin él.
  let r = await pedir(true);
  if (r.status === 400) { const t = await r.clone().text().catch(() => ""); if (/thinking/i.test(t)) r = await pedir(false); }
  if (!r.ok) {
    const t = await r.text().catch(() => "");
    let m = t.slice(0, 300); try { m = JSON.parse(t)?.error?.message ?? m; } catch {}
    throw new ErrorIA(r.status, m);
  }
  const j = (await r.json()) as { content?: { type: string; name?: string; input?: unknown }[] };
  const uso = j.content?.find((b) => b.type === "tool_use" && b.name === HERRAMIENTA.name);
  const p = Leida.safeParse(uso?.input);
  if (!p.success) throw new ErrorIA(502, "La lectura de la factura llegó incompleta");
  const d = p.data;
  if (!d.es_factura || !d.lineas.length) throw new NoEsFactura("No se ve una factura con productos en el archivo");
  const nit = (v: string | null | undefined) => (v ? v.replace(/\D/g, "").replace(/^(\d{9})\d$/, "$1") || null : null);
  return {
    tipo: d.tipo ?? "factura", numero: (d.numero ?? "").trim().toUpperCase(), fecha: fechaOk(d.fecha), cufe: d.cufe?.trim() || null, vence_pago: fechaOk(d.vence_pago),
    proveedor: { nombre: d.proveedor_nombre?.trim() || "Proveedor sin nombre", nit: nit(d.proveedor_nit), dv: null },
    comprador: { nombre: null, nit: nit(d.comprador_nit) },
    referencia: null,
    lineas: d.lineas.map((l, k) => {
      const enDesc = loteEnDescripcion(l.descripcion);
      const precio = l.precio_unitario ?? (l.total_linea && l.cantidad ? Math.round((l.total_linea / l.cantidad) * 100) / 100 : null);
      return {
        n: k + 1, codigo: l.codigo?.trim() || null, ean: l.codigo && /^\d{8,14}$/.test(l.codigo.trim()) ? l.codigo.trim() : null,
        descripcion: l.descripcion.replace(/\s+/g, " ").trim(), nombre: enDesc.nombre, cantidad: l.cantidad, precio,
        descuento_pct: Math.min(99.99, Math.max(0, l.descuento_pct ?? 0)), iva_pct: [0, 5, 19].includes(l.iva_pct ?? 0) ? l.iva_pct ?? 0 : 0,
        base: l.total_linea ?? null, lote: (l.lote?.trim().toUpperCase() || enDesc.lote) ?? null, vence: fechaOk(l.vence) ?? enDesc.vence,
        bonificada: l.cantidad > 0 && (l.total_linea === 0 || l.precio_unitario === 0),
      };
    }),
    totales: { base: d.subtotal ?? null, iva: d.iva ?? null, descuentos: null, total: d.total ?? null },
    origen: "ia",
  };
}
