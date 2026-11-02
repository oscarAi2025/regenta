// Emisor MATIAS: cuerpo de la petición y lectura de respuestas. Los cuerpos de estas pruebas (POS con producto
// excluido y gravado, factura a crédito a un NIT, nota crédito POS y redondeo 3 × 3.333,33) fueron aceptados por el
// sandbox de MATIAS el 02/11/2026; el reintento del mismo número respondió 400 «ya se encuentra validado».
import { test } from "node:test";
import assert from "node:assert/strict";
import { payloadMatias, interpretar } from "../src/lib/dian/matias.ts";

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
