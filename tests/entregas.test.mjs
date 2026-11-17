// Modo droguería interna · reglas puras de la entrega (formulario y servidor) y su lugar en el libro de control especial.
import { test } from "node:test";
import assert from "node:assert/strict";
import { DESTINATARIOS, ENTREGA_VACIA, errorEntrega, esDestinatario, limpiarDocumento, numeroEntrega, servicioDe } from "../src/lib/entregas.ts";
import { clasificar, TIPO_ASIENTO } from "../src/lib/anexo13.ts";

const bien = { ...ENTREGA_VACIA, destinatario: "Urgencias", autoriza: "Jefe de enfermería" };

test("entrega completa: sin errores", () => {
  assert.equal(errorEntrega(bien, 1), null);
  assert.equal(errorEntrega({ ...bien, destinatario_tipo: "paciente", destinatario: "Ana Pérez", documento: "1.234.567" }, 3), null);
});

test("entrega incompleta: el primer dato que falta, en palabras de la droguería", () => {
  assert.equal(errorEntrega({ ...bien, destinatario_tipo: "proveedor" }, 1), "Elige a quién se entrega");
  assert.equal(errorEntrega({ ...bien, destinatario: " U " }, 1), "Escribe el servicio o área que recibe");
  assert.equal(errorEntrega({ ...bien, destinatario_tipo: "empleado", destinatario: "" }, 1), "Escribe el nombre de quien recibe");
  assert.match(errorEntrega({ ...bien, documento: "12" }, 1), /sin puntos/);
  assert.equal(errorEntrega({ ...bien, autoriza: "" }, 1), "Escribe quién autoriza la entrega");
  assert.equal(errorEntrega(bien, 0), "Agrega al menos un producto a la entrega");
  assert.equal(errorEntrega(bien, 101), "Una entrega lleva hasta 100 productos");
  assert.match(errorEntrega({ ...bien, observacion: "x".repeat(301) }, 1), /300/);
});

test("nombres: número EI, destinatarios, documento limpio y servicio para agrupar", () => {
  assert.equal(numeroEntrega(12), "EI-12");
  assert.ok(esDestinatario("sede")); assert.ok(!esDestinatario("cliente"));
  assert.deepEqual(Object.keys(DESTINATARIOS), ["servicio", "paciente", "empleado", "sede", "otro"]);
  assert.equal(limpiarDocumento("cc 1.234-567"), "CC1234567");
  assert.equal(servicioDe({ destinatario_tipo: "paciente", destinatario: "Ana", servicio: "Hospitalización" }), "Hospitalización");
  assert.equal(servicioDe({ destinatario_tipo: "sede", destinatario: "Sede Norte", servicio: null }), "Sede Norte");
  assert.equal(servicioDe({ destinatario_tipo: "empleado", destinatario: "Luis", servicio: null }), "Sin servicio");
});

test("libro de control especial: la entrega con fórmula es dispensación, sin fórmula se nombra aparte, su anulación es reintegro", () => {
  assert.equal(clasificar("entrega", -5, true), "dispensacion");
  assert.equal(clasificar("entrega", -5, false), "entrega_interna");
  assert.equal(clasificar("entrega", 5, true), "reintegro");
  assert.equal(TIPO_ASIENTO.entrega_interna, "Entrega interna sin fórmula registrada");
  assert.equal(clasificar("venta", -1, true), "dispensacion", "las ventas siguen igual");
});
