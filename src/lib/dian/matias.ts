// Emisor MATIAS API (UBL 2.1). Documentación: https://docs.matias-api.com · OpenAPI: /openapi.json
// Modelo «casa de software»: un solo token (MATIAS_TOKEN) para la cuenta principal; cada droguería es un cliente de esa
// cuenta y se emite en su nombre con ?client_uuid= (columna empresas.matias_cliente). Sin client_uuid NO se emite: saldría
// con la propia empresa de la cuenta (el NIT de Regenta).
// La emisión es síncrona: HTTP 200 con el veredicto de la DIAN en response.IsValid. Reintentar el MISMO número con el
// MISMO uuid es seguro (MATIAS no emite dos veces; en producción consulta la DIAN antes de retransmitir).
import type { DocumentoParaEmitir, Emisor, ResultadoEmision } from "./index";

// IDs del API (no los códigos DIAN): GET /identity-documents, /quantity-units, /payment-means.
const TIPO_ID: Record<string, number> = { CC: 1, CE: 2, NIT: 3, TI: 7, PP: 9, PEP: 14 };
const UNIDAD = 70; // «unidad» (código DIAN 94)
const MEDIO: Record<string, number> = { efectivo: 10, tarjeta: 48, transferencia: 47, nequi: 47, daviplata: 47, bre_b: 47, qr: 47 };
const CONSUMIDOR_FINAL = { company_name: "CONSUMIDOR FINAL", dni: "222222222222" };

const p2 = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

/** Líneas, impuestos y totales en el formato de MATIAS (común a todos los documentos). */
function lineasMatias(d: DocumentoParaEmitir) {
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
  const legal_monetary_totals = { line_extension_amount: p2(base), tax_exclusive_amount: p2(tax_totals.length ? [...grupos.values()].reduce((s, g) => s + g.base, 0) : 0), tax_inclusive_amount: p2(base + iva), payable_amount: p2(total) };
  return { lines, tax_totals, legal_monetary_totals, base, total };
}

/** Pagos: lo recibido incluye el cambio; se informa solo lo aplicado al total (primero medios electrónicos, luego efectivo). */
function pagosMatias(d: DocumentoParaEmitir, total: number) {
  if (d.forma_pago.tipo === "credito")
    return [{ payment_method_id: 2, means_payment_id: 1, value_paid: p2(total), payment_due_date: d.forma_pago.vence, duration_measure: String(d.forma_pago.plazo_dias) }];
  let resta = total;
  const payments = [...d.pagos].sort((a, b) => (a.medio === "efectivo" ? 1 : 0) - (b.medio === "efectivo" ? 1 : 0)).flatMap((p) => {
    const v = Math.min(p.valor, resta); resta -= v;
    return v > 0 ? [{ payment_method_id: 1, means_payment_id: MEDIO[p.medio] ?? 10, value_paid: p2(v) }] : [];
  });
  return payments.length ? payments : [{ payment_method_id: 1, means_payment_id: 10, value_paid: p2(total) }];
}

/** Adquirente de una factura (o de su nota débito): persona natural o jurídica con su documento. */
function adquirente(c: DocumentoParaEmitir["cliente"]) {
  return c ? {
      identity_document_id: TIPO_ID[c.tipo_doc] ?? 1, type_organization_id: c.tipo_doc === "NIT" ? 1 : 2,
      tax_regime_id: 2, tax_level_id: 5, company_name: c.nombre, dni: c.numero_doc, email: c.email ?? "", country_id: 45,
    }
    : { ...CONSUMIDOR_FINAL, identity_document_id: 1, type_organization_id: 2, tax_regime_id: 2, tax_level_id: 5, email: "" };
}

/** Arma el cuerpo de la petición. Función pura: se prueba sin red. */
export function payloadMatias(d: DocumentoParaEmitir) {
  const nota = d.tipo === "nota_credito";
  const origenPos = nota ? d.referencia?.tipo === "pos" : d.tipo === "pos";
  const type_document_id = nota ? (origenPos ? 94 : 5) : d.tipo === "pos" ? 20 : 7;
  const operation_type_id = nota ? (origenPos ? 11 : 12) : 1;

  const { lines, tax_totals, legal_monetary_totals, base, total } = lineasMatias(d);

  const payments = pagosMatias(d, total);

  const c = d.cliente;
  const customer = d.tipo === "pos" || (nota && origenPos)
    ? (c ? { company_name: c.nombre, dni: c.numero_doc, ...(c.email ? { email: c.email } : {}), points: 0 } : CONSUMIDOR_FINAL)
    : adquirente(c);

  const [fecha, hora] = bogota(d.fecha);
  return {
    uuid: d.id, ...(d.resolucion ? { resolution_number: d.resolucion } : {}), prefix: d.prefijo, document_number: String(d.numero),
    date: fecha, time: hora, type_document_id, operation_type_id, graphic_representation: 1, send_email: c?.email ? 1 : 0,
    payments, customer, lines, tax_totals,
    legal_monetary_totals,
    document_signature: { cashier: d.punto?.cajero ?? "" },
    ...(d.tipo === "pos" ? {
      point_of_sale: { cashier_name: d.punto?.cajero ?? "Caja", terminal_number: d.punto?.caja ?? "CAJA1", cashier_type: "Caja principal", sales_code: `${d.prefijo}${d.numero}`, address: d.punto?.direccion || "Sin dirección", sub_total: p2(base) },
      software_manufacturer: { owner_name: "IA DEV INVESTIMENTS COLOMBIA S.A.S.", company_name: "IA DEV INVESTIMENTS COLOMBIA S.A.S.", software_name: "Regenta" },
    } : {}),
    ...(nota && d.referencia ? {
      discrepancy_response: { reference_id: `${d.referencia.prefijo}${d.referencia.numero}`, response_id: d.parcial ? "1" : "2" }, // 1 = devolución parcial · 2 = anulación
      billing_reference: { number: `${d.referencia.prefijo}${d.referencia.numero}`, date: bogota(d.referencia.fecha)[0], uuid: d.referencia.cufe, ...(origenPos ? { scheme_name: "CUDE-SHA384" } : {}) },
    } : {}),
  };
}

// ───────────── Documento soporte, nota de ajuste y nota débito ─────────────
// Rutas: verificadas por el equipo en la documentación oficial de MATIAS (openapi, 06/11/2026); las tres reciben el esquema
// InvoiceRequest (obligatorios: resolution_number, type_document_id, payments, customer, lines, legal_monetary_totals) y
// aceptan ?client_uuid=. Tipos: confirmados por el soporte técnico de MATIAS (chat del 06/11/2026); VALIDAR EN EL SANDBOX
// ANTES DE PRODUCCIÓN. El envío real de estos tipos está apagado por droguería hasta que la consola lo active
// (empresas.dian_complementario); mientras tanto la cola los rechaza con un mensaje claro y nunca gasta un envío.
export type TipoComplementario = "soporte" | "ajuste_soporte" | "nota_debito";
export type ConfigMatias = { ruta: string; type_document_id: number | null; operation_type_id: number | null; nota: string };
const CONFIRMADO = "confirmado por soporte MATIAS 06/11/2026; validar en sandbox antes de producción";
export const MATIAS_COMPLEMENTARIOS: Record<TipoComplementario, ConfigMatias> = {
  soporte: { ruta: "/api/ubl2.1/ds/document", type_document_id: 11, operation_type_id: 9, nota: CONFIRMADO },
  ajuste_soporte: { ruta: "/api/ubl2.1/ds/adjustment-note", type_document_id: 11, operation_type_id: 10, nota: CONFIRMADO },
  nota_debito: { ruta: "/api/ubl2.1/notes/credit", type_document_id: 4, operation_type_id: null, nota: CONFIRMADO },
};
const NOMBRE_TIPO: Record<TipoComplementario, string> = { soporte: "documento soporte", ajuste_soporte: "nota de ajuste del documento soporte", nota_debito: "nota débito" };
export const esComplementario = (t: string): t is TipoComplementario => t in MATIAS_COMPLEMENTARIOS;

/** ¿Se puede enviar de verdad este tipo a MATIAS? Con su configuración completa y el envío activado para la droguería. */
export function envioMatias(tipo: TipoComplementario, activo: boolean, cfg: Record<TipoComplementario, ConfigMatias> = MATIAS_COMPLEMENTARIOS): { habilitado: boolean; mensaje: string } {
  const c = cfg[tipo];
  if (!c.type_document_id) return { habilitado: false, mensaje: `El envío de ${NOMBRE_TIPO[tipo]} a la DIAN no está configurado en Regenta (falta su tipo de documento en MATIAS).` };
  if (!activo) return { habilitado: false, mensaje: `El envío real de ${NOMBRE_TIPO[tipo]} a la DIAN aún no está activado para tu droguería: escríbenos para activarlo.` };
  return { habilitado: true, mensaje: "" };
}

/** Cuerpo para documento soporte, nota de ajuste y nota débito (esquema InvoiceRequest). Función pura.
 *  Validar en el sandbox: el proveedor del documento soporte va en `customer` (el único bloque de tercero del esquema) y
 *  los códigos de discrepancy_response. */
export function payloadComplementario(d: DocumentoParaEmitir, cfg: Record<TipoComplementario, ConfigMatias> = MATIAS_COMPLEMENTARIOS) {
  if (!esComplementario(d.tipo)) throw new Error(`Tipo no complementario: ${d.tipo}`);
  const c = cfg[d.tipo];
  const { lines, tax_totals, legal_monetary_totals, total } = lineasMatias(d);
  const pr = d.proveedor;
  const customer = d.tipo === "nota_debito" ? adquirente(d.cliente) : pr ? {
    identity_document_id: TIPO_ID[pr.tipo_doc] ?? 1, type_organization_id: pr.tipo_doc === "NIT" ? 1 : 2, tax_regime_id: 2, tax_level_id: 5,
    company_name: pr.nombre, dni: pr.numero_doc, ...(pr.dv ? { dv: pr.dv } : {}), email: pr.email ?? "", country_id: 45,
    ...(pr.direccion ? { address: pr.direccion } : {}), ...(pr.telefono ? { phone: pr.telefono } : {}),
  } : null;
  const [fecha, hora] = bogota(d.fecha);
  const ref = d.referencia;
  // Concepto: anulación (2) o corrección/otros; mayor valor en la nota débito. Códigos pendientes de verificar.
  const respuesta = d.tipo === "ajuste_soporte" ? (d.concepto === "anulacion" ? "2" : "5") : "4";
  return {
    uuid: d.id, ...(d.resolucion ? { resolution_number: d.resolucion } : {}), prefix: d.prefijo, document_number: String(d.numero),
    date: fecha, time: hora, type_document_id: c.type_document_id, ...(c.operation_type_id ? { operation_type_id: c.operation_type_id } : {}), graphic_representation: 1, send_email: 0,
    ...(d.motivo ? { notes: d.motivo.slice(0, 300) } : {}),
    payments: pagosMatias(d, total), customer, lines, tax_totals, legal_monetary_totals,
    ...(d.periodo && d.tipo === "soporte" ? { invoice_period: { start_date: d.periodo.desde, end_date: d.periodo.hasta } } : {}),
    ...(ref && d.tipo !== "soporte" ? {
      discrepancy_response: { reference_id: `${ref.prefijo}${ref.numero}`, response_id: respuesta },
      billing_reference: { number: `${ref.prefijo}${ref.numero}`, date: bogota(ref.fecha)[0], uuid: ref.cufe },
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

/** Busca el XML en la respuesta del proveedor sin suponer el nombre del campo: un texto que empieza por «<?xml» (o ese
 *  texto en base64) en el primer o segundo nivel del JSON. Devuelve null si no viene. */
export function xmlEnRespuesta(j: unknown): string | null {
  const probar = (v: unknown): string | null => {
    if (typeof v !== "string" || v.length < 20) return null;
    const t = v.trimStart();
    if (t.startsWith("<?xml") || /^<[A-Za-z][\w:.-]*[\s>]/.test(t)) return t;
    if (/^[A-Za-z0-9+/=\s]+$/.test(t.slice(0, 200))) {
      try { const x = Buffer.from(t, "base64").toString("utf8").trimStart(); if (x.startsWith("<?xml")) return x; } catch { /* no es base64 */ }
    }
    return null;
  };
  if (!j || typeof j !== "object") return null;
  for (const v of Object.values(j as Record<string, unknown>)) {
    const x = probar(v); if (x) return x;
    if (v && typeof v === "object" && !Array.isArray(v)) for (const w of Object.values(v as Record<string, unknown>)) { const y = probar(w); if (y) return y; }
  }
  return null;
}

/** Traduce la respuesta HTTP de MATIAS a un resultado de la cola. */
export function interpretar(status: number, j: Respuesta): ResultadoEmision {
  const errores = (x?: string[] | string) => (Array.isArray(x) ? x : x ? [x] : []).join(" · ");
  const resumen = { uuid: j.uuid ?? j.data?.uuid, pdf: j.pdf?.url, qr: j.qr?.qrDian, warnings: j.warnings, estado: j.response?.StatusCode, mensaje: j.response?.StatusMessage ?? j.message };
  const archivos = { xml: xmlEnRespuesta(j), pdf: typeof j.pdf?.url === "string" && /^https:\/\//.test(j.pdf.url) ? j.pdf.url : null };
  if (status === 200 && j.response?.IsValid === "true" && j.XmlDocumentKey)
    return { ok: true, cufe: j.XmlDocumentKey, qr: j.qr?.qrDian ?? `https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=${j.XmlDocumentKey}`, simulado: false, respuesta: resumen, ...archivos };
  // El mismo número ya validado (reintento después de un corte): se toma como aceptado.
  if (status === 400 && j.data?.is_valid === 1 && j.data.XmlDocumentKey)
    return { ok: true, cufe: j.data.XmlDocumentKey, qr: `https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=${j.data.XmlDocumentKey}`, simulado: false, respuesta: { ...resumen, recuperado: true }, ...archivos };
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
      // Res. DIAN 165/2023 (arts. 42 y 43): la DIAN autoriza la numeración de la factura, el POS y el documento soporte.
      // Las notas (crédito, débito, de ajuste) llevan un consecutivo propio: no tienen número de resolución.
      if (!d.resolucion && (d.tipo === "pos" || d.tipo === "factura" || d.tipo === "soporte")) return { ok: false, definitivo: true, error: "La numeración no tiene número de resolución DIAN" };
      // Nunca se emite una droguería con la cuenta propia de MATIAS (saldría con el NIT de Regenta).
      if (!d.matias_cliente) return { ok: false, definitivo: false, error: "Falta conectar la droguería en MATIAS (UUID del cliente en la consola)" };
      if (d.tipo === "nota_credito" && !d.referencia?.cufe) return { ok: false, definitivo: false, error: "La nota crédito espera a que el documento original tenga CUFE" };
      // Documento soporte, nota de ajuste y nota débito: solo con su configuración verificada (si no, rechazo con mensaje claro).
      if (esComplementario(d.tipo)) {
        const e = envioMatias(d.tipo, !!d.envio_complementario);
        if (!e.habilitado) return { ok: false, definitivo: true, error: e.mensaje };
        if (d.tipo !== "soporte" && !d.referencia?.cufe) return { ok: false, definitivo: false, error: "La nota espera a que el documento original tenga su código de la DIAN" };
      }
      const ruta = esComplementario(d.tipo) ? MATIAS_COMPLEMENTARIOS[d.tipo].ruta : d.tipo === "nota_credito" ? "/api/ubl2.1/notes/credit" : "/api/ubl2.1/invoice";
      const q = d.matias_cliente ? `?client_uuid=${encodeURIComponent(d.matias_cliente)}` : "";
      const r = await fetch(base + ruta + q, {
        method: "POST", headers: { Authorization: `Bearer ${token}`, Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(esComplementario(d.tipo) ? payloadComplementario(d) : payloadMatias(d)), signal: AbortSignal.timeout(15000),
      });
      const j = (await r.json().catch(() => ({ message: `Respuesta no JSON (${r.status})` }))) as Respuesta;
      return interpretar(r.status, j);
    },
  };
}
