import { test } from "node:test";
import assert from "node:assert/strict";
import { textoPedidoFarmagenericos as texto, enlaceWhatsAppFarmagenericos as enlace } from "../src/lib/pedido-farmagenericos.ts";

test("pedido a Farmagenéricos: identifica la droguería y lista cada producto con sus cajas", () => {
  const t = texto({ drogueria: "Droguería La 14", nit: "900123456-7", ciudad: "Ibagué", lineas: [
    { nombre: "Acetaminofén 500 mg x 100", laboratorio: "Delta", cajas: 3 },
    { nombre: "Loratadina 10 mg x 10", laboratorio: null, cajas: 1 },
  ] });
  assert.match(t, /^Hola, Farmagenéricos\. Pedido desde Regenta de Droguería La 14 \(NIT 900123456-7, Ibagué\):/);
  assert.match(t, /• 3 × Acetaminofén 500 mg x 100 \(Delta\)/);
  assert.match(t, /• 1 × Loratadina 10 mg x 10\n/);
  assert.match(t, /2 productos · 4 cajas\./);
});

test("pedido a Farmagenéricos: singular, sin ciudad y enlace al WhatsApp de Farmagenéricos", () => {
  const t = texto({ drogueria: "D", nit: "1", ciudad: null, lineas: [{ nombre: "X", laboratorio: null, cajas: 1 }] });
  assert.match(t, /\(NIT 1\):/);
  assert.match(t, /1 producto · 1 caja\./);
  assert.ok(enlace(t).startsWith("https://wa.me/573212141970?text=Hola%2C%20Farmag"));
});
