// Visitas a la demo: ubicación de Netlify, dispositivo y origen (lógica pura). node --experimental-strip-types --test tests/visitas-demo.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { geoDesde, dispositivo, leerOrigen } from "../src/lib/visitas-demo-core.ts";

test("ubicación desde la cabecera de Netlify (base64 y JSON plano)", () => {
  const g = { city: "Ibagué", country: { code: "CO", name: "Colombia" }, subdivision: { code: "TOL", name: "Tolima" } };
  assert.deepEqual(geoDesde(Buffer.from(JSON.stringify(g)).toString("base64")), { ciudad: "Ibagué", region: "Tolima", pais: "CO" });
  assert.deepEqual(geoDesde(JSON.stringify(g)), { ciudad: "Ibagué", region: "Tolima", pais: "CO" });
  assert.deepEqual(geoDesde(null), { ciudad: null, region: null, pais: null });
  assert.deepEqual(geoDesde("basura%%"), { ciudad: null, region: null, pais: null });
});

test("dispositivo, navegador y sistema", () => {
  assert.deepEqual(dispositivo("Mozilla/5.0 (Linux; Android 14; SM-A145M) AppleWebKit/537.36 Chrome/131.0 Mobile Safari/537.36"), { dispositivo: "celular", navegador: "Chrome", sistema: "Android" });
  assert.deepEqual(dispositivo("Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 Version/18.0 Mobile/15E148 Safari/604.1"), { dispositivo: "celular", navegador: "Safari", sistema: "iOS" });
  assert.deepEqual(dispositivo("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/131.0 Safari/537.36 Edg/131.0"), { dispositivo: "computador", navegador: "Edge", sistema: "Windows" });
  assert.equal(dispositivo("Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Safari").dispositivo, "tablet");
  assert.equal(dispositivo("").dispositivo, null);
});

test("origen del primer contacto (codificado o no, y basura)", () => {
  const v = JSON.stringify({ f: "google-ads", c: "drogas-tolima", l: "/software/facturacion", r: "google.com" });
  assert.deepEqual(leerOrigen(encodeURIComponent(v)), { origen: "google-ads", campana: "drogas-tolima", landing: "/software/facturacion", referente: "google.com" });
  assert.deepEqual(leerOrigen(v), leerOrigen(encodeURIComponent(v)));
  assert.deepEqual(leerOrigen("{malo"), { origen: null, campana: null, landing: null, referente: null });
});
