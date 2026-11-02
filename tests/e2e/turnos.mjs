// Turnos de caja: abrir con base, salida de efectivo, venta, esperado = base + efectivo − salidas, cierre con faltante,
// reporte imprimible y «exigir turno» (sin turno la caja no cobra).
// Uso: servidor en :4500 (REGENTA_DEMO=1) con la base recién sembrada → node tests/e2e/turnos.mjs
import { chromium } from "playwright-core";

const B = process.env.BASE ?? "http://localhost:4500";
let fallos = 0;
const ok = (c, m, x = "") => { console.log(`${c ? "PASS" : "FAIL"} ${m}${x ? " — " + x : ""}`); if (!c) fallos++; };
const num = (t) => Number(String(t).replace(/[^\d-]/g, ""));
const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium" });

async function entrar(quien) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
  await p.goto(B + "/entrar"); await p.getByRole("button", { name: new RegExp(quien) }).click(); await p.waitForURL(/\/(caja|inicio)/);
  return { ctx, p, errs };
}
const api = (p, cuerpo) => p.evaluate(async (c) => { const r = await fetch("/api/turnos", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(c) }); return { status: r.status, j: await r.json() }; }, cuerpo);
const estado = (p) => p.evaluate(async () => (await fetch("/api/turnos")).json());

// ── Cajera: abrir, salida, vender, cerrar con faltante
{
  const { ctx, p, errs } = await entrar("Laura");
  const previo = await estado(p); // una corrida anterior interrumpida pudo dejar un turno abierto
  if (previo.turno) await api(p, { accion: "cerrar", turno: previo.turno.id, contado: 0 });
  await p.goto(B + "/turno");
  await p.locator("#base").waitFor();
  const h = await p.getByRole("heading", { name: /Abrir turno/ }).count();
  if (!h) console.log(await p.locator("h1,h2").allInnerTexts());
  ok(h === 1, "sin turno muestra «Abrir turno»", `${h}`);
  await p.fill("#base", "100000");
  await p.getByRole("button", { name: "Abrir turno" }).click();
  await p.getByText(/Turno abierto/).waitFor();
  ok(true, "abre el turno con base");
  ok((await api(p, { accion: "abrir", base: 0 })).status === 422, "no deja abrir un segundo turno en la misma caja");
  errs.length = 0; // el 422 anterior es buscado: no cuenta como error de la página
  await p.fill("#mv-valor", "15000"); await p.fill("#mv-concepto", "Pago domicilio");
  await p.getByRole("button", { name: "Registrar" }).click();
  await p.getByText("Pago domicilio").waitFor();
  ok(true, "registra una salida de efectivo");

  // Venta en efectivo con cambio
  await p.goto(B + "/caja");
  await p.keyboard.type("acetaminofen forte mk"); await p.waitForSelector('[role="option"]'); await p.keyboard.press("Enter");
  const totalTexto = await p.locator('aside[aria-label="Venta actual"]').getByText(/^\$[\d.]+$/).last().textContent();
  const total = num(totalTexto);
  await p.keyboard.press("F9"); await p.waitForSelector("#recibido"); await p.fill("#recibido", "100000");
  await p.getByRole("button", { name: /Confirmar/ }).click();
  await p.getByText(/Nueva venta/).waitFor();
  // Pago mixto: 10.000 con tarjeta y el resto en efectivo (con cambio)
  await p.getByRole("button", { name: /Nueva venta/ }).click();
  await p.keyboard.type("acetaminofen forte mk"); await p.waitForSelector('[role="option"]'); await p.keyboard.press("Enter");
  const total2 = num(await p.locator('aside[aria-label="Venta actual"]').getByText(/^\$[\d.]+$/).last().textContent());
  await p.keyboard.press("F9"); await p.waitForSelector("#recibido");
  await p.getByRole("button", { name: /Pago mixto/ }).click();
  await p.selectOption("#otro-medio", "tarjeta"); await p.fill("#otro-valor", "10000");
  await p.fill("#recibido", "50000");
  await p.getByRole("button", { name: /Confirmar/ }).click();
  await p.getByText(/Nueva venta/).waitFor();
  const cambioTexto = await p.getByText("Cambio").locator("..").textContent();
  ok(num(cambioTexto) === 50000 - (total2 - 10000), "pago mixto: el cambio sale solo sobre el efectivo", cambioTexto);

  const e1 = await estado(p);
  const r = e1.turno.resumen;
  ok(Number(r.medios.tarjeta) === 10000, "el turno separa lo pagado con tarjeta", `${r.medios.tarjeta}`);
  ok(Number(r.efectivo_ventas) === total + total2 - 10000, "el efectivo del turno es lo cobrado sin el cambio", `${r.efectivo_ventas} = ${total + total2 - 10000}`);
  ok(Number(r.efectivo_esperado) === 100000 + total + total2 - 10000 - 15000, "esperado = base + ventas en efectivo − salidas", `${r.efectivo_esperado}`);

  // Cierre con faltante de 1.000
  await p.goto(B + "/turno");
  await p.fill("#contado", String(Number(r.efectivo_esperado) - 1000));
  await p.getByRole("button", { name: /Cerrar turno/ }).click();
  await p.getByText(/Faltan \$1\.000/).waitFor();
  ok(true, "el cierre muestra el faltante");
  const id = e1.turno.id;
  const t = await ctx.newPage();
  await t.goto(B + `/tiquete/turno/${id}`);
  const txt = await t.locator("main").innerText();
  ok(/CIERRE DE TURNO/.test(txt) && /FALTANTE/.test(txt) && /Pago domicilio/.test(txt), "el reporte imprimible trae cierre, faltante y salidas");
  ok((await estado(p)).turno === null, "después del cierre no queda turno abierto");
  ok(errs.length === 0, "sin errores en consola (cajera)", errs.join(" | "));
  await ctx.close();
}

// ── Dueño activa «exigir turno»: la cajera sin turno no puede cobrar
{
  const { ctx, p } = await entrar("Carlos");
  ok((await api(p, { accion: "exigir", valor: true })).status === 200, "el dueño activa exigir turno");
  const caj = await entrar("Laura");
  ok((await api(caj.p, { accion: "exigir", valor: false })).status === 403, "la cajera no puede cambiar esa opción");
  await caj.p.goto(B + "/caja");
  await caj.p.keyboard.type("acetaminofen forte mk"); await caj.p.waitForSelector('[role="option"]'); await caj.p.keyboard.press("Enter");
  await caj.p.keyboard.press("F9"); await caj.p.waitForSelector("#recibido"); await caj.p.fill("#recibido", "100000");
  await caj.p.getByRole("button", { name: /Confirmar/ }).click();
  ok(await caj.p.getByText(/Abre el turno de caja antes de vender/).count() > 0 || (await caj.p.getByText(/Abre el turno de caja antes de vender/).waitFor({ timeout: 5000 }).then(() => true).catch(() => false)), "sin turno abierto la caja no cobra");
  await api(p, { accion: "exigir", valor: false });
  await caj.ctx.close(); await ctx.close();
}

await b.close();
console.log(`\n${fallos} fallos`);
process.exit(fallos ? 1 : 0);
