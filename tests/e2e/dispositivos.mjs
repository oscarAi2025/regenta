// Matriz de dispositivos: cada pantalla pública, de la app (dueño, cajero, bodega) y de la consola de administración en
// celulares pequeños y grandes (iPhone SE 320 px, Galaxy S8 360, iPhone 13 390, Pixel 7 412, iPhone 15 Pro Max 430),
// celular horizontal, tabletas (iPad 810, iPad Pro 834) y PC (1366 y 1920). En cada una: estado 200, sin errores de
// consola, sin desborde horizontal, ningún elemento visible que se salga de la pantalla, y en táctiles los botones y
// campos con al menos 32 px de alto (aviso, no fallo, entre 24 y 32 px; fallo por debajo de 24).
// Uso: servidor con REGENTA_DEMO=1 → BASE=… DATABASE_URL=… node tests/e2e/dispositivos.mjs
import { chromium, devices } from "playwright-core";
import { execFileSync } from "node:child_process";

const B = process.env.BASE ?? "http://localhost:4500";
let fallos = 0, revisadas = 0, avisos = 0;
const ok = (c, m, x = "") => { if (!c) { console.log(`FAIL ${m}${x ? " — " + x : ""}`); fallos++; } };
const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium" });
{ const nc = b.newContext.bind(b); b.newContext = async (o) => { const c = await nc(o); await c.addInitScript(() => { try { sessionStorage.setItem("regenta_demo_v1", JSON.stringify({ hechos: [], ofertas: ["prueba", "prueba"], cerrada: true, inicio: Date.now() })); } catch {} }); return c; }; }

const EQUIPOS = [
  ["iPhone SE", devices["iPhone SE"]], ["Galaxy S8", devices["Galaxy S8"]], ["iPhone 13", devices["iPhone 13"]], ["Pixel 7", devices["Pixel 7"]],
  ["iPhone 15 Pro Max", devices["iPhone 15 Pro Max"]], ["iPhone 13 horizontal", devices["iPhone 13 landscape"]],
  ["iPad", devices["iPad (gen 7)"]], ["iPad Pro 11", devices["iPad Pro 11"]],
  ["PC 1366", { viewport: { width: 1366, height: 768 } }], ["PC 1920", { viewport: { width: 1920, height: 1080 } }],
];
const PUBLICAS = ["/", "/precios", "/funciones", "/por-que-regenta", "/software", "/guias", "/contratar", "/entrar", "/privacidad", "/terminos", "/admin/entrar"];
const APP = {
  dueno: ["/inicio", "/caja", "/ventas", "/clientes", "/cartera", "/pedidos", "/pedidos/nuevo", "/turno", "/productos", "/productos/nuevo", "/productos/importar", "/productos/precios",
    "/etiquetas", "/inventario", "/inventario/recibir", "/inventario/ajustes", "/inventario/conteos", "/inventario/cuarentena", "/prediccion", "/alertas", "/compras", "/compras/nueva",
    "/proveedores", "/cuentas-por-pagar", "/documentos", "/temperatura", "/control-especial", "/reportes", "/reportes/resultados", "/reportes/iva", "/reportes/cierre", "/gastos",
    "/bitacora", "/equipo", "/cuenta"],
  cajero: ["/inicio", "/caja", "/ventas", "/clientes", "/pedidos", "/turno", "/productos", "/inventario", "/temperatura", "/cuenta"],
  bodega: ["/inicio", "/inventario", "/inventario/ajustes", "/inventario/conteos", "/etiquetas", "/inventario/cuarentena", "/compras", "/productos", "/cuenta"],
};
const ADMIN = ["/admin", "/admin/clientes", "/admin/clientes/nuevo", "/admin/solicitudes", "/admin/pagos", "/admin/correos", "/admin/sistema", "/admin/bitacora"];

// Superadmin local de prueba (misma vía que tests/e2e/admin.mjs).
const adm = { email: `disp${Date.now().toString(36)}@regenta.test`, clave: "ConsolaPrueba2026" };
execFileSync("node", ["scripts/crear-superadmin.mjs", adm.email, "Admin Dispositivos"], { env: { ...process.env, REGENTA_CLAVE_PRUEBA: adm.clave }, stdio: "ignore" });

async function revisar(p, errs, ruta, etiqueta, tactil) {
  errs.length = 0;
  let r;
  try { r = await p.goto(B + ruta, { waitUntil: "networkidle", timeout: 45000 }); } catch (e) { ok(false, `${etiqueta}: ${ruta} no cargó`, e.message.split("\n")[0]); return; }
  await p.waitForTimeout(150);
  revisadas++;
  ok(r && r.status() === 200, `${etiqueta}: ${ruta} estado`, `${r?.status()}`);
  ok(errs.length === 0, `${etiqueta}: ${ruta} errores de consola`, errs.slice(0, 3).join(" | "));
  const m = await p.evaluate((tactil) => {
    const W = document.documentElement.clientWidth;
    const fuera = [], chicos = [], diminutos = [];
    const visible = (el) => { const s = getComputedStyle(el); if (s.visibility === "hidden" || s.display === "none" || +s.opacity === 0) return false; const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const dentroDeScroll = (el) => { for (let x = el.parentElement; x && x !== document.body; x = x.parentElement) { const s = getComputedStyle(x); if (/(auto|scroll|hidden|clip)/.test(s.overflowX)) return true; } return false; };
    const nombre = (el) => (el.tagName.toLowerCase() + (el.id ? "#" + el.id : "") + " «" + (el.innerText || el.getAttribute("aria-label") || el.getAttribute("placeholder") || "").trim().slice(0, 30) + "»");
    for (const el of document.querySelectorAll("body *")) {
      if (!visible(el) || el.closest("[aria-hidden=true], .sr-only, svg")) continue;
      const r = el.getBoundingClientRect();
      if ((r.right > W + 1 || r.left < -1) && !dentroDeScroll(el)) fuera.push(nombre(el) + ` ${Math.round(r.left)}–${Math.round(r.right)}`);
      if (tactil && el.matches("button, input:not([type=hidden]):not([type=checkbox]):not([type=radio]), select, textarea, [role=button]") && !el.closest("nav[aria-label='Migas'], .sr-only")) {
        if (r.height < 24) diminutos.push(nombre(el) + ` ${Math.round(r.height)}px`); else if (r.height < 32) chicos.push(nombre(el) + ` ${Math.round(r.height)}px`);
      }
    }
    return { desborde: document.documentElement.scrollWidth - W, fuera: fuera.slice(0, 4), nf: fuera.length, chicos: chicos.slice(0, 3), nc: chicos.length, diminutos: diminutos.slice(0, 3), nd: diminutos.length };
  }, tactil);
  ok(m.desborde <= 0, `${etiqueta}: ${ruta} desborde horizontal`, `${m.desborde}px`);
  ok(m.nf === 0, `${etiqueta}: ${ruta} ${m.nf} elemento(s) fuera de pantalla`, m.fuera.join(" · "));
  ok(m.nd === 0, `${etiqueta}: ${ruta} ${m.nd} control(es) de menos de 24 px`, m.diminutos.join(" · "));
  if (m.nc) { avisos++; console.log(`AVISO ${etiqueta}: ${ruta} ${m.nc} control(es) entre 24 y 32 px — ${m.chicos.join(" · ")}`); }
}

// EQUIPOS="iPhone SE,PC 1366" limita la corrida a esos equipos.
const SOLO = process.env.EQUIPOS?.split(",").map((x) => x.trim());
for (const [equipo, opts] of EQUIPOS.filter(([n]) => !SOLO || SOLO.includes(n))) {
  const tactil = !!opts.hasTouch;
  // Web pública
  { const c = await b.newContext(opts); const p = await c.newPage(); const errs = [];
    p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (x) => x.type() === "error" && errs.push(x.text()));
    for (const ruta of PUBLICAS) await revisar(p, errs, ruta, `${equipo} pública`, tactil);
    await c.close(); }
  // App por rol (demo)
  for (const [rol, rutas] of Object.entries(APP)) {
    const c = await b.newContext(opts); const p = await c.newPage(); const errs = [];
    p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (x) => x.type() === "error" && errs.push(x.text()));
    await p.request.post(B + "/demo", { form: { rol } });
    for (const ruta of rutas) await revisar(p, errs, ruta, `${equipo} ${rol}`, tactil);
    await c.close();
  }
  // Consola de administración
  { const c = await b.newContext(opts); const p = await c.newPage(); const errs = [];
    p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (x) => x.type() === "error" && errs.push(x.text()));
    await p.goto(B + "/admin/entrar"); await p.fill("#a-email", adm.email); await p.fill("#a-clave", adm.clave);
    await Promise.all([p.waitForURL(/\/admin$/, { timeout: 30000 }), p.getByRole("button", { name: "Entrar" }).click()]);
    for (const ruta of ADMIN) await revisar(p, errs, ruta, `${equipo} superadmin`, tactil);
    await c.close(); }
  console.log(`· ${equipo}: hecho (${revisadas} pantallas, ${fallos} fallos acumulados)`);
}
await b.close();
console.log(`\n${revisadas} pantallas revisadas en ${EQUIPOS.length} equipos · ${avisos} avisos · ${fallos} fallos`);
process.exit(fallos ? 1 : 0);
