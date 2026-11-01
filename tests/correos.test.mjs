// Plantillas de correo: todas se arman con datos reales y con datos vacíos, sin «undefined», con el HTML escapado,
// el texto plano completo y, solo en las comerciales, el enlace de baja. Además, el embudo y los tokens de baja.
import { test } from "node:test";
import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import jitiFactory from "jiti"; // viene con Tailwind: transpila el TypeScript de las plantillas para la prueba

process.env.REGENTA_URL ??= "https://regenta.example";
const jiti = jitiFactory(fileURLToPath(import.meta.url));
const { PLANTILLAS, COMERCIALES, EMBUDO } = jiti("../src/lib/correo/plantillas.ts");

const DATOS = { nombre: "María José Pérez", empresa: "Droguería <La Ñ> & Cía", drogueria: "Droguería San José", enlace: "https://regenta.example/activar?t=abc", plan: "Pro", plan_id: "pro",
  vence: "15 de noviembre de 2026", monto: 139900, periodo: "mes", referencia: "RG-PRO-X-ABCDEF12", baja: "https://regenta.example/baja?t=zzz" };

for (const [nombre, f] of Object.entries(PLANTILLAS)) {
  test(`plantilla ${nombre}`, () => {
    for (const d of [DATOS, { baja: DATOS.baja }]) {
      const c = f(d);
      for (const k of ["asunto", "html", "texto", "previa"]) {
        assert.ok(typeof c[k] === "string" && c[k].length > 0, `${k} vacío`);
        assert.doesNotMatch(c[k], /undefined|null|NaN|\[object Object\]/, `${k} con valores sin datos`);
      }
      assert.ok(c.asunto.length <= 90, `asunto largo (${c.asunto.length})`);
      assert.doesNotMatch(c.html, /<La Ñ>/, "HTML sin escapar");
      assert.match(c.html, /NIT 901\.845\.370-5/, "pie legal");
      assert.match(c.html, /\/privacidad/, "política de datos");
      const comercial = COMERCIALES.includes(nombre);
      assert.equal(c.html.includes("Darte de baja"), comercial, comercial ? "falta la baja" : "un correo de servicio no lleva baja");
      if (comercial) assert.match(c.texto, /Darte de baja: https:\/\//);
      if (d === DATOS && /invitacion|restablecer/.test(nombre)) { assert.ok(c.html.includes(DATOS.enlace)); assert.ok(c.texto.includes(DATOS.enlace)); }
      for (const href of c.html.matchAll(/href="([^"]+)"/g)) assert.match(href[1], /^(https:\/\/|mailto:)/, `enlace raro ${href[1]}`);
    }
  });
}

test("embudo: cinco correos comerciales en días crecientes", () => {
  assert.equal(EMBUDO.length, 5);
  for (let i = 1; i < EMBUDO.length; i++) assert.ok(EMBUDO[i][1] > EMBUDO[i - 1][1]);
  for (const [p] of EMBUDO) assert.ok(COMERCIALES.includes(p));
});

test("ninguna plantilla promete aval oficial ni «proveedor tecnológico autorizado»", () => {
  for (const f of Object.values(PLANTILLAS)) {
    const t = f(DATOS).texto.toLowerCase();
    assert.doesNotMatch(t, /proveedor tecnol[oó]gico autorizado|avalad[oa] por la dian|[uú]nic[oa] con ia|el m[aá]s elegido/);
  }
});
