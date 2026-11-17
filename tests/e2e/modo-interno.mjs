// Modo «droguería interna (sin DIAN)» en el navegador: la demo pasa a modo interno solo durante la prueba. Menú sin caja
// ni DIAN, /caja lleva a Entregas, inicio propio; entrega desde la pantalla con el lote que vence antes y comprobante
// «no es factura»; controlado exige fórmula y queda en el libro de control especial; Excel e impresión; la cajera
// entrega pero no anula; el dueño anula con motivo y las unidades vuelven; celular sin desbordes; de vuelta a modo venta
// todo queda como antes.
// Uso: servidor (REGENTA_DEMO=1) con la base recién sembrada → BASE=http://localhost:4503 node tests/e2e/modo-interno.mjs
import { esXlsx, textoXlsx } from "../ayudas/xlsx.mjs";
import { esperarCarga } from "../ayudas/carga.mjs";
import { chromium, devices } from "playwright-core";
import { mkdirSync } from "node:fs";
import pg from "pg";

const B = process.env.BASE ?? "http://localhost:4500";
const OUT = process.env.OUT ?? "test-results";
mkdirSync(OUT, { recursive: true });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/regenta?host=/tmp" });
const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium" });
{ const nc = b.newContext.bind(b); b.newContext = async (o) => { const c = await nc({ locale: "es-CO", timezoneId: "America/Bogota", ...o }); await c.addInitScript(() => { try { sessionStorage.setItem("regenta_demo_v1", JSON.stringify({ hechos: [], ofertas: ["prueba", "prueba"], cerrada: true, inicio: Date.now() })); } catch {} }); return c; }; }
let fallos = 0;
const ok = (c, m, x = "") => { console.log(`${c ? "PASS" : "FAIL"} ${m}${x ? " — " + x : ""}`); if (!c) fallos++; };
const EMP = "10000000-0000-4000-8000-00000000000a";
const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
const desborde = (p) => p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
const stockLote = async (lote) => Number((await pool.query(`select unidades from v_stock_lotes where lote_id = $1`, [lote])).rows[0].unidades);

async function entrar(quien, opciones = { viewport: { width: 1440, height: 900 } }) {
  const ctx = await b.newContext(opciones);
  const p = await ctx.newPage();
  esperarCarga(p);
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("console", (m) => m.type() === "error" && !/status of 4\d\d/.test(m.text()) && errs.push(m.text()));
  await p.goto(B + "/entrar"); await p.getByRole("button", { name: new RegExp(quien) }).click(); await p.waitForURL(/\/(caja|inicio|entregas)/);
  return { ctx, p, errs };
}

// Producto sin fórmula con al menos dos lotes vigentes (para ver que sale primero el que vence antes) y el controlado.
const prod = (await pool.query(`select p.id, p.nombre, p.unidades_por_caja from productos p
  where p.empresa_id = $1 and p.activo and not p.requiere_formula and p.unidades_por_caja > 1
    and (select count(*) from v_stock_vigente v where v.producto_id = p.id and v.unidades >= 2) >= 2
  order by p.nombre limit 1`, [EMP])).rows[0];
const lotes = (await pool.query(`select lote_id, lote, unidades from v_stock_vigente where producto_id = $1 and unidades > 0 order by vence nulls last, lote_id`, [prod.id])).rows;
const controlado = (await pool.query(`select p.id, p.nombre from productos p where p.empresa_id = $1 and p.control_especial
  and exists (select 1 from v_stock_vigente v where v.producto_id = p.id and v.unidades >= 2) limit 1`, [EMP])).rows[0];
ok(!!prod && lotes.length >= 2 && !!controlado, "la demo trae un producto con dos lotes vigentes y un controlado", `${prod?.nombre} · ${controlado?.nombre}`);
const primero = lotes[0];
await pool.query(`update empresas set modo = 'interno' where id = $1`, [EMP]);

try {
  // ── 1. Dueño: menú, caja e inicio del modo interno
  let entregaId;
  {
    const { ctx, p, errs } = await entrar("Carlos");
    const menu = p.getByRole("navigation", { name: "Principal" });
    ok(await menu.getByRole("link", { name: "Entregas" }).isVisible(), "el menú muestra Entregas");
    ok(!(await menu.getByRole("link", { name: "Caja" }).count()) && !(await menu.getByRole("link", { name: "Documentos DIAN" }).count()) && !(await menu.getByRole("link", { name: "Cartera" }).count()),
      "sin Caja, Documentos DIAN ni Cartera en el menú");
    ok(await p.getByText("Entregas hoy").isVisible() && !(await p.getByText("Vendido hoy").count()), "el inicio es el de la droguería interna");
    await p.goto(B + "/caja"); await p.waitForURL(/\/entregas$/);
    ok(p.url().endsWith("/entregas"), "/caja lleva a Entregas");

    // ── 2. Entrega desde la pantalla: 1 caja, sale primero el lote que vence antes
    await p.goto(B + "/entregas/nueva");
    await p.getByLabel("Buscar producto por nombre, laboratorio o código de barras").fill(prod.nombre.slice(0, 18));
    const fila = p.getByRole("list", { name: "Resultados" }).getByRole("listitem").filter({ hasText: prod.nombre }).first();
    await fila.getByRole("button", { name: "+ Unidad" }).click();
    await p.getByRole("button", { name: "Registrar la entrega" }).click();
    ok(await p.getByRole("alert").filter({ hasText: "Escribe el servicio o área que recibe" }).isVisible(), "sin destinatario no deja registrar y lo dice");
    await p.getByLabel("Servicio o área que recibe").fill("Urgencias adultos");
    await p.getByLabel("Autoriza").fill("Jefe de enfermería");
    await p.getByRole("button", { name: "Registrar la entrega" }).click();
    await p.waitForURL(/\/entregas\/[0-9a-f-]{36}\?nueva=1/);
    entregaId = p.url().match(/entregas\/([0-9a-f-]{36})/)[1];
    ok(await p.getByRole("status").filter({ hasText: "registrada" }).isVisible(), "confirma la entrega registrada");
    ok(await p.getByText("No es factura de venta").isVisible(), "el comprobante dice que no es factura de venta");
    ok(await stockLote(primero.lote_id) === primero.unidades - 1, "salió del lote que vence antes", primero.lote);
    const mov = (await pool.query(`select tipo, cantidad from movimientos where ref_id = $1`, [entregaId])).rows;
    ok(mov.length === 1 && mov[0].tipo === "entrega" && mov[0].cantidad === -1, "un movimiento de entrega de −1", JSON.stringify(mov));

    // ── 3. Controlado: sin fórmula no sale; con fórmula queda en el libro de control especial
    const base = { idem_key: `e2e-ctrl-${Date.now()}`, destinatario_tipo: "paciente", destinatario: "Paciente Prueba", documento: "1234567", servicio: "Hospitalización",
      autoriza: "Médico de turno", lineas: [{ producto_id: controlado.id, presentacion: "unidad", cantidad: 1 }] };
    const sin = await p.request.post(B + "/api/entregas", { data: base });
    ok(sin.status() === 422 && /documento del paciente/.test((await sin.json()).error), "controlado sin fórmula: 422 con el dato que falta");
    const con = await p.request.post(B + "/api/entregas", { data: { ...base, formula: { paciente_tipo_doc: "CC", paciente_doc: "1234567", paciente_nombre: "Paciente Prueba",
      medico_nombre: "Dra. Prueba", medico_registro: "RM-77", formula_numero: "R-2026-1", formula_fecha: hoy } } });
    const cj = await con.json();
    ok(con.status() === 200 && cj.entrega_id, "controlado con fórmula: registrado", JSON.stringify(cj));
    const rep = await p.request.post(B + "/api/entregas", { data: { ...base, formula: { paciente_tipo_doc: "CC", paciente_doc: "1234567", paciente_nombre: "Paciente Prueba",
      medico_nombre: "Dra. Prueba", medico_registro: "RM-77", formula_numero: "R-2026-1", formula_fecha: hoy } } });
    ok((await rep.json()).repetida === true, "el mismo envío dos veces se registra una sola vez");
    await p.goto(B + "/control-especial");
    ok(await p.getByRole("link", { name: `EI-${cj.numero}` }).first().isVisible(), "el libro de control especial muestra la entrega como dispensación");
    const anexo = await (await p.request.get(B + `/api/control-especial/anexo13?mes=${hoy.slice(0, 7)}`)).json();
    const fa = anexo.filas.find((f) => f.id === controlado.id);
    ok(fa && fa.dispensado >= 1 && fa.inicial + fa.entradas - fa.salidas === fa.final, "el Anexo 13 la cuenta como dispensación y cuadra", JSON.stringify({ d: fa?.dispensado, f: fa?.final }));

    // ── 4. Lista, consumo, Excel e impresión
    await p.goto(B + "/entregas");
    ok(await p.getByRole("heading", { name: "Consumo por servicio o área" }).isVisible() && await p.getByText("Urgencias adultos").first().isVisible(), "la lista muestra el consumo por servicio");
    const x = await p.request.get(B + `/api/entregas?desde=${hoy}&hasta=${hoy}&formato=excel`);
    ok(x.status() === 200 && esXlsx(x.headers()["content-type"], x.headers()["content-disposition"]) && /Urgencias adultos/.test(textoXlsx(await x.body())), "Excel de entregas con sus filas");
    const imp = await ctx.newPage();
    await imp.goto(B + `/entregas/${entregaId}/imprimir`);
    ok(await imp.getByRole("heading", { name: /Entrega interna EI-/ }).isVisible() && await imp.getByText("Recibe:").count() === 1, "comprobante imprimible con firmas");
    await imp.close();
    ok(errs.length === 0, "dueño sin errores en la consola", errs.slice(0, 3).join(" | "));
    await ctx.close();
  }

  // ── 5. Cajera: entrega, pero no anula
  {
    const { ctx, p, errs } = await entrar("Laura");
    await p.waitForURL(/\/entregas$/);
    ok(/\/entregas$/.test(p.url()), "la cajera entra directo a Entregas", p.url());
    const r = await p.request.post(B + "/api/entregas", { data: { idem_key: `e2e-caj-${Date.now()}`, destinatario_tipo: "empleado", destinatario: "Auxiliar Prueba",
      autoriza: "Coordinadora", lineas: [{ producto_id: prod.id, presentacion: "unidad", cantidad: 1 }] } });
    ok(r.status() === 200, "la cajera registra entregas", String(r.status()));
    await p.goto(B + `/entregas/${entregaId}`);
    ok(!(await p.getByRole("button", { name: /Anular la entrega/ }).count()), "la cajera no ve Anular");
    const an = await p.request.post(B + `/api/entregas/${entregaId}/anular`, { data: { motivo: "intento de la cajera" } });
    ok(an.status() === 403, "la API no deja anular a la cajera", String(an.status()));
    ok(errs.length === 0, "cajera sin errores en la consola", errs.slice(0, 3).join(" | "));
    await ctx.close();
  }

  // ── 6. Dueño anula con motivo: las unidades vuelven
  {
    const { ctx, p } = await entrar("Carlos");
    const antes = await stockLote(primero.lote_id);
    await p.goto(B + `/entregas/${entregaId}`);
    await p.getByRole("button", { name: /Anular la entrega/ }).click();
    await p.getByLabel("Motivo de la anulación").fill("Se registró en el servicio equivocado");
    await p.getByRole("button", { name: "Anular", exact: true }).click();
    await p.getByRole("status").filter({ hasText: "ANULADA" }).waitFor();
    ok(await stockLote(primero.lote_id) === antes + 1, "la unidad volvió a su lote");
    await ctx.close();
  }

  // ── 7. Celular: sin desbordes
  {
    const { ctx, p } = await entrar("Carlos", { ...devices["iPhone 13"] });
    for (const ruta of ["/entregas", "/entregas/nueva", `/entregas/${entregaId}`, "/inicio"]) {
      await p.goto(B + ruta);
      ok(await desborde(p) <= 1, `celular sin desborde horizontal en ${ruta}`);
    }
    await p.screenshot({ path: `${OUT}/modo-interno-celular.png`, fullPage: true });
    await ctx.close();
  }
} finally {
  await pool.query(`update empresas set modo = 'venta' where id = $1`, [EMP]);
}

// ── 8. De vuelta a modo venta: todo como antes
{
  const { ctx, p, errs } = await entrar("Carlos");
  const menu = p.getByRole("navigation", { name: "Principal" });
  ok(await menu.getByRole("link", { name: "Caja" }).isVisible() && !(await menu.getByRole("link", { name: "Entregas" }).count()), "modo venta: vuelve la Caja y sale Entregas");
  ok(await p.getByText("Vendido hoy").isVisible(), "modo venta: el inicio de siempre");
  await p.goto(B + "/entregas"); await p.waitForURL(/\/caja/);
  ok(/\/caja/.test(p.url()), "modo venta: /entregas lleva a la caja");
  const r = await p.request.post(B + "/api/entregas", { data: { idem_key: `e2e-venta-${Date.now()}`, destinatario_tipo: "servicio", destinatario: "Urgencias", autoriza: "Jefe",
    lineas: [{ producto_id: prod.id, presentacion: "unidad", cantidad: 1 }] } });
  ok(r.status() === 422 && /modo droguería interna/.test((await r.json()).error), "modo venta: la API no registra entregas");
  ok(errs.length === 0, "modo venta sin errores en la consola", errs.slice(0, 3).join(" | "));
  await ctx.close();
}

await b.close(); await pool.end();
console.log(fallos ? `\n${fallos} fallo(s)` : "\nTodo en verde");
process.exit(fallos ? 1 : 0);
