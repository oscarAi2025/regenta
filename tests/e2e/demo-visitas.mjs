// Consola → Visitas a la demo (08/11/2026): la visita guarda de dónde vino (utm y primera página), con qué dispositivo y
// rol entró, y lo que hizo (pantallas, oferta vista, clic en Contratar y datos de contacto dejados en la oferta);
// la consola la lista con sus cifras y muestra su línea de tiempo; en una droguería real no se registra nada.
// Uso: servidor con REGENTA_DEMO=1 → BASE=… DATABASE_URL=… node tests/e2e/demo-visitas.mjs
import { execFileSync } from "node:child_process";
import pg from "pg";
import { chromium } from "playwright-core";
import { codigoTotp, olvidarUltimo, TOTP } from "../ayudas/totp.mjs";

const B = process.env.BASE ?? "http://localhost:4500", DB = process.env.DATABASE_URL;
let fallos = 0;
const ok = (c, m, x = "") => { console.log(`${c ? "PASS" : "FAIL"} ${m}${x ? " — " + x : ""}`); if (!c) fallos++; };
const pool = new pg.Pool({ connectionString: DB });
const sufijo = String(Date.now()).slice(-6);
const ADMIN = { email: `admin-visitas${sufijo}@regenta.test`, clave: "ConsolaVisitas2026" };
execFileSync("node", ["scripts/crear-superadmin.mjs", ADMIN.email, "Admin Visitas"], { env: { ...process.env, REGENTA_CLAVE_PRUEBA: ADMIN.clave, REGENTA_TOTP_PRUEBA: TOTP, DATABASE_URL: DB } });

/** Entrar a la consola por la pantalla: contraseña y, cuando la pide, el código de la app de autenticación. */
async function entrarConsolaUI(pg_, a, pool_) {
  await pg_.goto(B + "/admin/entrar"); await pg_.fill("#a-email", a.email); await pg_.fill("#a-clave", a.clave);
  await pg_.getByRole("button", { name: "Entrar" }).click();
  await pg_.locator("#a-codigo").waitFor({ timeout: 15000 });
  await olvidarUltimo(pool_, a.email);
  await pg_.fill("#a-codigo", codigoTotp());
  await Promise.all([pg_.waitForURL(/\/admin$/, { timeout: 30000 }), pg_.getByRole("button", { name: "Entrar" }).click()]);
}

const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium" });

// ── El visitante: llega por una campaña, entra a la demo desde el celular y recorre pantallas
const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, userAgent: "Mozilla/5.0 (Linux; Android 14; SM-A145M) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0 Mobile Safari/537.36" });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
await p.goto(B + "/precios?utm_source=prueba-e2e&utm_campaign=lanzamiento-" + sufijo);
for (let i = 0; i < 40 && !(await ctx.cookies()).some((c) => c.name === "regenta_origen"); i++) await p.waitForTimeout(250); // se guarda al cargar la página
await p.goto(B + "/");                                   // el origen es el del primer contacto: no se sobrescribe
await p.getByRole("button", { name: /Probar/ }).first().click();
await p.waitForURL(/\/inicio/);
const visita = (await ctx.cookies()).find((c) => c.name === "regenta_demo_visita")?.value;
ok(!!visita, "entrar a la demo crea la visita y su cookie", visita ?? "");
for (const r of ["/prediccion", "/alertas"]) { await p.goto(B + r); await p.waitForTimeout(600); }
// La oferta de salida: se adelanta el reloj del recorrido y se simula que el puntero sale por arriba.
await p.evaluate(() => { const k = "regenta_demo_v1"; const e = JSON.parse(sessionStorage.getItem(k) ?? "{}"); sessionStorage.setItem(k, JSON.stringify({ hechos: [], ofertas: [], ...e, inicio: Date.now() - 60000 })); document.dispatchEvent(new MouseEvent("mouseout", { clientY: 0, bubbles: true })); });
const dialogo = p.getByRole("dialog");
await dialogo.waitFor();
ok(await dialogo.getByRole("button", { name: "Prefiero que me llamen" }).isVisible(), "la oferta permite dejar los datos para que lo llamen");
await dialogo.getByRole("button", { name: "Prefiero que me llamen" }).click();
await dialogo.getByLabel("Tu nombre").fill("María Visitante");
await dialogo.getByLabel("Droguería").fill(`Droguería Visita ${sufijo}`);
await dialogo.getByLabel("Ciudad").fill("Ibagué");
await dialogo.getByLabel("Celular o WhatsApp").fill("3001234567");
await dialogo.getByRole("button", { name: "Que me llamen" }).click();
await dialogo.getByText("Listo. Te contactamos").waitFor();
ok(true, "los datos se envían desde la demo");
await dialogo.getByRole("button", { name: "Seguir probando la demo" }).click();
await p.getByRole("link", { name: "Contratar ahora" }).first().click();
await p.waitForURL(/\/contratar/);
await p.waitForTimeout(800);
ok(errs.length === 0, "sin errores de JavaScript en la visita", errs.join(" | "));

// ── En la base
const v = (await pool.query(`select v.*, s.drogueria from demo_visitas v left join solicitudes_demo s on s.id = v.solicitud_id where v.id = $1`, [visita])).rows[0];
ok(v?.origen === "prueba-e2e" && v?.campana === `lanzamiento-${sufijo}` && v?.landing === "/precios", "origen, campaña y primera página del primer contacto", JSON.stringify([v?.origen, v?.campana, v?.landing]));
ok(v?.dispositivo === "celular" && v?.sistema === "Android" && v?.navegador === "Chrome" && v?.rol === "dueno", "dispositivo, sistema, navegador y rol", JSON.stringify([v?.dispositivo, v?.sistema, v?.navegador, v?.rol]));
ok(v?.ciudad === null && v?.visitante === null, "fuera de Netlify no se inventa ubicación ni visitante");
ok(v?.drogueria === `Droguería Visita ${sufijo}`, "la solicitud queda unida a la visita");
const ev = (await pool.query(`select tipo, detalle from demo_eventos where visita_id = $1 order by id`, [visita])).rows;
const hay = (t, d) => ev.some((e) => e.tipo === t && (d === undefined || e.detalle === d));
ok(hay("pagina", "/inicio") && hay("pagina", "/prediccion") && hay("pagina", "/alertas"), "registra las pantallas", ev.filter((e) => e.tipo === "pagina").map((e) => e.detalle).join(","));
ok(hay("oferta", "salida"), "registra la oferta vista");
ok(hay("datos"), "registra los datos dejados");
ok(hay("contratar"), "registra el clic en Contratar");

// ── Una droguería real no registra eventos de demo aunque llegue la petición
{
  const r = await fetch(B + "/api/demo/evento", { method: "POST", headers: { origin: B, "content-type": "application/json" }, body: JSON.stringify({ tipo: "pagina", detalle: "/x" }) });
  ok(r.status === 401, "el registro de eventos exige sesión", String(r.status));
  const r2 = await p.evaluate(async () => (await fetch("/api/demo/evento", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tipo: "inventado" }) })).status);
  ok(r2 === 400, "tipos de evento desconocidos se rechazan", String(r2));
}

// ── La consola
const c2 = await b.newContext({ viewport: { width: 1440, height: 900 } });
const a = await c2.newPage();
const errsA = []; a.on("pageerror", (e) => errsA.push(e.message));
await entrarConsolaUI(a, ADMIN, pool);
await a.getByRole("link", { name: "Visitas a la demo" }).click(); await a.waitForURL(/\/admin\/demo/);
const t = await a.locator("main").innerText();
ok(/Visitas a la demo/.test(t) && /Mostraron interés/.test(t), "la consola muestra las cifras de la demo");
ok(t.includes(`Dejó sus datos: María Visitante · Droguería Visita ${sufijo}`) && /desde prueba-e2e/.test(t), "la lista muestra el origen y los datos dejados");
await a.getByRole("link", { name: "Con interés" }).click();
ok((await a.locator("main").innerText()).includes(`Droguería Visita ${sufijo}`), "el filtro «Con interés» la incluye");
await a.locator(`a[href="/admin/demo/${visita}"]`).click(); await a.waitForURL(new RegExp(visita));
const d = await a.locator("main").innerText();
ok(/Abrió Predicción de vencimientos/.test(d) && /Vio la oferta al intentar irse/.test(d) && /Dejó sus datos/.test(d) && /Pulsó Contratar/.test(d), "la línea de tiempo cuenta lo que hizo", d.slice(0, 300));
ok(await a.getByRole("link", { name: "Escribir por WhatsApp" }).count() === 1, "desde la visita se le escribe por WhatsApp");
const r3 = await fetch(B + "/admin/demo", { redirect: "manual" });
ok([307, 308].includes(r3.status), "la página exige sesión de consola", String(r3.status));
ok(errsA.length === 0, "sin errores de JavaScript en la consola", errsA.join(" | "));
await a.screenshot({ path: "test-results/admin-visita-demo.png", fullPage: true });

await b.close(); await pool.end();
console.log(`\n${fallos} fallos`); process.exit(fallos ? 1 : 0);
