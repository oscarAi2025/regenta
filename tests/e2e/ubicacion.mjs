// Ubicación del producto en la estantería: la bodega la pone desde el inventario, la caja la muestra al buscar, el
// inventario se ordena por ubicación y busca por ella, el dueño la cambia en el producto, sale en el Excel y se carga
// desde la importación; la cajera no la cambia; celular sin desbordes.
// Uso: servidor con REGENTA_DEMO=1 y REGENTA_DEMO_SIN_LIMITES=1 (la importación en la demo) y la base recién sembrada →
//      BASE=http://localhost:4503 node tests/e2e/ubicacion.mjs
import { esXlsx, textoXlsx } from "../ayudas/xlsx.mjs";
import { esperarCarga } from "../ayudas/carga.mjs";
import { chromium, devices } from "playwright-core";
import pg from "pg";

const B = process.env.BASE ?? "http://localhost:4500";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/regenta?host=/tmp" });
const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium" });
{ const nc = b.newContext.bind(b); b.newContext = async (o) => { const c = await nc({ locale: "es-CO", timezoneId: "America/Bogota", ...o }); await c.addInitScript(() => { try { sessionStorage.setItem("regenta_demo_v1", JSON.stringify({ hechos: [], ofertas: ["prueba", "prueba"], cerrada: true, inicio: Date.now() })); } catch {} }); return c; }; }
let fallos = 0;
const ok = (c, m, x = "") => { console.log(`${c ? "PASS" : "FAIL"} ${m}${x ? " — " + x : ""}`); if (!c) fallos++; };
const EMP = "10000000-0000-4000-8000-00000000000a";
const ubic = async (id) => (await pool.query(`select ubicacion from productos where id = $1`, [id])).rows[0].ubicacion;

async function entrar(quien, opciones = { viewport: { width: 1440, height: 900 } }) {
  const ctx = await b.newContext(opciones);
  const p = await ctx.newPage();
  esperarCarga(p);
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("console", (m) => m.type() === "error" && !/status of 4\d\d/.test(m.text()) && errs.push(m.text()));
  await p.goto(B + "/entrar"); await p.getByRole("button", { name: new RegExp(quien) }).click(); await p.waitForURL(/\/(caja|inicio)/);
  return { ctx, p, errs };
}

const prod = (await pool.query(`select p.id, p.nombre from productos p where p.empresa_id = $1 and p.activo
  and exists (select 1 from v_stock_vigente v where v.producto_id = p.id and v.unidades > 0) order by p.nombre desc limit 1`, [EMP])).rows[0];
const otro = (await pool.query(`select id, nombre, laboratorio, ean from productos where empresa_id = $1 and activo and id <> $2 and ean is not null order by nombre limit 1`, [EMP, prod.id])).rows[0];
const filaOtro = { codigo_barras: otro.ean, nombre: otro.nombre, laboratorio: otro.laboratorio ?? "", precio_caja: "9000" };

// ── 1. Bodega: pone la ubicación desde el inventario
{
  const { ctx, p, errs } = await entrar("Andrés");
  await p.goto(B + `/inventario?ver=todos&q=${encodeURIComponent(prod.nombre.slice(0, 20))}`);
  const fila = p.getByRole("row").filter({ hasText: prod.nombre }).first();
  await fila.getByRole("button", { name: "Poner ubicación" }).click();
  await fila.getByLabel("Ubicación del producto").fill("a0 - n1");
  await fila.getByRole("button", { name: "Guardar" }).click();
  await fila.getByRole("button", { name: /Ubicación A0 - N1/ }).waitFor();
  ok(await ubic(prod.id) === "A0 - N1", "la bodega guarda la ubicación (en mayúscula)");
  await p.goto(B + "/inventario?ver=todos&orden=ubicacion");
  const primera = await p.locator("tbody tr").first().innerText();
  ok(primera.includes(prod.nombre), "ordenar por ubicación pone primero lo ubicado", primera.slice(0, 60));
  await p.goto(B + "/inventario?ver=todos&q=A0");
  ok(await p.getByRole("row").filter({ hasText: prod.nombre }).count() === 1, "el inventario busca por ubicación");
  ok(errs.length === 0, "bodega sin errores en la consola", errs.slice(0, 3).join(" | "));
  await ctx.close();
}

// ── 2. Cajera: la ve al buscar en la caja, pero no la cambia
{
  const { ctx, p, errs } = await entrar("Laura");
  const r = await (await p.request.get(B + `/api/productos?q=${encodeURIComponent(prod.nombre.slice(0, 20))}`)).json();
  ok(r.productos.find((x) => x.id === prod.id)?.ubicacion === "A0 - N1", "la búsqueda de la caja trae la ubicación");
  await p.goto(B + "/caja");
  await p.locator("#buscar").fill(prod.nombre.slice(0, 20));
  ok(await p.getByText("Ubicación A0 - N1").first().waitFor({ timeout: 10000 }).then(() => true, () => false), "la caja muestra la ubicación en el resultado");
  const put = await p.request.put(B + `/api/productos/${prod.id}/ubicacion`, { data: { ubicacion: "X1" } });
  ok(put.status() === 403, "la cajera no cambia la ubicación", String(put.status()));
  ok(errs.length === 0, "cajera sin errores en la consola", errs.slice(0, 3).join(" | "));
  await ctx.close();
}

// ── 3. Dueño: la cambia en el producto, sale en el Excel y se importa
{
  const { ctx, p, errs } = await entrar("Carlos");
  await p.goto(B + `/productos/${prod.id}`);
  ok(await p.getByLabel(/^Ubicación/).inputValue() === "A0 - N1", "el formulario del producto muestra la ubicación");
  await p.getByLabel(/^Ubicación/).fill("Nevera 1");
  await p.getByRole("button", { name: "Guardar cambios" }).click(); await p.waitForURL(/\/productos$/);
  ok(await ubic(prod.id) === "NEVERA 1", "el dueño la cambia desde el producto");
  const x = await p.request.get(B + "/api/inventario/exportar");
  const t = textoXlsx(await x.body());
  ok(esXlsx(x.headers()["content-type"], x.headers()["content-disposition"]) && t.split("\n")[0].endsWith("Ubicación") && t.includes("NEVERA 1"), "el Excel del inventario trae la ubicación");
  const imp = await p.request.post(B + "/api/productos/importar", { data: { simular: false, idem_key: `ubic-${Date.now()}`, filas: [{ ...filaOtro, ubicacion: "b2-n3" }] } });
  const ij = await imp.json();
  ok(imp.status() === 200 && await ubic(otro.id) === "B2-N3", "la importación desde Excel carga la ubicación", `${imp.status()} ${JSON.stringify(ij).slice(0, 120)}`);
  const sinCol = await p.request.post(B + "/api/productos/importar", { data: { simular: false, idem_key: `ubic2-${Date.now()}`, filas: [filaOtro] } });
  ok(sinCol.status() === 200 && await ubic(otro.id) === "B2-N3", "un archivo sin la columna no borra la ubicación");
  const bit = await p.request.get(B + "/api/bitacora?tipo=configuracion");
  ok(JSON.stringify(await bit.json()).includes("Ubicación de un producto"), "el cambio de ubicación sale en la bitácora");
  ok(errs.length === 0, "dueño sin errores en la consola", errs.slice(0, 3).join(" | "));

  // Celular
  const m = await b.newContext({ ...devices["iPhone 13"], storageState: await ctx.storageState() });
  const pm = await m.newPage();
  await pm.goto(B + "/inventario?ver=todos&orden=ubicacion");
  ok(await pm.evaluate(() => document.documentElement.scrollWidth - innerWidth) <= 1, "celular sin desborde en el inventario por ubicación");
  await m.close();
  await ctx.close();
}

await b.close(); await pool.end();
console.log(fallos ? `\n${fallos} fallo(s)` : "\nTodo en verde");
process.exit(fallos ? 1 : 0);
