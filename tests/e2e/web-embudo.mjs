// Embudo de la web pública (059, 21/11/2026): una vista por página de venta con su origen y dispositivo, y los clics a
// «Contratar», WhatsApp y «Probar» (que entra a la demo); la app de una droguería no se mide; la API solo acepta pasos
// conocidos desde el propio sitio; la consola muestra el embudo.
// Uso: servidor con REGENTA_DEMO=1 → BASE=… DATABASE_URL=… node tests/e2e/web-embudo.mjs
import { execFileSync } from "node:child_process";
import pg from "pg";
import { chromium } from "playwright-core";
import { codigoTotp, olvidarUltimo, TOTP } from "../ayudas/totp.mjs";

const B = process.env.BASE ?? "http://localhost:4500", DB = process.env.DATABASE_URL;
let fallos = 0;
const ok = (c, m, x = "") => { console.log(`${c ? "PASS" : "FAIL"} ${m}${x ? " — " + x : ""}`); if (!c) fallos++; };
const pool = new pg.Pool({ connectionString: DB });
const q = (s, v = []) => pool.query(s, v).then((r) => r.rows);
const espera = (ms) => new Promise((r) => setTimeout(r, ms));
async function eventos(v, n, ms = 8000) { const t = Date.now(); let r = []; while (Date.now() - t < ms) { r = await q(`select tipo, ruta, detalle, origen, dispositivo from web_eventos where visitante = $1 order by id`, [v]); if (r.length >= n) break; await espera(250); } return r; }

const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium" });
try {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, userAgent: "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Mobile Safari/537.36" });
  const p = await ctx.newPage();
  // Llega desde una campaña a la portada
  await p.goto(B + "/?utm_source=prueba-embudo&utm_campaign=c1"); await p.waitForLoadState("networkidle");
  const v = await p.evaluate(() => localStorage.getItem("regenta_v"));
  ok(/^[a-z0-9]{8,32}$/.test(v ?? ""), "el navegador recibe un identificador aleatorio (sin datos personales)", v);
  let ev = await eventos(v, 1);
  ok(ev[0]?.tipo === "vista" && ev[0]?.ruta === "/" && ev[0]?.origen === "prueba-embudo" && ev[0]?.dispositivo === "celular", "vista de la portada con su origen (utm) y dispositivo", JSON.stringify(ev[0]));
  // Va a precios y toca WhatsApp y Contratar (sin seguir los enlaces)
  await p.goto(B + "/precios"); await p.waitForLoadState("networkidle");
  await p.evaluate(() => document.addEventListener("click", (e) => e.preventDefault(), { once: false }));
  await p.locator('a[href*="wa.me"]:visible').first().click();
  await p.locator('a[href*="/contratar"]:visible').first().click();
  ev = await eventos(v, 4);
  ok(ev.some((x) => x.tipo === "vista" && x.ruta === "/precios"), "vista de /precios");
  ok(ev.some((x) => x.tipo === "whatsapp" && x.ruta === "/precios"), "clic a WhatsApp desde /precios");
  ok(ev.some((x) => x.tipo === "contratar" && /Contratar/i.test(x.detalle ?? "")), "clic a Contratar con el texto del botón", ev.find((x) => x.tipo === "contratar")?.detalle);
  // «Probar» entra a la demo y se registra antes de salir de la web
  const p2 = await ctx.newPage();
  await p2.goto(B + "/"); await p2.waitForLoadState("networkidle");
  await Promise.all([p2.waitForURL(/\/inicio/), p2.getByRole("button", { name: "Probar gratis ahora" }).first().click()]);
  ev = await eventos(v, 6);
  ok(ev.some((x) => x.tipo === "demo" && /Probar gratis ahora/.test(x.detalle ?? "")), "clic a «Probar gratis ahora» antes de entrar a la demo");
  // Dentro de la app no se mide con esto
  const antes = (await q(`select count(*)::int n from web_eventos where visitante = $1`, [v]))[0].n;
  await p2.goto(B + "/inventario"); await p2.waitForLoadState("networkidle"); await espera(1500);
  ok((await q(`select count(*)::int n from web_eventos where visitante = $1`, [v]))[0].n === antes, "las pantallas de la droguería no se registran");

  // API: solo pasos conocidos y desde el propio sitio
  const api = (cuerpo, origen = B) => fetch(B + "/api/web/evento", { method: "POST", headers: { origin: origen, "content-type": "application/json" }, body: JSON.stringify(cuerpo) }).then((r) => r.status);
  ok(await api({ tipo: "otra-cosa", ruta: "/" }) === 400, "un paso desconocido no entra (400)");
  ok(await api({ tipo: "vista", ruta: "sin-barra" }) === 400, "una ruta mal formada no entra (400)");
  ok(await api({ tipo: "vista", ruta: "/" }, "https://otro-sitio.example") === 403, "desde otro sitio no entra (403)");

  // Consola: el embudo con sus pasos
  const sufijo = String(Date.now()).slice(-6), A = { email: `admin-embudo${sufijo}@regenta.test`, clave: "ConsolaEmbudo2026" };
  execFileSync("node", ["scripts/crear-superadmin.mjs", A.email, "Admin Embudo"], { env: { ...process.env, REGENTA_CLAVE_PRUEBA: A.clave, REGENTA_TOTP_PRUEBA: TOTP, DATABASE_URL: DB } });
  const c = await (await b.newContext()).newPage();
  await c.goto(B + "/admin/entrar"); await c.fill("#a-email", A.email); await c.fill("#a-clave", A.clave);
  await c.getByRole("button", { name: "Entrar" }).click();
  const conCodigo = await c.locator("#a-codigo").waitFor({ timeout: 8000 }).then(() => true).catch(() => false);
  if (conCodigo) { await olvidarUltimo(pool, A.email); await c.fill("#a-codigo", codigoTotp()); await Promise.all([c.waitForURL(/\/admin$/, { timeout: 30000 }), c.getByRole("button", { name: "Entrar" }).click()]); }
  else await c.waitForURL(/\/admin$/, { timeout: 30000 });
  await c.goto(B + "/admin/demo?dias=1");
  const t = await c.locator("main").innerText();
  ok(/Embudo de la web/.test(t) && /Llegan a la web/.test(t) && /Tocan «Probar»/.test(t) && /Tocan «Contratar»/.test(t) && /Pagos aprobados/.test(t), "la consola muestra el embudo de la web");
  ok(/\/precios/.test(t) && /contratar · /.test(t), "y por dónde llegan y qué botones tocan");
} finally {
  await b.close(); await pool.end();
}
console.log(`\n${fallos} fallos`);
process.exit(fallos ? 1 : 0);
