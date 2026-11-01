// Firmas de pagos: el ejemplo oficial de Wompi y firmas calculadas de forma independiente.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, createHmac } from "node:crypto";
import { firmaIntegridadWompi, eventoWompiValido, firmaStripeValida } from "../src/lib/pagos-firma.ts";

test("Wompi: firma de integridad igual al ejemplo de la documentación", () => {
  assert.equal(firmaIntegridadWompi("sk8-438k4-xmxm392-sn2m", 2490000, "COP", "prod_integrity_Z5mMke9x0k8gpErbDqwrJXMqsI6SFli6"),
    "37c8407747e595535433ef8f6a811d853cd943046624a0ec04662b17bbf33bf5");
});

test("Wompi: checksum de evento válido y alterado", () => {
  const e = { event: "transaction.updated", data: { transaction: { id: "1234-1610641025-49201", status: "APPROVED", amount_in_cents: 4490000 } },
    signature: { properties: ["transaction.id", "transaction.status", "transaction.amount_in_cents"] }, timestamp: 1530291411 };
  e.signature.checksum = createHash("sha256").update("1234-1610641025-49201APPROVED44900001530291411test_events_x").digest("hex").toUpperCase();
  assert.equal(eventoWompiValido(e, "test_events_x"), true);
  assert.equal(eventoWompiValido(e, "otro"), false);
  assert.equal(eventoWompiValido({ ...e, data: { transaction: { ...e.data.transaction, amount_in_cents: 100 } } }, "test_events_x"), false);
  assert.equal(eventoWompiValido({ ...e, signature: undefined }, "test_events_x"), false);
});

test("Stripe: firma v1 válida, vencida y con secreto equivocado", () => {
  const cuerpo = '{"id":"evt_1","type":"checkout.session.completed"}', t = 1700000000;
  const v1 = createHmac("sha256", "whsec_prueba").update(`${t}.${cuerpo}`).digest("hex");
  assert.equal(firmaStripeValida(cuerpo, `t=${t},v1=${v1},v0=abc`, "whsec_prueba", t + 10), true);
  assert.equal(firmaStripeValida(cuerpo, `t=${t},v1=deadbeef,v1=${v1}`, "whsec_prueba", t), true, "acepta una de varias v1");
  assert.equal(firmaStripeValida(cuerpo, `t=${t},v1=${v1}`, "whsec_prueba", t + 301), false, "fuera de tolerancia");
  assert.equal(firmaStripeValida(cuerpo, `t=${t},v1=${v1}`, "whsec_otro", t), false);
  assert.equal(firmaStripeValida(cuerpo + " ", `t=${t},v1=${v1}`, "whsec_prueba", t), false, "cuerpo alterado");
  assert.equal(firmaStripeValida(cuerpo, null, "whsec_prueba", t), false);
});
