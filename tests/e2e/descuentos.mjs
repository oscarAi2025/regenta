// Descuentos: por línea y general, tope de la cajera (10 % por defecto), el dueño sin tope, y la tirilla con el ahorro.
// Uso: servidor en :4500 (REGENTA_DEMO=1) con la base recién sembrada → node tests/e2e/descuentos.mjs
import { chromium } from "playwright-core";

const B = process.env.BASE ?? "http://localhost:4500";
let fallos = 0;
const ok = (c, m, x = "") => { console.log(`${c ? "PASS" : "FAIL"} ${m}${x ? " — " + x : ""}`); if (!c) fallos++; };
const num = (t) => Number(String(t).replace(/[^\d]/g, ""));
const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium" });

// Las pruebas funcionales entran a la demo sin las ofertas del embudo (las prueba embudo.mjs).
{ const nc = b.newContext.bind(b); b.newContext = async (o) => { const c = await nc(o); await c.addInitScript(() => { try { sessionStorage.setItem("regenta_demo_v1", JSON.stringify({ hechos: [], ofertas: ["prueba", "prueba"], cerrada: true, inicio: Date.now() })); } catch {} }); return c; }; }

async function entrar(quien) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(B + "/entrar"); await p.getByRole("button", { name: new RegExp(quien) }).click(); await p.waitForURL(/\/(caja|inicio)/);
  if (!p.url().endsWith("/caja")) await p.goto(B + "/caja"); await p.waitForLoadState("networkidle");
  await p.waitForLoadState("networkidle");
  return { ctx, p, errs };
}
const venta = (p, desc, general) => p.evaluate(async ([d, g]) => {
  const prod = (await (await fetch("/api/productos?q=acetaminofen forte")).json()).productos[0];
  const r = await fetch("/api/ventas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
    idem_key: crypto.randomUUID(), tipo_doc: "pos", lineas: [{ producto_id: prod.id, presentacion: "caja", cantidad: 1, descuento_pct: d }], descuento_pct: g,
    pagos: [{ medio: "efectivo", valor: 100000 }] }) });
  return { status: r.status, j: await r.json(), precio: prod.precio_caja };
}, [desc, general]);

// ── Cajera: descuento de línea + general desde la caja
{
  const { ctx, p, errs } = await entrar("Laura");
  await p.keyboard.type("acetaminofen forte mk"); await p.waitForSelector('[aria-label="Resultados"] [role="option"]'); await p.keyboard.press("Enter");
  const aside = p.locator('aside[aria-label="Venta actual"]');
  const bruto = num(await aside.getByText(/^\$[\d.]+$/).last().textContent());
  await aside.getByLabel(/Descuento de .* en porcentaje/).fill("5");
  await p.fill("#desc-general", "5");
  const esperado = Math.round(bruto * (100 - (100 - 95 * 95 / 100)) / 100);
  const mostrado = num(await aside.getByText(/^\$[\d.]+$/).last().textContent());
  ok(mostrado === esperado, "la caja muestra el total con 5 % de línea + 5 % general", `${mostrado} = ${esperado}`);
  await p.keyboard.press("F9"); await p.waitForSelector("#recibido"); await p.fill("#recibido", "100000");
  await p.getByRole("button", { name: /Confirmar/ }).click();
  await p.getByText(/Nueva venta/).waitFor();
  const total = num(await p.locator("text=Total").locator("..").last().textContent());
  ok(total === esperado, "la base de datos cobra lo mismo que muestra la caja", `${total}`);
  const src = await p.locator('iframe[title="Tiquete"]').first().getAttribute("src").catch(() => null);
  const id = src?.split("/tiquete/")[1]?.split("?")[0];
  const t = await ctx.newPage(); await t.goto(B + `/tiquete/${id}`);
  const txt = await t.locator("main").innerText();
  ok(/Descuento 9\.75%/.test(txt) && /Ahorro total/.test(txt), "la tirilla muestra el descuento y el ahorro");
  const tope = await venta(p, 15, 0);
  ok(tope.status === 403 && /máximo permitido/.test(tope.j.error), "la cajera no pasa del 10 %", `${tope.status} ${tope.j.error}`);
  ok(errs.length === 0, "sin errores de JavaScript (cajera)", errs.join(" | "));
  await ctx.close();
}

// ── Dueño: sin tope
{
  const { ctx, p } = await entrar("Carlos");
  const r = await venta(p, 20, 0);
  ok(r.status === 200 && Number(r.j.venta.total) === Math.round(r.precio * 0.8), "el dueño puede dar 20 %", `${r.status} ${r.j.venta?.total}`);
  const malo = await venta(p, 100, 0);
  ok(malo.status === 400, "un descuento del 100 % no se acepta", `${malo.status}`);
  await ctx.close();
}

await b.close();
console.log(`\n${fallos} fallos`);
process.exit(fallos ? 1 : 0);
