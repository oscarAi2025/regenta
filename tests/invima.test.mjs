// Pruebas del lector de alertas del INVIMA con títulos reales publicados en invima.gov.co (verificados el 01/11/2026).
// Uso: node --experimental-strip-types --test tests/invima.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { registros, lotes, palabras, parsearListado, parsearDetalle } from "../src/lib/invima-parse.ts";

test("lote y palabras clave desde títulos reales", () => {
  const t329 = "FALSIFICACIÓN DEL PRODUCTO BUSCAPINA® COMPOSITUM NF TABLETAS RECUBIERTAS LOTE F0537A";
  assert.deepEqual(lotes(t329), ["F0537A"]);
  assert.deepEqual(palabras(t329), ["buscapina", "compositum"]);
  const t368 = "FALSIFICACIÓN DEL PRODUCTO DARZALEX® SC 120 MG/ML SOLUCIÓN INYECTABLE, CON LOTE PJS0C02";
  assert.deepEqual(lotes(t368), ["PJS0C02"]);
  assert.deepEqual(palabras(t368), ["darzalex"]);
  assert.deepEqual(lotes("RIESGO DE NEFROPATÍA ASOCIADA A ANTICOAGULANTES ORALES"), []);
});

test("registros sanitarios y varios lotes en el texto del detalle", () => {
  assert.deepEqual(registros("Registro sanitario: INVIMA 2020M-003171-R4 y también INVIMA2019M- 0012345 - R1"), ["INVIMA 2020M-003171-R4", "INVIMA 2019M-0012345-R1"]);
  assert.deepEqual(lotes("Lote(s) / Serial(es): AB1234, CD5678 y EF9012. Fecha de vencimiento: 07/26"), ["AB1234", "CD5678", "EF9012"]);
});

test("listado y detalle con la estructura del sitio (número, título enlazado, fecha · motivo, PDF)", () => {
  const html = `<div class="o_alerta"><span>Dirección de Medicamentos y Productos Biológicos</span><span>329-2026</span>
    <h2><a href="/alertas-sanitarias/falsificacion-del-producto-buscapina-compositum-nf-tabletas-recubiertas-lote-f0537a">FALSIFICACIÓN DEL PRODUCTO BUSCAPINA® COMPOSITUM NF TABLETAS RECUBIERTAS LOTE F0537A</a></h2>
    <p>Alerta sanitaria</p><p>09-10-2026 · Producto fraudulento</p><a href="/alertas-sanitarias/12844/pdf">PDF</a></div>
    <div class="o_alerta"><span>Dirección de Medicamentos y Productos Biológicos</span><span>153-2026</span>
    <h2><a href="/alertas-sanitarias/riesgo-de-nefropatia-asociada-a-anticoagulantes-orales">RIESGO DE NEFROPATÍA ASOCIADA A ANTICOAGULANTES ORALES</a></h2>
    <p>Informe de seguridad</p><p>30-10-2026</p><a href="/alertas-sanitarias/12979/pdf">PDF</a></div>`;
  const items = parsearListado(html);
  assert.equal(items.length, 2);
  assert.deepEqual({ ...items[0] }, { numero: "329-2026", titulo: "FALSIFICACIÓN DEL PRODUCTO BUSCAPINA® COMPOSITUM NF TABLETAS RECUBIERTAS LOTE F0537A", fecha: "2026-10-09", motivo: "Producto fraudulento", tipo: "alerta",
    url: "https://www.invima.gov.co/alertas-sanitarias/falsificacion-del-producto-buscapina-compositum-nf-tabletas-recubiertas-lote-f0537a", pdf: "https://www.invima.gov.co/alertas-sanitarias/12844/pdf", medicamentos: true });
  assert.equal(items[1].tipo, "informe");
  const det = parsearDetalle(`<dl><dt>Dirección</dt><dd>Dirección de Medicamentos y Productos Biológicos</dd></dl><table><tr><td>BUSCAPINA</td><td>INVIMA 2020M-003171-R4</td><td>OPELLA</td><td>—</td></tr></table>`);
  assert.deepEqual(det, { registros: ["INVIMA 2020M-003171-R4"], lotes: [], medicamentos: true });
});
