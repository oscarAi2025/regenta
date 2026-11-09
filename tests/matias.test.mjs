// Emisor MATIAS: cuerpo de la petición y lectura de respuestas. Los cuerpos de estas pruebas (POS con producto
// excluido y gravado, factura a crédito a un NIT, nota crédito POS y redondeo 3 × 3.333,33) fueron aceptados por el
// sandbox de MATIAS el 02/11/2026; el reintento del mismo número respondió 400 «ya se encuentra validado».
import { test } from "node:test";
import assert from "node:assert/strict";
import { payloadMatias, interpretar, destinoEmision, esRegla90, recuperarRegla90, payloadComplementario, envioMatias, esComplementario, MATIAS_COMPLEMENTARIOS, xmlEnRespuesta } from "../src/lib/dian/matias.ts";
import { xmlSimulado, MARCA_SIMULADO, nombreClave } from "../src/lib/dian/xml.ts";

const lineas = [
  { descripcion: "ACETAMINOFEN 500 MG X 10 TAB", codigo: "7702057012345", cantidad: 3, precio: 3000, iva_pct: 0, base: 9000, iva: 0, total: 9000 },
  { descripcion: "CREMA HIDRATANTE 120 ML", codigo: "7702057099999", cantidad: 1, precio: 23800, iva_pct: 19, base: 20000, iva: 3800, total: 23800 },
];
const base = {
  id: "47a1257b-d8d6-428e-b28e-abddce5b8531", prefijo: "DPOS", numero: 1, fecha: "2026-11-02T13:56:01.000Z", resolucion: "18760000001",
  emisor: { nit: "901845370", dv: "5", razon_social: "IA DEV", responsable_iva: true }, lineas,
  totales: { base: 29000, iva: 3800, total: 32800 }, punto: { cajero: "Laura", caja: "Caja 1", direccion: "Ibagué" },
};

test("POS: tipo 20, consumidor final, pagos sin el cambio, excluidos sin tributo", () => {
  const p = payloadMatias({ ...base, tipo: "pos", cliente: null, pagos: [{ medio: "efectivo", valor: 50000 }], forma_pago: { tipo: "contado" } });
  assert.equal(p.type_document_id, 20);
  assert.equal(p.operation_type_id, 1);
  assert.deepEqual(p.customer, { company_name: "CONSUMIDOR FINAL", dni: "222222222222" });
  assert.deepEqual(p.payments, [{ payment_method_id: 1, means_payment_id: 10, value_paid: "32800.00" }]);
  assert.equal(p.lines[0].tax_totals, undefined);
  assert.deepEqual(p.tax_totals, [{ tax_id: 1, percent: 19, taxable_amount: "20000.00", tax_amount: "3800.00" }]);
  assert.deepEqual(p.legal_monetary_totals, { line_extension_amount: "29000.00", tax_exclusive_amount: "20000.00", tax_inclusive_amount: "32800.00", payable_amount: "32800.00" });
  assert.equal(p.date, "2026-11-02"); assert.equal(p.time, "08:56:01"); // hora de Bogotá
  assert.ok(p.point_of_sale && p.software_manufacturer.software_name === "Regenta");
});

test("Pago mixto: primero lo electrónico, el efectivo cubre el resto", () => {
  const p = payloadMatias({ ...base, tipo: "pos", cliente: null, pagos: [{ medio: "efectivo", valor: 20000 }, { medio: "nequi", valor: 15000 }], forma_pago: { tipo: "contado" } });
  assert.deepEqual(p.payments, [{ payment_method_id: 1, means_payment_id: 47, value_paid: "15000.00" }, { payment_method_id: 1, means_payment_id: 10, value_paid: "17800.00" }]);
});

test("Factura a crédito a un NIT: tipo 7, persona jurídica, vencimiento", () => {
  const p = payloadMatias({ ...base, tipo: "factura", prefijo: "FEV", cliente: { tipo_doc: "NIT", numero_doc: "900123456", dv: "7", nombre: "DROGUERIA PRUEBA SAS", email: "compras@prueba.co" }, pagos: [], forma_pago: { tipo: "credito", vence: "2026-12-02", plazo_dias: 30 } });
  assert.equal(p.type_document_id, 7);
  assert.equal(p.customer.identity_document_id, 3); assert.equal(p.customer.type_organization_id, 1);
  assert.equal(p.send_email, 1);
  assert.deepEqual(p.payments, [{ payment_method_id: 2, means_payment_id: 1, value_paid: "32800.00", payment_due_date: "2026-12-02", duration_measure: "30" }]);
  assert.equal(p.point_of_sale, undefined);
});

test("Nota crédito de un POS: tipo 94, operación 11, referencia con CUDE", () => {
  const p = payloadMatias({ ...base, tipo: "nota_credito", prefijo: "NCPE", cliente: null, pagos: [], forma_pago: { tipo: "contado" },
    referencia: { tipo: "pos", prefijo: "DPOS", numero: 1, fecha: "2026-11-02T13:56:01.000Z", cufe: "abc" } });
  assert.equal(p.type_document_id, 94); assert.equal(p.operation_type_id, 11);
  assert.deepEqual(p.billing_reference, { number: "DPOS1", date: "2026-11-02", uuid: "abc", scheme_name: "CUDE-SHA384" });
  assert.equal(p.discrepancy_response.reference_id, "DPOS1");
});

test("Nota crédito de una factura: tipo 5, operación 12, sin scheme_name", () => {
  const p = payloadMatias({ ...base, tipo: "nota_credito", prefijo: "NCFE", cliente: null, pagos: [], forma_pago: { tipo: "contado" },
    referencia: { tipo: "factura", prefijo: "FEV", numero: 1, fecha: "2026-11-02T13:56:01.000Z", cufe: "abc" } });
  assert.equal(p.type_document_id, 5); assert.equal(p.operation_type_id, 12);
  assert.equal(p.billing_reference.scheme_name, undefined);
});

test("Respuestas: aceptado, recuperado, 98, rechazo, 422, 402, 5xx", () => {
  const ok = interpretar(200, { success: true, XmlDocumentKey: "k", response: { IsValid: "true", StatusCode: "00" }, qr: { qrDian: "https://q" } });
  assert.deepEqual([ok.ok, ok.cufe, ok.qr, ok.simulado], [true, "k", "https://q", false]);
  const rec = interpretar(400, { success: false, message: "ya se encuentra validado", data: { is_valid: 1, XmlDocumentKey: "k2" } });
  assert.equal(rec.ok && rec.cufe, "k2");
  const en98 = interpretar(200, { response: { IsValid: "false", StatusCode: "98" } });
  assert.deepEqual([en98.ok, en98.definitivo], [false, false]);
  const rech = interpretar(200, { response: { IsValid: "false", StatusCode: "99", ErrorMessage: { string: ["Regla: FAS01A"] } } });
  assert.deepEqual([rech.ok, rech.definitivo], [false, true]); assert.match(rech.error, /FAS01A/);
  assert.equal(interpretar(422, { message: "x", errors: { "customer.dni": ["obligatorio"] } }).definitivo, true);
  assert.equal(interpretar(402, { message: "sin saldo" }).definitivo, false);
  assert.equal(interpretar(500, { code: "DOCUMENT_POSSIBLY_SENT", message: "x" }).definitivo, false);
});

test("Descuento de línea: precio bruto, descuento no condicionado y base neta cuadran", () => {
  const p = payloadMatias({ ...base, tipo: "pos", cliente: null, pagos: [{ medio: "efectivo", valor: 60000 }], forma_pago: { tipo: "contado" },
    lineas: [{ descripcion: "BENET COMPLEJO B X 60", codigo: "1", cantidad: 1, precio: 52000, iva_pct: 19, base: 39436.97, iva: 7493.03, total: 46930, descuento: 5070 }],
    totales: { base: 39436.97, iva: 7493.03, total: 46930 } });
  const l = p.lines[0];
  assert.deepEqual(l.allowance_charges, [{ charge_indicator: false, discount_id: 1, allowance_charge_reason: "Descuento", amount: "4260.50", base_amount: "43697.47" }]);
  assert.equal(l.price_amount, "43697.47");
  assert.equal((Number(l.price_amount) * 1 - Number(l.allowance_charges[0].amount)).toFixed(2), l.line_extension_amount);
});

test("Nota crédito de una devolución parcial: concepto 1 (devolución parcial)", () => {
  const p = payloadMatias({ ...base, tipo: "nota_credito", prefijo: "NCPE", cliente: null, pagos: [{ medio: "efectivo", valor: 9000 }], forma_pago: { tipo: "contado" }, parcial: true,
    lineas: [lineas[0]], totales: { base: 9000, iva: 0, total: 9000 },
    referencia: { tipo: "pos", prefijo: "DPOS", numero: 1, fecha: "2026-11-02T13:56:01.000Z", cufe: "abc" } });
  assert.equal(p.discrepancy_response.response_id, "1");
  assert.equal(p.legal_monetary_totals.payable_amount, "9000.00");
  assert.equal(p.tax_totals.length, 0);
});

// ───────────── Documento soporte, nota de ajuste y nota débito (035)
// Rutas verificadas en la documentación oficial de MATIAS; tipos confirmados por su soporte (06/11/2026), pendientes de
// validar en el sandbox. Estas pruebas fijan el cuerpo que se enviaría y que el envío real queda apagado sin activar.
const proveedor = { tipo_doc: "NIT", numero_doc: "1110456789", dv: "3", nombre: "JUAN CAMPESINO", email: null, direccion: "Vereda El Salado", telefono: "3001234567" };
const soporte = {
  ...base, id: "5b0c7f0e-0f5e-4a8e-9a55-3d1f8d4e2a10", tipo: "soporte", prefijo: "DSE", numero: 7, cliente: null, proveedor, pagos: [{ medio: "efectivo", valor: 50000 }],
  forma_pago: { tipo: "contado" }, periodo: { desde: "2026-11-02", hasta: "2026-11-08" },
  lineas: [{ descripcion: "PAPA CRIOLLA · lote A1 · compra N.º 3", codigo: "L1", cantidad: 10, precio: 2000, iva_pct: 0, base: 20000, iva: 0, total: 20000 },
           { descripcion: "PANELA · lote B2 · compra N.º 4", codigo: "L2", cantidad: 10, precio: 3000, iva_pct: 0, base: 30000, iva: 0, total: 30000 }],
  totales: { base: 50000, iva: 0, total: 50000 },
};

test("Tabla de configuración: rutas de MATIAS, tipos confirmados por su soporte y nada se envía sin activar", () => {
  assert.deepEqual(Object.fromEntries(Object.entries(MATIAS_COMPLEMENTARIOS).map(([k, v]) => [k, [v.ruta, v.type_document_id, v.operation_type_id]])), {
    soporte: ["/api/ubl2.1/ds/document", 11, 9], ajuste_soporte: ["/api/ubl2.1/ds/adjustment-note", 11, 10], nota_debito: ["/api/ubl2.1/notes/credit", 4, null],
  });
  assert.ok(Object.values(MATIAS_COMPLEMENTARIOS).every((c) => /validar en sandbox/.test(c.nota)));
  assert.equal(envioMatias("soporte", false).habilitado, false);
  assert.match(envioMatias("soporte", false).mensaje, /no está activado/);
  assert.equal(envioMatias("nota_debito", true).habilitado, true);
  const sinTipo = { ...MATIAS_COMPLEMENTARIOS, soporte: { ...MATIAS_COMPLEMENTARIOS.soporte, type_document_id: null } };
  assert.equal(envioMatias("soporte", true, sinTipo).habilitado, false, "sin type_document_id no se envía aunque esté activado");
  assert.deepEqual(["pos", "factura", "nota_credito", "soporte", "ajuste_soporte", "nota_debito"].map(esComplementario), [false, false, false, true, true, true]);
});

test("Documento soporte semanal: tipo 11 / operación 9, proveedor como tercero, periodo, totales y sin referencia", () => {
  const p = payloadComplementario(soporte);
  assert.equal(p.type_document_id, 11); assert.equal(p.operation_type_id, 9);
  assert.equal(p.resolution_number, "18760000001"); assert.equal(p.prefix, "DSE"); assert.equal(p.document_number, "7");
  assert.deepEqual(p.customer, { identity_document_id: 3, type_organization_id: 1, tax_regime_id: 2, tax_level_id: 5, company_name: "JUAN CAMPESINO", dni: "1110456789", dv: "3",
    email: "", country_id: 45, address: "Vereda El Salado", phone: "3001234567" });
  assert.deepEqual(p.invoice_period, { start_date: "2026-11-02", end_date: "2026-11-08" });
  assert.deepEqual(p.legal_monetary_totals, { line_extension_amount: "50000.00", tax_exclusive_amount: "0.00", tax_inclusive_amount: "50000.00", payable_amount: "50000.00" });
  assert.deepEqual(p.payments, [{ payment_method_id: 1, means_payment_id: 10, value_paid: "50000.00" }]);
  assert.equal(p.lines.length, 2); assert.equal(p.lines[0].line_extension_amount, "20000.00"); assert.equal(p.lines[0].price_amount, "2000.00");
  assert.equal(p.billing_reference, undefined); assert.equal(p.discrepancy_response, undefined);
  for (const k of ["resolution_number", "type_document_id", "payments", "customer", "lines", "legal_monetary_totals"]) assert.ok(p[k] !== undefined && p[k] !== null, `obligatorio ${k}`);
});

test("Nota de ajuste: tipo 11 / operación 10, referencia al CUDS del soporte y concepto de anulación o corrección", () => {
  const ref = { tipo: "soporte", prefijo: "DSE", numero: 7, fecha: "2026-11-06T15:00:00.000Z", cufe: "cuds-del-soporte" };
  const an = payloadComplementario({ ...soporte, tipo: "ajuste_soporte", prefijo: "NAE", numero: 1, concepto: "anulacion", motivo: "Compra duplicada", referencia: ref });
  assert.equal(an.type_document_id, 11); assert.equal(an.operation_type_id, 10);
  assert.deepEqual(an.billing_reference, { number: "DSE7", date: "2026-11-06", uuid: "cuds-del-soporte" });
  assert.deepEqual(an.discrepancy_response, { reference_id: "DSE7", response_id: "2" });
  assert.equal(an.notes, "Compra duplicada");
  assert.equal(an.invoice_period, undefined, "el periodo es del soporte, no de la nota");
  const co = payloadComplementario({ ...soporte, tipo: "ajuste_soporte", prefijo: "NAE", numero: 2, concepto: "correccion", motivo: "Precio", referencia: ref,
    lineas: [{ descripcion: "Precio mal liquidado", cantidad: 1, precio: 1500, iva_pct: 19, base: 1500, iva: 285, total: 1785 }], totales: { base: 1500, iva: 285, total: 1785 } });
  assert.equal(co.discrepancy_response.response_id, "5");
  assert.deepEqual(co.tax_totals, [{ tax_id: 1, percent: 19, taxable_amount: "1500.00", tax_amount: "285.00" }]);
  assert.equal(co.legal_monetary_totals.payable_amount, "1785.00");
});

test("Nota débito: tipo 4 sin operación, adquirente de la factura, referencia al CUFE y mayor valor", () => {
  const p = payloadComplementario({ ...base, tipo: "nota_debito", prefijo: "NDE", numero: 3, pagos: [{ medio: "efectivo", valor: 1190 }], forma_pago: { tipo: "contado" }, concepto: "mayor_valor", motivo: "Intereses",
    cliente: { tipo_doc: "NIT", numero_doc: "900123456", dv: "7", nombre: "HOGAR SAN JOSE SAS", email: "compras@hogar.co" },
    lineas: [{ descripcion: "Intereses de mora", cantidad: 1, precio: 1000, iva_pct: 19, base: 1000, iva: 190, total: 1190 }], totales: { base: 1000, iva: 190, total: 1190 },
    referencia: { tipo: "factura", prefijo: "FEV", numero: 12, fecha: "2026-11-01T15:00:00.000Z", cufe: "cufe-factura" } });
  assert.equal(p.type_document_id, 4); assert.equal(p.operation_type_id, undefined);
  assert.equal(p.customer.identity_document_id, 3); assert.equal(p.customer.dni, "900123456");
  assert.deepEqual(p.billing_reference, { number: "FEV12", date: "2026-11-01", uuid: "cufe-factura" });
  assert.equal(p.discrepancy_response.response_id, "4");
  assert.equal(p.legal_monetary_totals.payable_amount, "1190.00");
});

test("XML: el simulado va marcado y escapado; el de la respuesta se detecta sin suponer el campo (texto o base64)", () => {
  const x = xmlSimulado({ ...soporte, proveedor: { ...proveedor, nombre: "JUAN <&> \"CAMPESINO\"" } }, "abc123");
  assert.ok(x.startsWith('<?xml version="1.0" encoding="UTF-8"?>'));
  assert.ok(x.includes(MARCA_SIMULADO) && x.includes('simulado="true"'));
  assert.ok(x.includes("<CUDS>abc123</CUDS>") && x.includes("JUAN &lt;&amp;&gt; &quot;CAMPESINO&quot;"));
  assert.ok(x.includes('<Periodo desde="2026-11-02" hasta="2026-11-08"/>'));
  assert.deepEqual(["factura", "pos", "nota_credito", "soporte", "ajuste_soporte", "nota_debito"].map(nombreClave), ["CUFE", "CUDE", "CUDE", "CUDS", "CUDS", "CUDE"]);
  const xml = '<?xml version="1.0"?><AttachedDocument>ok</AttachedDocument>';
  assert.equal(xmlEnRespuesta({ success: true, cualquier_nombre: xml }), xml);
  assert.equal(xmlEnRespuesta({ data: { otro: Buffer.from(xml).toString("base64") } }), xml);
  assert.equal(xmlEnRespuesta({ message: "sin xml", data: { is_valid: 1 } }), null);
  const ok = interpretar(200, { XmlDocumentKey: "k", response: { IsValid: "true" }, pdf: { url: "https://matias/x.pdf" }, xml_base64: Buffer.from(xml).toString("base64") });
  assert.equal(ok.ok && ok.xml, xml); assert.equal(ok.ok && ok.pdf, "https://matias/x.pdf");
});

test("destino: cliente con su UUID; la cuenta principal sin client_uuid y solo con su NIT", () => {
  const principal = { uuid: "11111111-2222-4333-8444-555555555555", nit: "901845370" };
  assert.deepEqual(destinoEmision("47a1257b-d8d6-428e-b28e-abddce5b8531", "900000001", principal), { q: "?client_uuid=47a1257b-d8d6-428e-b28e-abddce5b8531" });
  assert.deepEqual(destinoEmision(principal.uuid, "901845370", principal), { q: "" });
  assert.deepEqual(destinoEmision(principal.uuid, "901.845.370", principal), { q: "" });
  assert.ok("error" in destinoEmision(principal.uuid, "900000001", principal));
});

test("regla 90 (documento procesado anteriormente): se recupera si la DIAN lo tiene validado", () => {
  assert.ok(esRegla90("Rechazo DIAN 99: Regla: 90, Rechazo: Documento procesado anteriormente."));
  assert.ok(!esRegla90("Rechazo DIAN 99: Regla: 900, otra cosa"));
  assert.ok(!esRegla90("Datos inválidos: El campo resolution_number es requerido"));
  const ok = recuperarRegla90({ document: { is_valid: true, document_key: "abc123", qr: { qrDian: "https://catalogo-vpfe.dian.gov.co/document/searchqr?documentkey=abc123" } } });
  assert.equal(ok.ok, true); assert.equal(ok.cufe, "abc123"); assert.equal(ok.simulado, false);
  assert.equal(recuperarRegla90({ document: { is_valid: false, document_key: "abc123" } }), null);
  assert.equal(recuperarRegla90(null), null);
});
