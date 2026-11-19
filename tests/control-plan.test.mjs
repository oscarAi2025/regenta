// Control especial va en los planes superiores: Esencial no lo incluye; Pro, Cadena y Socio sí; la demo lo muestra.
import { test } from "node:test";
import assert from "node:assert/strict";
import { controlEspecialIncluido, PLANES, PLANES_CONTROL_ESPECIAL } from "../src/lib/planes.ts";

test("Esencial no incluye control especial; Pro, Cadena y Socio sí", () => {
  assert.equal(controlEspecialIncluido("esencial"), false);
  for (const p of ["pro", "cadena", "socio"]) assert.equal(controlEspecialIncluido(p), true, p);
  assert.deepEqual([...PLANES_CONTROL_ESPECIAL], ["pro", "cadena", "socio"]);
});

test("plan desconocido o vacío: no incluye; la demo siempre lo muestra", () => {
  for (const p of [null, undefined, "", "gratis"]) assert.equal(controlEspecialIncluido(p), false, String(p));
  assert.equal(controlEspecialIncluido("esencial", true), true);
});

test("lo publicado en los planes dice lo mismo: Pro lo incluye y Esencial no lo menciona", () => {
  const txt = (id) => PLANES.find((p) => p.id === id).incluye.join(" · ");
  assert.match(txt("pro"), /Control especial/);
  assert.doesNotMatch(txt("esencial"), /control especial/i);
});
