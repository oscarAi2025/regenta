// Facturación y cartera en el navegador: factura electrónica con cliente existente a crédito, cliente nuevo con DV
// calculado, cartera con abono, y permisos de la cajera (no fía, no ve cartera). Capturas para la web si CAPTURAS=dir.
// Uso: servidor en :4500 (REGENTA_DEMO=1) → node tests/e2e/facturacion.mjs
import { chromium } from "playwright-core";
import { mkdirSync } from "node:fs";

const B = process.env.BASE ?? "http://localhost:4500";
const OUT = process.env.OUT ?? "test-results";
const CAP = process.env.CAPTURAS;
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium" });
let fallos = 0;
const ok = (c, m, x = "") => { console.log(`${c ? "PASS" : "FAIL"} ${m}${x ? " — " + x : ""}`); if (!c) fallos++; };
const pesos = (t) => Number(String(t).replace(/\D/g, ""));

async function entrar(ctx, quien) {
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  // Los 4xx provocados a propósito (abono mayor que el saldo, API sin permiso) no son errores de la página.
  p.on("console", (m) => m.type() === "error" && !/status of 4(03|22)/.test(m.text()) && errs.push(m.text()));
  await p.goto(B + "/entrar");
  await p.getByRole("button", { name: new RegExp(quien) }).click();
  await p.waitForURL(/\/(caja|inicio)/);
  return { p, errs };
}
async function agregar(p, texto) {
  await p.locator("#buscar").fill(texto);
  await p.waitForSelector('[role="option"]');
  // Un producto con existencias de sobra (las pruebas repetidas van agotando los primeros de la lista).
  await p.locator('[role="option"]', { hasText: /\b([2-9]|\d{2,}) cajas/ }).first().getByRole("button").first().click();
}

// ── Dueño: factura a crédito, cliente nuevo, cartera
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const { p, errs } = await entrar(ctx, "Carlos");
  await p.goto(B + "/caja");
  await p.getByRole("button", { name: "Factura electrónica", exact: true }).click();
  await agregar(p, "acetaminofen");
  ok(await p.getByRole("button", { name: /^Cobrar/ }).isDisabled(), "sin cliente no se puede cobrar una factura");
  ok(await p.getByText("Elige o crea el cliente para facturar").count() === 1, "la caja pide el cliente");
  await p.locator("#cf-buscar").fill("salud vital");
  await p.getByRole("button", { name: /IPS Salud Vital/ }).click();
  ok(await p.getByText("NIT 901234567-7").count() === 1, "el cliente muestra NIT con DV");
  await agregar(p, "ibuprofeno");
  await p.keyboard.press("F9");
  await p.getByRole("button", { name: "Crédito", exact: true }).click();
  await p.getByRole("button", { name: "45 días" }).click();
  ok(await p.locator("#recibido").count() === 0, "a crédito no pide efectivo");
  if (CAP) await p.screenshot({ path: `${CAP}/facturacion.png` });
  await p.getByRole("button", { name: /Facturar a crédito/ }).click();
  await p.waitForSelector("text=Factura electrónica registrada", { timeout: 15000 });
  ok(await p.getByText(/A crédito · vence el/).count() === 1, "la factura queda a crédito con vencimiento");
  ok(await p.getByText("Factura electrónica aceptada").count() === 1, "la factura sale aceptada (emisor simulado)");
  const numero = (await p.locator("aside p.font-cond").first().textContent()).trim();
  ok(/^SETT\d+$/.test(numero), "numeración de factura", numero);

  // Cliente nuevo con NIT: el DV lo calcula Regenta (NIT 901.845.370 → 5)
  await p.getByRole("button", { name: /Nueva venta/ }).click();
  await agregar(p, "acetaminofen");
  await p.getByRole("button", { name: "+ Crear cliente nuevo" }).click();
  await p.fill("#cf-num", "901845370");
  await p.fill("#cf-nom", "Droguería Prueba E2E S.A.S.");
  await p.fill("#cf-mail", "compras@prueba.example");
  await p.getByRole("button", { name: /Guardar y facturar/ }).click();
  await p.waitForSelector("text=NIT 901845370-5");
  ok(true, "cliente nuevo con DV calculado (901845370-5)");
  await p.keyboard.press("F9");
  await p.getByRole("button", { name: "Exacto" }).click();
  await p.getByRole("button", { name: /^Facturar \$/ }).click();
  await p.waitForSelector("text=Factura electrónica registrada", { timeout: 15000 });
  ok(await p.getByText(/A crédito/).count() === 0, "factura de contado sin crédito");

  // Cartera
  await p.goto(B + "/cartera");
  const fila = p.locator("tr", { hasText: numero });
  ok(await fila.count() === 1, "la factura a crédito aparece en Cartera", numero);
  const saldo = pesos(await fila.locator("td").nth(5).textContent());
  await fila.getByRole("button", { name: /Registrar abono/ }).click();
  await fila.getByLabel("Valor del abono").fill(String(Math.floor(saldo / 2)));
  await fila.getByRole("button", { name: "Guardar abono" }).click();
  await p.waitForFunction(([n, s]) => {
    const tr = [...document.querySelectorAll("tr")].find((t) => t.textContent.includes(n));
    return tr && Number(tr.querySelectorAll("td")[5].textContent.replace(/\D/g, "")) < s;
  }, [numero, saldo]);
  const nuevo = pesos(await fila.locator("td").nth(5).textContent());
  ok(nuevo === saldo - Math.floor(saldo / 2), "el abono baja el saldo", `${saldo} → ${nuevo}`);
  await fila.getByRole("button", { name: /Registrar abono/ }).click();
  await fila.getByLabel("Valor del abono").fill(String(saldo * 3));
  await fila.getByRole("button", { name: "Guardar abono" }).click();
  await fila.getByRole("alert").waitFor();
  ok(/supera el saldo/.test(await fila.getByRole("alert").textContent()), "no acepta un abono mayor que el saldo");
  await fila.getByRole("button", { name: "Cancelar" }).click();
  ok(await p.getByText("Vencido").count() >= 1, "Cartera muestra lo vencido");
  if (CAP) await p.screenshot({ path: `${CAP}/cartera.png` });
  await p.goto(B + `/ventas`);
  ok(errs.length === 0, "sin errores en consola (dueño)", errs.join(" | "));
  await ctx.close();
}

// ── Apoyo en ventas: alternativas con existencias para un producto agotado
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const { p, errs } = await entrar(ctx, "Laura");
  await p.locator("#buscar").fill("metronidazol 500");
  const fila = p.locator('[role="option"]', { hasText: "Agotado" }).first();
  await fila.waitFor();
  await fila.getByRole("button", { name: "Ver alternativas con existencias" }).click();
  await fila.getByText(/Parecidos que sí tienes|No hay productos parecidos/).waitFor();
  const n = await fila.locator("li").count();
  ok(await fila.getByText(/Parecidos que sí tienes|No hay productos parecidos/).count() === 1, "el agotado ofrece buscar alternativas", `${n} encontradas`);
  if (n) {
    const nombres = await fila.locator("li").allTextContents();
    ok(nombres.every((t) => /metronidazol/i.test(t) && /500\s*mg/i.test(t)), "mismo principio activo y concentración", nombres[0]);
    await fila.locator("li button").first().click();
    ok(await p.locator('aside[aria-label="Venta actual"] li').count() === 1, "la alternativa se agrega a la venta");
  }
  // Caso con respuesta conocida: un producto nuevo sin existencias «Acetaminofen … 500 mg» debe proponer acetaminofén 500 mg con existencias.
  const d = await b.newContext(); const q = await d.newPage();
  await q.request.post(B + "/demo", { form: { rol: "dueno" } });
  const nuevo = await (await q.request.post(B + "/api/productos", { headers: { origin: B }, data: { nombre: "Acetaminofen prueba alternativas tabletas 500 mg caja x 10", iva: 0, unidades_por_caja: 1, precio_caja: 1000, stock_minimo: 0 } })).json();
  const alt = (await (await q.request.get(`${B}/api/productos/alternativas?id=${nuevo.id}`)).json()).productos ?? [];
  ok(alt.length >= 1 && alt.every((x) => /acetaminof[eé]n/i.test(x.nombre) && /(^|[^0-9.,])500\s*mg/i.test(x.nombre) && x.unidades > 0), "alternativas correctas: acetaminofén 500 mg con existencias", `${alt.length}: ${alt[0]?.nombre ?? ""}`);
  await d.close();
  ok(errs.length === 0, "sin errores en consola (alternativas)", errs.join(" | "));
  await ctx.close();
}

// ── Cajera: factura sí, crédito y cartera no
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const { p, errs } = await entrar(ctx, "Laura");
  await p.getByRole("button", { name: "Factura electrónica", exact: true }).click();
  await p.locator("#cf-buscar").fill("hogar");
  await p.getByRole("button", { name: /Hogar Geriátrico/ }).click();
  await agregar(p, "acetaminofen");
  await p.keyboard.press("F9");
  ok(await p.getByRole("button", { name: "Crédito", exact: true }).count() === 0, "la cajera no ve la opción de crédito");
  await p.goto(B + "/cartera");
  await p.waitForURL(/\/inicio/);
  ok(true, "la cajera no entra a Cartera");
  const r = await p.evaluate(async () => (await fetch("/api/cartera", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ venta_id: crypto.randomUUID(), medio: "efectivo", valor: 1000 }) })).status);
  ok(r === 403, "la API de abonos rechaza a la cajera", String(r));
  ok(errs.length === 0, "sin errores en consola (cajera)", errs.join(" | "));
  await ctx.close();
}

// ── Celular: la caja en modo factura no se desborda
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const { p } = await entrar(ctx, "Carlos");
  await p.goto(B + "/caja");
  await p.getByRole("button", { name: "Factura electrónica", exact: true }).click();
  const ancho = await p.evaluate(() => document.documentElement.scrollWidth);
  ok(ancho <= 390, "sin desborde horizontal en celular", String(ancho));
  await p.goto(B + "/cartera");
  await p.getByRole("heading", { name: "Cartera" }).waitFor({ timeout: 10000 }).catch(() => {});
  ok(await p.getByRole("heading", { name: "Cartera" }).count() === 1, "Cartera abre en celular");
  await ctx.close();
}

await b.close();
console.log(fallos ? `\n${fallos} fallo(s)` : "\n0 fallos");
process.exit(fallos ? 1 : 0);
