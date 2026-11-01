// Consola de superadministración y acceso con contraseña, de punta a punta:
// crear superadmin (script) → entrar a /admin → alta de cliente con numeración → activar la cuenta del dueño con el
// enlace → el dueño entra y vende → suspender (no entra) → activar → agregar cajera → entrar como el dueño (soporte)
// → solicitudes → sistema → bitácora. También: un cliente no entra a /admin y la API de la consola exige sesión.
// Uso: servidor en :4500 → node tests/e2e/admin.mjs
import { chromium, devices } from "playwright-core";
import { execFileSync } from "node:child_process";
import pg from "pg";

const B = process.env.BASE ?? "http://localhost:4500";
const DB = process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/regenta?host=/tmp";
let fallos = 0;
const ok = (c, m, x = "") => { console.log(`${c ? "PASS" : "FAIL"} ${m}${x ? " — " + x : ""}`); if (!c) fallos++; };
const sufijo = Date.now().toString().slice(-6);
const ADMIN = { email: `admin${sufijo}@regenta.test`, clave: "ConsolaPrueba2026" };
const NIT = "9" + sufijo + "1";
const DUENO = { email: `dueno${sufijo}@drogueria.test`, clave: "DuenoPrueba2026" };

execFileSync("node", ["scripts/crear-superadmin.mjs", ADMIN.email, "Admin Prueba"], { env: { ...process.env, REGENTA_CLAVE_PRUEBA: ADMIN.clave, DATABASE_URL: DB } });
const pool = new pg.Pool({ connectionString: DB });
const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium" });

// ── La consola sin sesión
{
  const r = await fetch(B + "/api/admin/clientes", { method: "POST", headers: { origin: B, "content-type": "application/json" }, body: "{}" });
  ok(r.status === 401, "la API de la consola exige sesión de administrador", String(r.status));
  const r2 = await fetch(B + "/admin", { redirect: "manual" });
  ok([307, 308].includes(r2.status) && (r2.headers.get("location") ?? "").includes("/admin/entrar"), "/admin sin sesión manda a la entrada", String(r2.status));
}

const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => m.type() === "error" && !/status of 4\d\d/.test(m.text()) && errs.push(m.text()));

// ── Entrar a la consola
await p.goto(B + "/admin/entrar");
await p.fill("#a-email", ADMIN.email); await p.fill("#a-clave", "mala-clave-123");
await p.getByRole("button", { name: "Entrar" }).click();
await p.locator("form [role=alert]").waitFor();
ok(/incorrectos/.test(await p.locator("form [role=alert]").textContent()), "contraseña mala rechazada");
await p.fill("#a-clave", ADMIN.clave); await p.getByRole("button", { name: "Entrar" }).click();
await p.waitForURL(/\/admin$/);
ok(await p.getByRole("heading", { name: "Resumen" }).count() === 1, "entra al resumen de la consola");
await p.screenshot({ path: "test-results/admin-resumen.png" });

// ── Alta de cliente
await p.goto(B + "/admin/clientes/nuevo");
await p.fill("#n-razon_social", `Droguería Prueba ${sufijo}`);
await p.fill("#n-nit", NIT);
await p.selectOption("#n-plan", "pro");
await p.fill("#n-ciudad", "Ibagué");
await p.fill("#n-dueno_nombre", "Marta Dueña");
await p.fill("#n-dueno_email", DUENO.email);
await p.fill("#n-pos_prefijo", "POS"); await p.fill("#n-pos_desde", "1"); await p.fill("#n-pos_hasta", "5000");
await p.screenshot({ path: "test-results/admin-nuevo.png", fullPage: true });
await p.getByRole("button", { name: "Crear cliente" }).click();
await p.getByText("Cliente creado").waitFor();
const enlace = await p.locator('input[aria-label="Enlace de activación"]').inputValue();
ok(/\/activar\?t=[\w-]{20,}$/.test(enlace), "genera el enlace de activación del dueño");
const emp = (await pool.query(`select id, plan, estado from empresas where nit = $1`, [NIT])).rows[0];
ok(emp?.plan === "pro" && emp.estado === "activa", "empresa creada con plan Pro");
const caja = (await pool.query(`select count(*)::int n from cajas where empresa_id = $1`, [emp.id])).rows[0].n;
const res = (await pool.query(`select actual from resoluciones_dian where empresa_id = $1 and tipo = 'pos'`, [emp.id])).rows[0];
ok(caja === 1 && res?.actual === "0", "con su caja y su numeración POS");

// ── El dueño activa su cuenta y entra
const d = await b.newContext({ ...devices["iPhone 13"] });
const q = await d.newPage();
await q.goto(enlace.replace(/^https?:\/\/[^/]+/, B));
await q.fill("#v-clave", "solamenteletras"); await q.fill("#v-repetir", "solamenteletras");
await q.getByRole("button", { name: "Activar mi cuenta" }).click();
await q.locator("form [role=alert]").waitFor();
ok(/letras y números/.test(await q.locator("form [role=alert]").textContent()), "exige contraseña segura");
await q.fill("#v-clave", DUENO.clave); await q.fill("#v-repetir", DUENO.clave);
await q.getByRole("button", { name: "Activar mi cuenta" }).click();
await q.getByText(/está activa/).waitFor();
ok(true, "cuenta activada");
const reuso = await fetch(B + "/api/activar", { method: "POST", headers: { origin: B, "content-type": "application/json" }, body: JSON.stringify({ token: new URL(enlace).searchParams.get("t"), clave: "OtraClave2026x", repetir: "OtraClave2026x" }) });
ok(reuso.status === 400, "el enlace no se puede usar dos veces");
await q.goto(B + "/entrar");
await q.fill("#a-email", DUENO.email.toUpperCase()); await q.fill("#a-clave", DUENO.clave);
await q.getByRole("button", { name: "Entrar", exact: true }).click();
await q.waitForURL(/\/inicio/);
ok(true, "el dueño entra con correo (sin importar mayúsculas) y contraseña");
const prohibido = await q.request.get(B + "/admin", { maxRedirects: 0 });
ok([307, 308].includes(prohibido.status()), "un cliente no entra a la consola", String(prohibido.status()));

// ── Suspender: el dueño ya no entra; activar: vuelve a entrar
await p.goto(B + `/admin/clientes/${emp.id}`);
await p.getByRole("button", { name: "Suspender" }).click();
await p.getByRole("button", { name: "¿Suspender? Sí" }).click();
await p.getByText("Suspendido").first().waitFor();
const intento = await d.request.post(B + "/api/acceso", { headers: { origin: B }, data: { email: DUENO.email, clave: DUENO.clave } });
ok(intento.status() === 403 && /suspendida/.test((await intento.json()).error), "cliente suspendido no puede entrar");
await p.getByRole("button", { name: "Activar", exact: true }).click();
await p.getByText("Activo").first().waitFor();
const intento2 = await d.request.post(B + "/api/acceso", { headers: { origin: B }, data: { email: DUENO.email, clave: DUENO.clave } });
ok(intento2.status() === 200, "activado vuelve a entrar");

// ── Cambiar plan y agregar una cajera
await p.getByRole("button", { name: "Cambiar a Esencial" }).click();
await p.getByText("Plan: Esencial").waitFor();
ok((await pool.query(`select plan from empresas where id = $1`, [emp.id])).rows[0].plan === "esencial", "cambio de plan en un clic");
await p.fill("#u-nombre", "Ana Cajera"); await p.fill("#u-email", `cajera${sufijo}@drogueria.test`); await p.selectOption("#u-rol", "cajero");
await p.getByRole("button", { name: "Agregar usuario" }).click();
await p.locator('input[aria-label="Enlace de activación"]').waitFor();
await p.getByRole("cell", { name: /Ana Cajera/ }).first().waitFor();
ok(true, "usuario agregado con su enlace");
await p.screenshot({ path: "test-results/admin-cliente.png", fullPage: true });

// ── Entrar como el dueño (soporte) y volver
await p.getByRole("button", { name: "Entrar como el dueño" }).click();
await p.waitForURL(/\/inicio/);
ok(await p.getByText(/como soporte de Regenta/).count() === 1, "entra como el dueño con el aviso de soporte");
await p.getByRole("link", { name: "Volver a la consola" }).click();
await p.waitForURL(/\/admin\/clientes/);

// ── Solicitudes, sistema, bitácora
await pool.query(`insert into solicitudes_demo (nombre, drogueria, telefono, ciudad) values ('Pedro Prueba', 'Droguería Solicitud ${sufijo}', '3001112233', 'Neiva')`);
await p.goto(B + "/admin/solicitudes");
const fila = p.locator("li", { hasText: `Droguería Solicitud ${sufijo}` });
await fila.getByRole("button", { name: "Contactada" }).click();
await fila.waitFor({ state: "detached" });
ok((await pool.query(`select estado from solicitudes_demo where drogueria = $1`, [`Droguería Solicitud ${sufijo}`])).rows[0].estado === "contactada", "solicitud marcada como contactada");
await p.goto(B + "/admin/sistema");
await p.getByRole("button", { name: "Procesar cola ahora" }).click();
await p.getByText(/Enviados \d+/).waitFor();
ok(true, "procesa la cola DIAN en un clic");
await p.goto(B + "/admin/bitacora");
for (const a of ["crear cliente", "suspender cliente", "activar cliente", "cambiar plan", "agregar usuario", "entrar como", "procesar dian"])
  ok(await p.getByRole("cell", { name: a, exact: true }).count() >= 1, `bitácora registra «${a}»`);
await p.screenshot({ path: "test-results/admin-bitacora.png" });

// ── Móvil y salida
const m = await (await b.newContext(devices["Pixel 7"])).newPage();
await m.context().addCookies(await ctx.cookies());
for (const r of ["/admin", "/admin/clientes", `/admin/clientes/${emp.id}`, "/admin/pagos", "/admin/solicitudes", "/admin/sistema"]) {
  await m.goto(B + r);
  const ancho = await m.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  ok(ancho <= 0, `consola en celular sin desborde: ${r}`, `${ancho}px`);
}
await p.goto(B + "/admin");
await p.getByRole("button", { name: "Salir de la consola" }).click();
await p.waitForURL(/\/admin\/entrar/);
ok(true, "sale de la consola");
ok(errs.length === 0, "sin errores en consola del navegador", errs.join(" | "));

await b.close(); await pool.end();
console.log(fallos ? `\n${fallos} fallo(s)` : "\n0 fallos");
process.exit(fallos ? 1 : 0);
