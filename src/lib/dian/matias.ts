// Emisor MATIAS API (UBL 2.1). Documentación: https://docs.matias-api.com · OpenAPI: /openapi.json
// Modelo «casa de software»: un solo token (MATIAS_TOKEN) para la cuenta principal; cada droguería es un cliente de esa
// cuenta y se emite en su nombre con ?client_uuid= (columna empresas.matias_cliente). Sin client_uuid se emite con la
// propia empresa de la cuenta (el NIT de Regenta).
// La emisión es síncrona: HTTP 200 con el veredicto de la DIAN en response.IsValid. Reintentar el MISMO número con el
// MISMO uuid es seguro (MATIAS no emite dos veces; en producción consulta la DIAN antes de retransmitir).
import type { DocumentoParaEmitir, Emisor, ResultadoEmision } from "./index";

// IDs del API (no los códigos DIAN): GET /identity-documents, /quantity-units, /payment-means.
const TIPO_ID: Record<string, number> = { CC: 1, CE: 2, NIT: 3, TI: 7, PP: 9, PEP: 14 };
const UNIDAD = 70; // «unidad» (código DIAN 94)
const MEDIO: Record<string, number> = { efectivo: 10, tarjeta: 48, transferencia: 47, nequi: 47, daviplata: 47, bre_b: 47 };
const CONSUMIDOR_FINAL = { company_name: "CONSUMIDOR FINAL", dni: "222222222222" };

const p2 = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

/** Arma el cuerpo de la petición. Función pura: se prueba sin red. */
export function payloadMatias(d: DocumentoParaEmitir) {
  const nota = d.tipo === "nota_credito";
  const origenPos = nota ? d.referencia?.tipo === "pos" : d.tipo === "pos";
  const type_document_id = nota ? (origenPos ? 94 : 5) : d.tipo === "pos" ? 20 : 7;
  const operation_type_id = nota ? (origenPos ? 11 : 12) : 1;

  // Impuestos: solo líneas gravadas (los medicamentos excluidos de IVA no informan tributo).
  const grupos = new Map<number, { base: number; iva: number }>();
  const lines = d.lineas.map((l, i) => {
    const gravada = l.iva_pct > 0;
    if (gravada) { const g = grupos.get(l.iva_pct) ?? { base: 0, iva: 0 }; g.base += l.base; g.iva += l.iva; grupos.set(l.iva_pct, g); }
    // Descuento de la línea: se informa como descuento no condicionado (discount_id 1) sobre la base bruta.
    const desc = Math.round(((l.descuento ?? 0) / (1 + l.iva_pct / 100)) * 100) / 100;
    const bruto = l.base + desc;
    return {
      invoiced_quantity: String(l.cantidad), base_quantity: String(l.cantidad), quantity_units_id: UNIDAD,
      line_extension_amount: p2(l.base), price_amount: p2(bruto / l.cantidad), free_of_charge_indicator: false,
      ...(desc > 0 ? { allowance_charges: [{ charge_indicator: false, discount_id: 1, allowance_charge_reason: "Descuento", amount: p2(desc), base_amount: p2(bruto) }] } : {}),
      description: l.descripcion.slice(0, 300), code: l.codigo ?? `L${i + 1}`, type_item_identifications_id: 4, reference_price_id: 1,
      ...(gravada ? { tax_totals: [{ tax_id: 1, percent: l.iva_pct, taxable_amount: p2(l.base), tax_amount: p2(l.iva) }] } : {}),
    };
  });
  const tax_totals = [...grupos].map(([percent, g]) => ({ tax_id: 1, percent, taxable_amount: p2(g.base), tax_amount: p2(g.iva) }));
  const base = d.lineas.reduce((s, l) => s + l.base, 0), iva = d.lineas.reduce((s, l) => s + l.iva, 0), total = d.totales.total;

  // Pagos: lo recibido incluye el cambio; se informa solo lo aplicado al total (primero medios electrónicos, luego efectivo).
  let payments;
  if (d.forma_pago.tipo === "credito") {
    payments = [{ payment_method_id: 2, means_payment_id: 1, value_paid: p2(total), payment_due_date: d.forma_pago.vence, duration_measure: String(d.forma_pago.plazo_dias) }];
  } else {
    let resta = total;
    payments = [...d.pagos].sort((a, b) => (a.medio === "efectivo" ? 1 : 0) - (b.medio === "efectivo" ? 1 : 0)).flatMap((p) => {
      const v = Math.min(p.valor, resta); resta -= v;
      return v > 0 ? [{ payment_method_id: 1, means_payment_id: MEDIO[p.medio] ?? 10, value_paid: p2(v) }] : [];
    });
    if (!payments.length) payments = [{ payment_method_id: 1, means_payment_id: 10, value_paid: p2(total) }];
  }

  const c = d.cliente;
  const customer = d.tipo === "pos" || (nota && origenPos)
    ? (c ? { company_name: c.nombre, dni: c.numero_doc, ...(c.email ? { email: c.email } : {}), points: 0 } : CONSUMIDOR_FINAL)
    : c ? {
        identity_document_id: TIPO_ID[c.tipo_doc] ?? 1, type_organization_id: c.tipo_doc === "NIT" ? 1 : 2,
        tax_regime_id: 2, tax_level_id: 5, company_name: c.nombre, dni: c.numero_doc, email: c.email ?? "", country_id: 45,
      }
    : { ...CONSUMIDOR_FINAL, identity_document_id: 1, type_organization_id: 2, tax_regime_id: 2, tax_level_id: 5, email: "" };

  const [fecha, hora] = bogota(d.fecha);
  return {
    uuid: d.id, resolution_number: d.resolucion, prefix: d.prefijo, document_number: String(d.numero),
    date: fecha, time: hora, type_document_id, operation_type_id, graphic_representation: 1, send_email: c?.email ? 1 : 0,
    payments, customer, lines, tax_totals,
    legal_monetary_totals: { line_extension_amount: p2(base), tax_exclusive_amount: p2(tax_totals.length ? [...grupos.values()].reduce((s, g) => s + g.base, 0) : 0), tax_inclusive_amount: p2(base + iva), payable_amount: p2(total) },
    document_signature: { cashier: d.punto?.cajero ?? "" },
    ...(d.tipo === "pos" ? {
      point_of_sale: { cashier_name: d.punto?.cajero ?? "Caja", terminal_number: d.punto?.caja ?? "CAJA1", cashier_type: "Caja principal", sales_code: `${d.prefijo}${d.numero}`, address: d.punto?.direccion || "Sin dirección", sub_total: p2(base) },
      software_manufacturer: { owner_name: "IA DEV INVESTIMENTS COLOMBIA S.A.S.", company_name: "IA DEV INVESTIMENTS COLOMBIA S.A.S.", software_name: "Regenta" },
    } : {}),
    ...(nota && d.referencia ? {
      discrepancy_response: { reference_id: `${d.referencia.prefijo}${d.referencia.numero}`, response_id: "2" }, // 2 = anulación
      billing_reference: { number: `${d.referencia.prefijo}${d.referencia.numero}`, date: bogota(d.referencia.fecha)[0], uuid: d.referencia.cufe, ...(origenPos ? { scheme_name: "CUDE-SHA384" } : {}) },
    } : {}),
  };
}

/** Fecha y hora de Bogotá (la DIAN valida contra la hora colombiana). */
function bogota(iso: string): [string, string] {
  const s = new Date(new Date(iso).getTime() - 5 * 3600 * 1000).toISOString();
  return [s.slice(0, 10), s.slice(11, 19)];
}

type Respuesta = {
  success?: boolean; message?: string; code?: string; errors?: Record<string, string[]>;
  XmlDocumentKey?: string; uuid?: string; qr?: { qrDian?: string } | null; pdf?: { url?: string } | null; warnings?: { code: string }[];
  response?: { IsValid?: string; StatusCode?: string; StatusMessage?: string; ErrorMessage?: { string?: string[] | string } };
  data?: { XmlDocumentKey?: string; is_valid?: number; uuid?: string };
};

/** Traduce la respuesta HTTP de MATIAS a un resultado de la cola. */
export function interpretar(status: number, j: Respuesta): ResultadoEmision {
  const errores = (x?: string[] | string) => (Array.isArray(x) ? x : x ? [x] : []).join(" · ");
  const resumen = { uuid: j.uuid ?? j.data?.uuid, pdf: j.pdf?.url, qr: j.qr?.qrDian, warnings: j.warnings, estado: j.response?.StatusCode, mensaje: j.response?.StatusMessage ?? j.message };
  if (status === 200 && j.response?.IsValid === "true" && j.XmlDocumentKey)
    return { ok: true, cufe: j.XmlDocumentKey, qr: j.qr?.qrDian ?? `https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=${j.XmlDocumentKey}`, simulado: false, respuesta: resumen };
  // El mismo número ya validado (reintento después de un corte): se toma como aceptado.
  if (status === 400 && j.data?.is_valid === 1 && j.data.XmlDocumentKey)
    return { ok: true, cufe: j.data.XmlDocumentKey, qr: `https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=${j.data.XmlDocumentKey}`, simulado: false, respuesta: { ...resumen, recuperado: true } };
  if (status === 200 && j.response?.StatusCode === "98") return { ok: false, definitivo: false, error: "La DIAN aún está validando (98)", respuesta: resumen };
  if (status === 200) return { ok: false, definitivo: true, error: `Rechazo DIAN ${j.response?.StatusCode ?? ""}: ${errores(j.response?.ErrorMessage?.string) || j.response?.StatusMessage || j.message}`.slice(0, 900), respuesta: { ...resumen, errores: j.response?.ErrorMessage } };
  if (status === 422) return { ok: false, definitivo: true, error: `Datos inválidos: ${Object.values(j.errors ?? {}).flat().join(" · ") || j.message}`.slice(0, 900), respuesta: j };
  if (status === 401 || status === 403) return { ok: false, definitivo: false, error: `MATIAS sin autorización (${status}): revisar MATIAS_TOKEN / cliente`, respuesta: resumen };
  if (status === 402) return { ok: false, definitivo: false, error: "MATIAS: sin documentos disponibles en el paquete (comprar más)", respuesta: resumen };
  // 409 (en transmisión / en validación), 429, 5xx (incluido DOCUMENT_POSSIBLY_SENT): se reintenta con el mismo uuid.
  return { ok: false, definitivo: false, error: `MATIAS ${status}${j.code ? " " + j.code : ""}: ${j.message ?? "sin respuesta"}`.slice(0, 900), respuesta: resumen };
}

export function emisorMatias(): Emisor {
  const base = (process.env.MATIAS_URL ?? "https://sandbox-api.matias-api.com").replace(/\/$/, "");
  const token = process.env.MATIAS_TOKEN;
  return {
    nombre: "matias",
    async emitir(d) {
      if (!token) return { ok: false, definitivo: false, error: "Falta MATIAS_TOKEN" };
      if (!d.resolucion) return { ok: false, definitivo: true, error: "La resolución no tiene número de resolución DIAN" };
      if (d.tipo === "nota_credito" && !d.referencia?.cufe) return { ok: false, definitivo: false, error: "La nota crédito espera a que el documento original tenga CUFE" };
      const ruta = d.tipo === "nota_credito" ? "/api/ubl2.1/notes/credit" : "/api/ubl2.1/invoice";
      const q = d.matias_cliente ? `?client_uuid=${encodeURIComponent(d.matias_cliente)}` : "";
      const r = await fetch(base + ruta + q, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(payloadMatias(d)), signal: AbortSignal.timeout(60000),
      });
      const j = (await r.json().catch(() => ({ message: `Respuesta no JSON (${r.status})` }))) as Respuesta;
      return interpretar(r.status, j);
    },
  };
}
