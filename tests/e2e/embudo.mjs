// Embudo de venta: portada con oferta y garantía, demo con barra, recorrido, aviso tras vender, oferta al completar,
// y salida de la demo hacia la página de oferta (no a «Entrar"). Escritorio y celular.
// Uso: servidor en :4500 (REGENTA_DEMO=1) → node tests/e2e/embudo.mjs
import { chromium } from "playwright-core";

const B = process.env.BASE ?? "http://localhost:4500";
const OUT = process.env.CAPTURAS ?? "/tmp/claude-0/capturas";
let fallos = 0;
const ok = (c, m, x = "") => { console.log(`${c ? "PASS" : "FAIL"} ${m}${x ? " — " + x : ""}`); if (!c) fallos++; };
const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium" });

for (const [nombre, vp] of [["escritorio", { width: 1440, height: 900 }], ["celular", { width: 390, height: 844 }]]) {
  const ctx = await b.newContext({ viewport: vp });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));

  // Portada
  await p.goto(B + "/");
  const txt = await p.locator("main").innerText();
  ok(/30 días de garantía/.test(txt), `${nombre}: la portada muestra la garantía`);
  ok(/Lo que recibes al contratar/.test(txt) && /aparte cuesta/.test(txt), `${nombre}: la portada muestra la oferta con su valor`);
  ok(/art\. 657/.test(txt), `${nombre}: la portada explica el riesgo de no facturar`);
  ok(!/Alegra|Loggro|Vendty|Siigo/i.test(await p.content()), `${nombre}: no nombra otros programas`);
  await p.screenshot({ path: `${OUT}/portada-${nombre}.png`, fullPage: true });

  // Entrar a la demo
  await p.getByRole("button", { name: "Probar gratis ahora" }).first().click();
  await p.waitForURL(/\/inicio/);
  const barra = p.getByRole("region", { name: "Estás en la demo" });
  ok(await barra.isVisible(), `${nombre}: la demo muestra la barra de la oferta`);
  ok(await barra.getByRole("link", { name: "Contratar ahora" }).isVisible(), `${nombre}: la barra tiene «Contratar ahora»`);
  const guia = p.getByRole("complementary", { name: "Recorrido de la demo" });
  ok(await guia.isVisible(), `${nombre}: el recorrido de 3 pasos está visible`);
  if (nombre === "celular") ok(await guia.getByRole("button", { name: /Guía de la demo/ }).isVisible(), "celular: el recorrido empieza minimizado para no tapar la pantalla");
  await p.screenshot({ path: `${OUT}/demo-inicio-${nombre}.png` });

  // Paso 1: vender
  await p.goto(B + "/caja"); await p.waitForLoadState("networkidle");
  if (nombre === "escritorio") {
    await p.keyboard.type("acetaminofen forte mk"); await p.waitForSelector('[role="option"]'); await p.keyboard.press("Enter");
    await p.keyboard.press("F9"); await p.waitForSelector("#recibido"); await p.fill("#recibido", "100000");
    await p.getByRole("button", { name: /Confirmar/ }).click();
    const aviso = p.getByRole("status").filter({ hasText: "tiquete POS electrónico" });
    await aviso.waitFor({ timeout: 8000 }).catch(() => {});
    ok(await aviso.isVisible(), "escritorio: tras vender sale el aviso con «Quiero esto en mi droguería»");
    await p.screenshot({ path: `${OUT}/demo-venta-${nombre}.png` });
  } else {
    // En el celular se marca la venta con el mismo evento que dispara la caja.
    await p.evaluate(() => window.dispatchEvent(new CustomEvent("regenta:venta", { detail: { total: 12000 } })));
  }
  // Pasos 2 y 3
  await p.goto(B + "/prediccion"); await p.waitForLoadState("networkidle");
  await p.goto(B + "/alertas"); await p.waitForLoadState("networkidle");
  const dlg = p.getByRole("dialog");
  await dlg.waitFor({ timeout: 8000 }).catch(() => {});
  ok(await dlg.isVisible(), `${nombre}: al completar el recorrido sale la oferta`);
  ok(await dlg.getByRole("link", { name: "Contratar ahora" }).isVisible(), `${nombre}: la oferta lleva a contratar`);
  await p.screenshot({ path: `${OUT}/demo-oferta-${nombre}.png` });
  await dlg.getByRole("button", { name: "Seguir probando la demo" }).click();
  ok(!(await dlg.isVisible()), `${nombre}: la oferta se cierra y deja seguir probando`);

  // Salir → página de oferta
  await p.getByRole("button", { name: "Salir" }).click();
  await p.waitForURL(/\/demo\/gracias/, { timeout: 10000 }).catch(() => {});
  ok(p.url().endsWith("/demo/gracias"), `${nombre}: al salir de la demo llega a la oferta, no a Entrar`, p.url());
  const g = await p.locator("main").innerText();
  ok(/Contratar ahora/.test(g) && /Volver a la demo/.test(g), `${nombre}: la salida ofrece contratar o volver a la demo`);
  await p.screenshot({ path: `${OUT}/salida-${nombre}.png`, fullPage: true });

  // Contratar
  await p.goto(B + "/contratar?plan=pro&origen=demo");
  ok(/Riesgo cero/.test(await p.locator("main").innerText()), `${nombre}: Contratar muestra la garantía`);
  await p.screenshot({ path: `${OUT}/contratar-${nombre}.png`, fullPage: true });

  // Sin desbordes horizontales
  for (const r of ["/", "/demo/gracias", "/contratar", "/precios"]) {
    await p.goto(B + r);
    const ancho = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    ok(ancho <= 1, `${nombre}: ${r} sin scroll horizontal`, `${ancho}px`);
  }
  ok(errs.length === 0, `${nombre}: sin errores de JavaScript`, errs.join(" | "));
  await ctx.close();
}
await b.close();
console.log(`\n${fallos} fallos`);
process.exit(fallos ? 1 : 0);
