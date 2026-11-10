// Producto con lote y fecha de vencimiento: al crearlo (y al editarlo) se puede entrar un lote con su vencimiento,
// cantidad y costo, en la misma operación; sin fecha no deja; un lote vencido no entra; la caja ya no lo ve agotado.
// Avisos del formulario: «caja x 500» en el nombre vs. unidades por caja y precio por unidad que no cuadra.
// Uso: servidor con REGENTA_DEMO=1 y la base recién sembrada → node tests/e2e/producto-lote.mjs
import { chromium } from "playwright-core";
import pg from "pg";

const B = process.env.BASE ?? "http://localhost:4500";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/regenta?host=/tmp" });
let fallos = 0;
const ok = (c, m, x = "") => { console.log(`${c ? "PASS" : "FAIL"} ${m}${x ? " — " + x : ""}`); if (!c) fallos++; };
const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium" });
{ const nc = b.newContext.bind(b); b.newContext = async (o) => { const c = await nc(o); await c.addInitScript(() => { try { sessionStorage.setItem("regenta_demo_v1", JSON.stringify({ hechos: [], ofertas: ["prueba", "prueba"], cerrada: true, inicio: Date.now() })); } catch {} }); return c; }; }
async function entrar(quien, o = { viewport: { width: 1440, height: 900 } }) {
  const ctx = await b.newContext(o); const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => m.type() === "error" && !/status of 4\d\d/.test(m.text()) && errs.push(m.text()));
  await p.goto(B + "/entrar"); await p.getByRole("button", { name: new RegExp(quien) }).click(); await p.waitForURL(/\/(caja|inicio)/);
  return { ctx, p, errs };
}
const api = (p, url, metodo = "GET", cuerpo) => p.evaluate(async ([u, m, c]) => {
  const r = await fetch(u, { method: m, headers: c === undefined ? {} : { "content-type": "application/json" }, body: c === undefined ? undefined : JSON.stringify(c) });
  return { status: r.status, j: await r.json().catch(() => ({})) };
}, [url, metodo, cuerpo]);
const q = async (sql, v = []) => (await pool.query(sql, v)).rows;
const enDias = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const sufijo = Date.now().toString(36).slice(-5).toUpperCase();
const NOMBRE = `Bajalenguas de madera prueba ${sufijo} caja x 500 unidades`;
const base = { nombre: "x", iva: 19, unidades_por_caja: 500, precio_caja: 36850, precio_unidad: 100, stock_minimo: 0 };

{
  const { ctx, p, errs } = await entrar("Carlos");
  // ── Pantalla: producto nuevo con lote y fecha de vencimiento
  await p.goto(B + "/productos/nuevo"); await p.waitForLoadState("networkidle");
  await p.getByRole("tab", { name: "Producto nuevo" }).click();
  ok(await p.locator("legend").filter({ hasText: /^Lote y fecha de vencimiento/ }).isVisible(), "el alta muestra «Lote y fecha de vencimiento»");
  await p.fill("#nombre", NOMBRE); await p.fill("#upc", "36");
  ok(await p.getByText("El nombre dice caja x 500").isVisible(), "avisa que el nombre dice caja x 500 y no cuadra con 36 unidades por caja");
  await p.getByRole("button", { name: "Poner 500 unidades por caja" }).click();
  ok(await p.inputValue("#upc") === "500", "un clic pone 500 unidades por caja");
  await p.fill("#precio_caja", "36850"); await p.fill("#precio_unidad", "31284");
  ok(await p.getByText(/mucho más que la caja/).isVisible(), "avisa que el precio por unidad no cuadra con la caja");
  await p.fill("#precio_unidad", "100");
  await p.fill("#ex-lote", "bj26a"); await p.fill("#ex-unidades", "1500");
  await p.getByRole("button", { name: "Agregar a mi droguería" }).click();
  ok(await p.getByRole("alert").filter({ hasText: "Escribe la fecha de vencimiento del lote" }).isVisible(), "sin fecha de vencimiento no deja guardar el lote");
  await p.fill("#ex-vence", enDias(60));
  ok(await p.getByText("Vence en 60 días: ofrécelo primero").isVisible(), "avisa cuántos días faltan y que se ofrezca primero");
  ok(await p.getByText("= 3 cajas").isVisible(), "muestra las unidades en cajas (1.500 = 3 cajas)");
  await Promise.all([p.waitForURL(/\/productos\?q=/), p.getByRole("button", { name: "Agregar a mi droguería" }).click()]);
  const [pr] = await q(`select p.id, p.unidades_por_caja, (select sum(unidades) from v_stock_lotes where producto_id = p.id)::int u,
      (select string_agg(l.lote || ' ' || l.vence, ',') from lotes l where l.producto_id = p.id) lotes from productos p where nombre = $1`, [NOMBRE]);
  ok(pr?.u === 1500 && pr.lotes === `BJ26A ${enDias(60)}` && pr.unidades_por_caja === 500, "el producto quedó con 1.500 unidades en el lote BJ26A y su vencimiento", JSON.stringify(pr));
  const [mov] = await q(`select tipo, cantidad from movimientos where producto_id = $1`, [pr.id]);
  ok(mov?.tipo === "inicial" && mov.cantidad === 1500, "entró como inventario inicial (kardex)", JSON.stringify(mov));
  // La caja ya no lo ve agotado
  const c = await api(p, `/api/productos?q=${encodeURIComponent("bajalenguas prueba " + sufijo)}`);
  ok(c.j.productos?.[0]?.unidades === 1500 && c.j.productos[0].proximo_vence === enDias(60), "la caja lo encuentra con existencias y su vencimiento (no agotado)", JSON.stringify(c.j.productos?.[0]));

  // ── Editar: agregar otro lote a un producto existente
  await p.goto(B + `/productos/${pr.id}`); await p.waitForLoadState("networkidle");
  ok(await p.getByText("Agregar existencias: lote y fecha de vencimiento").isVisible(), "al editar se pueden agregar existencias con lote y vencimiento");
  await p.fill("#ex-lote", "BJ27B"); await p.fill("#ex-vence", enDias(400));
  await p.getByRole("group", { name: "Contar en" }).getByRole("button", { name: "Cajas" }).click(); await p.fill("#ex-unidades", "1");
  ok(await p.getByText("= 500 unidades").isVisible(), "también se cuenta en cajas (1 caja = 500 unidades)");
  await Promise.all([p.waitForURL(/\/productos$/), p.getByRole("button", { name: "Guardar cambios" }).click()]);
  const [u2] = await q(`select sum(unidades)::int u from v_stock_lotes where producto_id = $1`, [pr.id]);
  ok(u2.u === 2000, "con el segundo lote quedan 2.000 unidades", String(u2.u));

  const grande = await api(p, "/api/productos", "POST", { ...base, nombre: `Algodón prueba ${sufijo} caja x 5000`, unidades_por_caja: 5000, precio_unidad: 10, existencia: { lote: "G1", vence: enDias(500), unidades: 250000 } });
  ok(grande.status === 201, "acepta cajas grandes (5.000 unidades por caja) y existencias grandes (250.000 unidades)", `${grande.status} ${grande.j.error ?? ""}`);
  // ── API: lote vencido, fecha imposible, sin lote, sin unidades; nada se crea a medias
  const vencido = await api(p, "/api/productos", "POST", { ...base, nombre: `Vencido ${sufijo}`, existencia: { lote: "V1", vence: enDias(-1), unidades: 10 } });
  ok(vencido.status === 422 || vencido.status === 400 || vencido.status === 409, "un lote vencido no entra", `${vencido.status} ${vencido.j.error}`);
  ok(/vencido/.test(vencido.j.error ?? ""), "dice que el lote está vencido", vencido.j.error);
  ok((await q(`select 1 from productos where nombre = $1`, [`Vencido ${sufijo}`])).length === 0, "si el lote no entra, el producto tampoco se crea (todo o nada)");
  for (const [n, e, m] of [["fecha imposible", { lote: "X", vence: "2027-02-31", unidades: 1 }, /no existe/], ["sin lote", { lote: " ", vence: enDias(30), unidades: 1 }, /lote/],
    ["sin unidades", { lote: "X", vence: enDias(30), unidades: 0 }, /unidades/], ["caracteres invisibles", { lote: "A\nB", vence: enDias(30), unidades: 1 }, /invisibles/]]) {
    const r = await api(p, "/api/productos", "POST", { ...base, nombre: `Malo ${n} ${sufijo}`, existencia: e });
    ok(r.status === 400 && m.test(r.j.error ?? ""), `${n}: 400 con mensaje claro`, `${r.status} ${r.j.error}`);
  }
  ok(errs.length === 0, "sin errores de consola", errs.join(" | "));
  await ctx.close();
}
{ // ── La cajera no crea productos ni entra existencias por esta vía
  const { ctx, p } = await entrar("Laura");
  const r = await api(p, "/api/productos", "POST", { ...base, nombre: `Cajera ${sufijo}`, existencia: { lote: "C1", vence: enDias(30), unidades: 5 } });
  ok(r.status === 403, "la cajera no crea productos con existencias (403)", String(r.status));
  await ctx.close();
}
{ // ── Celular: el formulario no se desborda
  const { ctx, p } = await entrar("Carlos", { viewport: { width: 375, height: 800 }, isMobile: true, hasTouch: true });
  await p.goto(B + "/productos/nuevo"); await p.waitForLoadState("networkidle"); await p.getByRole("tab", { name: "Producto nuevo" }).click();
  const w = await p.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  ok(w[0] <= w[1], "en el celular el formulario no se sale de la pantalla", w.join("/"));
  await ctx.close();
}
await b.close(); await pool.end();
console.log(fallos ? `${fallos} fallos` : "0 fallos"); process.exit(fallos ? 1 : 0);
