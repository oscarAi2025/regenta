// Recorrido real en el navegador: entrar como cajera, buscar, agregar por caja y por unidad, cobrar en efectivo,
// ver el cambio y el tiquete aceptado; permisos de la cajera; inventario del dueño. Capturas en escritorio y móvil.
// Uso: servidor en :4500 (REGENTA_DEMO=1) → node tests/e2e/caja.mjs
import { chromium, devices } from "playwright-core";
import { mkdirSync } from "node:fs";

const B = process.env.BASE ?? "http://localhost:4500";
const OUT = process.env.OUT ?? "test-results";
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium" });
let fallos = 0;
const ok = (c, m, x = "") => { console.log(`${c ? "PASS" : "FAIL"} ${m}${x ? " — " + x : ""}`); if (!c) fallos++; };

async function entrar(ctx, quien) {
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
  await p.goto(B + "/entrar");
  await p.getByRole("button", { name: new RegExp(quien) }).click();
  await p.waitForURL(/\/(caja|inicio)/);
  return { p, errs };
}

// ── Cajera en escritorio
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const { p, errs } = await entrar(ctx, "Laura");
  ok(p.url().endsWith("/caja"), "la cajera entra directo a la caja");
  await p.screenshot({ path: `${OUT}/caja-vacia.png` });
  await p.keyboard.type("acetaminofen forte mk"); // uno con cajas de sobra (la prueba vende una caja)
  await p.waitForSelector('[role="option"]');
  const n = await p.locator('[role="option"]').count();
  ok(n > 0, "la búsqueda devuelve productos", `${n}`);
  await p.screenshot({ path: `${OUT}/caja-busqueda.png` });
  await p.keyboard.press("Enter"); // agrega por caja el primero
  ok(await p.locator('aside[aria-label="Venta actual"] li').count() === 1, "Enter agrega el producto a la tirilla");
  // segundo producto: por unidad si se puede
  await p.keyboard.type("x 100");
  await p.waitForSelector('[role="option"]');
  const unidad = p.getByRole("option").first().getByRole("button", { name: /Unidad/ });
  if (await unidad.count()) { await unidad.click(); ok(true, "agrega por unidad"); } else { await p.keyboard.press("Enter"); }
  const totalTexto = await p.locator('aside[aria-label="Venta actual"]').getByText(/^\$[\d.]+$/).last().textContent();
  const total = Number(totalTexto.replace(/\D/g, ""));
  ok(total > 0, "la tirilla muestra el total", totalTexto);
  await p.screenshot({ path: `${OUT}/caja-tirilla.png` });
  await p.keyboard.press("F9");
  await p.waitForSelector("#recibido");
  const billete = Math.ceil((total + 1) / 50000) * 50000;
  await p.fill("#recibido", String(billete));
  await p.screenshot({ path: `${OUT}/caja-cobro.png` });
  await p.getByRole("button", { name: /Confirmar/ }).click();
  await p.waitForSelector("text=Venta registrada", { timeout: 15000 });
  const cambio = Number((await p.locator("text=Cambio").locator("..").textContent()).replace(/\D/g, ""));
  ok(cambio === billete - total, "el cambio es correcto", `${cambio} = ${billete} − ${total}`);
  ok(await p.getByText("Tiquete POS electrónico aceptado").count() === 1, "el tiquete POS sale aceptado (emisor simulado)");
  await p.screenshot({ path: `${OUT}/caja-hecha.png` });
  await p.keyboard.press("Enter");
  ok(await p.getByText("Escanea o busca un producto para empezar").count() === 1, "Enter abre una venta nueva");
  // Permisos de la cajera
  const r = await p.request.get(B + "/inventario");
  ok(r.ok(), "la cajera puede consultar el inventario");
  await p.goto(B + "/inventario?ver=todos");
  ok(await p.getByText("Inventario a costo").count() === 0, "la cajera no ve el valor a costo");
  ok(!(await p.content()).includes("/und</li>") , "la cajera no ve costos por lote");
  ok(errs.length === 0, "sin errores de JavaScript", errs.join(" | "));
  await ctx.close();
}

// ── Dueño: inventario con costos
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const { p, errs } = await entrar(ctx, "Carlos");
  await p.goto(B + "/inventario");
  ok(await p.getByText("Inventario a costo").count() === 1, "el dueño ve el inventario a costo");
  ok(await p.locator("tbody tr").count() > 0, "lista de lotes que vencen en 90 días");
  await p.screenshot({ path: `${OUT}/inventario-dueno.png`, fullPage: false });
  ok(errs.length === 0, "sin errores de JavaScript (dueño)", errs.join(" | "));
  await ctx.close();
}

// ── Bodega: no puede entrar a la caja
{
  const ctx = await b.newContext();
  const { p } = await entrar(ctx, "Andrés");
  await p.goto(B + "/caja");
  ok(new URL(p.url()).pathname === "/inventario", "bodega no entra a la caja");
  const r = await p.request.post(B + "/api/ventas", { data: { idem_key: crypto.randomUUID(), tipo_doc: "pos", lineas: [{ producto_id: crypto.randomUUID(), presentacion: "caja", cantidad: 1 }], pagos: [{ medio: "efectivo", valor: 1000 }] } });
  ok(r.status() === 403 || r.status() === 422, "la API de ventas rechaza a bodega", `${r.status()}`);
  await ctx.close();
}

// ── Sin sesión
{
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  const r = await p.request.get(B + "/api/productos?q=a");
  ok(r.status() === 401, "la búsqueda exige sesión");
  await p.goto(B + "/caja");
  ok(p.url().endsWith("/entrar"), "sin sesión, la caja manda a entrar");
  await ctx.close();
}

// ── Móvil
{
  const ctx = await b.newContext({ ...devices["iPhone 13"] });
  const { p, errs } = await entrar(ctx, "Laura");
  await p.locator("#buscar").fill("ibuprofeno");
  await p.waitForSelector('[role="option"]');
  await p.screenshot({ path: `${OUT}/movil-busqueda.png` });
  const ancho = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  ok(ancho <= 0, "sin desborde horizontal en móvil", `${ancho}px`);
  await p.getByRole("option").first().getByRole("button").first().click();
  const barra = p.locator("div.fixed").filter({ hasText: "ver venta" });
  ok(await barra.isVisible(), "móvil: barra fija con el total al agregar");
  await p.screenshot({ path: `${OUT}/movil-barra.png` });
  await barra.getByRole("button", { name: "Cobrar" }).click();
  await p.getByRole("button", { name: "Nequi" }).click();
  await p.getByRole("button", { name: /Confirmar/ }).click();
  await p.waitForSelector("text=Venta registrada", { timeout: 15000 });
  ok(true, "móvil: venta cobrada con Nequi");
  await p.screenshot({ path: `${OUT}/movil-hecha.png` });
  await p.goto(B + "/entrar").catch(() => {});
  ok(errs.length === 0, "sin errores de JavaScript (móvil)", errs.join(" | "));
  await ctx.close();
}
{
  const ctx = await b.newContext({ ...devices["iPhone 13"] });
  const p = await ctx.newPage();
  await p.goto(B + "/entrar");
  await p.screenshot({ path: `${OUT}/movil-entrar.png`, fullPage: true });
  const ctx2 = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p2 = await ctx2.newPage();
  await p2.goto(B + "/entrar");
  await p2.screenshot({ path: `${OUT}/entrar.png` });
  await ctx.close(); await ctx2.close();
}

await b.close();
console.log(`\n${fallos} fallos`);
process.exit(fallos ? 1 : 0);
