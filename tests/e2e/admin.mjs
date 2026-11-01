// Consola de superadministración y acceso con contraseña, de punta a punta:
// crear superadmin (script) → entrar a /admin → alta de cliente con numeración → activar la cuenta del dueño con el
// enlace → el dueño entra y vende → suspender (no entra) → activar → agregar cajera → entrar como el dueño (soporte)
// → solicitudes → sistema → bitácora. También: un cliente no entra a /admin y la API de la consola exige sesión.
// Correos (sin Resend quedan «simulados»): invitación, bienvenida, suspensión, restablecer, solicitud + embudo, baja de un
// clic, recordatorios de renovación y la tarea programada. Seguridad: suspender o restablecer cierra sesiones abiertas,
// una cuenta de superadmin no se toca desde un cliente, la demo solo entra con sus usuarios fijos, salir de la consola
// cierra la sesión de soporte.
// Uso: servidor en :4500 con REGENTA_SESSION_SECRET y REGENTA_CRON_KEY de abajo → node tests/e2e/admin.mjs
import { chromium, devices } from "playwright-core";
import { createHmac } from "node:crypto";
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
const SECRETO = process.env.REGENTA_SESSION_SECRET ?? "prueba-local-0123456789abcdef0123456789";
const CRON = process.env.REGENTA_CRON_KEY ?? "cron-prueba-0123456789abcdef0123456789";
const correo = async (para, plantilla) => (await pool.query(`select estado, datos, programado > now() futuro from correos where para = $1 and plantilla = $2 order by id desc limit 1`, [para, plantilla])).rows[0];
const tokenBaja = (e) => Buffer.from(e).toString("base64url") + "." + createHmac("sha256", "baja:" + SECRETO).update(e).digest("base64url").slice(0, 32);

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
const inv = await correo(DUENO.email, "invitacion");
ok(inv?.estado === "simulado", "correo de invitación al dueño (simulado sin Resend)", inv?.estado);
ok(inv && !("enlace" in inv.datos), "el enlace de activación no queda guardado después de enviar");

// ── El dueño activa su cuenta y entra
// Cada corrida con su propia IP (el servidor de pruebas cree x-real-ip con REGENTA_CABECERA_IP): así los límites de
// intentos por IP no se acumulan entre corridas.
const IP = `10.${Number(sufijo) % 250}.${Math.floor(Math.random() * 250)}.9`;
const d = await b.newContext({ ...devices["iPhone 13"], extraHTTPHeaders: { "x-real-ip": IP } });
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
const reuso = await fetch(B + "/api/activar", { method: "POST", headers: { origin: B, "content-type": "application/json", "x-real-ip": IP }, body: JSON.stringify({ token: new URL(enlace).searchParams.get("t"), clave: "OtraClave2026x", repetir: "OtraClave2026x" }) });
ok(reuso.status === 400, "el enlace no se puede usar dos veces");
ok((await correo(DUENO.email, "bienvenida"))?.estado === "simulado", "correo de bienvenida al activar");
await q.goto(B + "/entrar");
await q.fill("#a-email", DUENO.email.toUpperCase()); await q.fill("#a-clave", DUENO.clave);
await q.getByRole("button", { name: "Entrar", exact: true }).click();
await q.waitForURL(/\/inicio/);
ok(true, "el dueño entra con correo (sin importar mayúsculas) y contraseña");
const prohibido = await q.request.get(B + "/admin", { maxRedirects: 0 });
ok([307, 308].includes(prohibido.status()), "un cliente no entra a la consola", String(prohibido.status()));
const uidDueno = (await pool.query(`select id from cuentas where email = $1`, [DUENO.email])).rows[0].id;
const sesDemo = await fetch(B + "/api/sesion", { method: "POST", headers: { origin: B, "content-type": "application/json" }, body: JSON.stringify({ uid: uidDueno }) });
ok([400, 404].includes(sesDemo.status), "el acceso de demo no abre la sesión de una cuenta real", String(sesDemo.status));

// ── Suspender: el dueño ya no entra; activar: vuelve a entrar
await p.goto(B + `/admin/clientes/${emp.id}`);
await p.getByRole("button", { name: "Suspender" }).click();
await p.getByRole("button", { name: "¿Suspender? Sí" }).click();
await p.getByText("Suspendido").first().waitFor();
const intento = await d.request.post(B + "/api/acceso", { headers: { origin: B }, data: { email: DUENO.email, clave: DUENO.clave } });
ok(intento.status() === 403 && /suspendida/.test((await intento.json()).error), "cliente suspendido no puede entrar");
const abierta = await q.request.get(B + "/inicio", { maxRedirects: 0 });
ok([307, 308].includes(abierta.status()), "suspender cierra la sesión que ya estaba abierta", String(abierta.status()));
const escribe = await q.request.post(B + "/api/productos", { headers: { origin: B }, data: { nombre: "No debe crearse", precio_caja: 1000 } });
ok(escribe.status() === 401, "una sesión de un cliente suspendido no escribe", String(escribe.status()));
ok((await correo(DUENO.email, "cuenta_suspendida"))?.estado === "simulado", "correo de cuenta suspendida al dueño");
await p.getByRole("button", { name: "Activar", exact: true }).click();
await p.getByText("Activo").first().waitFor();
const intento2 = await d.request.post(B + "/api/acceso", { headers: { origin: B }, data: { email: DUENO.email, clave: DUENO.clave } });
ok(intento2.status() === 200, "activado vuelve a entrar");
ok((await q.request.get(B + "/inicio", { maxRedirects: 0 })).status() === 200, "al reactivar, la sesión del dueño vuelve a servir");

// ── Cambiar plan y agregar una cajera
await p.getByRole("button", { name: "Cambiar a Esencial" }).click();
await p.getByText("Plan: Esencial").waitFor();
ok((await pool.query(`select plan from empresas where id = $1`, [emp.id])).rows[0].plan === "esencial", "cambio de plan en un clic");
await p.fill("#u-nombre", "Ana Cajera"); await p.fill("#u-email", `cajera${sufijo}@drogueria.test`); await p.selectOption("#u-rol", "cajero");
await p.getByRole("button", { name: "Agregar usuario" }).click();
await p.locator('input[aria-label="Enlace de activación"]').waitFor();
await p.getByRole("cell", { name: /Ana Cajera/ }).first().waitFor();
ok(true, "usuario agregado con su enlace");
ok((await correo(`cajera${sufijo}@drogueria.test`, "invitacion"))?.estado === "simulado", "correo de invitación a la cajera");
const superEnCliente = await p.request.post(B + `/api/admin/clientes/${emp.id}/usuarios`, { headers: { origin: B }, data: { nombre: "Intruso", email: ADMIN.email, rol: "dueno" } });
ok(superEnCliente.status() === 400 && /administrador de Regenta/.test((await superEnCliente.json()).error), "una cuenta de superadmin no se agrega a un cliente", String(superEnCliente.status()));
const demoId = (await pool.query(`select id from empresas where demo limit 1`)).rows[0].id;
const enDemo = await p.request.post(B + `/api/admin/clientes/${demoId}/usuarios`, { headers: { origin: B }, data: { nombre: "Real", email: `real${sufijo}@x.test`, rol: "dueno" } });
ok(enDemo.status() === 400, "a la demo no se le agregan usuarios reales", String(enDemo.status()));
// Restablecer la contraseña del dueño: su sesión abierta muere y le llega el correo
const rest = await p.request.patch(B + `/api/admin/clientes/${emp.id}/usuarios`, { headers: { origin: B }, data: { cuenta_id: uidDueno, enlace: true } });
ok(rest.status() === 200 && /\/activar\?t=/.test((await rest.json()).enlace ?? ""), "enlace nuevo de contraseña");
ok([307, 308].includes((await q.request.get(B + "/inicio", { maxRedirects: 0 })).status()), "restablecer la contraseña cierra las sesiones abiertas");
ok((await correo(DUENO.email, "restablecer"))?.estado === "simulado", "correo de contraseña nueva");
await p.screenshot({ path: "test-results/admin-cliente.png", fullPage: true });

// ── Entrar como el dueño (soporte) y volver
await p.getByRole("button", { name: "Entrar como el dueño" }).click();
await p.waitForURL(/\/inicio/);
ok(await p.getByText(/como soporte de Regenta/).count() === 1, "entra como el dueño con el aviso de soporte");
const cookieSoporte = (await ctx.cookies()).find((c) => c.name === "regenta_sesion");
ok(cookieSoporte && cookieSoporte.expires - Date.now() / 1000 <= 3600 + 60, "la sesión de soporte dura como máximo 1 hora");
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

// ── Correos: solicitud de demo con y sin autorización, embudo, baja de un clic, recordatorios y tarea programada
const pide = (email, acepta) => fetch(B + "/api/demo", { method: "POST", headers: { origin: B, "content-type": "application/json", "x-real-ip": `10.${sufijo % 250}.${Date.now() % 250}.${acepta ? 1 : 2}` },
  body: JSON.stringify({ nombre: "Lucía Embudo", drogueria: `Droguería Embudo ${sufijo}`, telefono: "3001112233", email, ...(acepta ? { acepta: "on" } : {}) }) });
const conEmail = `lucia${sufijo}@embudo.test`, sinPermiso = `sin${sufijo}@embudo.test`;
ok((await pide(conEmail, true)).status === 201 && (await pide(sinPermiso, false)).status === 201, "solicitudes de demo con correo");
ok((await correo(conEmail, "solicitud_recibida"))?.estado === "simulado", "confirmación de la solicitud enviada al instante");
const embudo = (await pool.query(`select plantilla, estado, programado > now() futuro from correos where para = $1 and tipo = 'comercial' order by programado`, [conEmail])).rows;
ok(embudo.length === 5 && embudo.every((m) => m.estado === "pendiente" && m.futuro), "embudo de 5 correos programado en el futuro", embudo.map((m) => m.plantilla).join(","));
ok((await pool.query(`select count(*)::int n from correos where para = $1 and tipo = 'comercial'`, [sinPermiso])).rows[0].n === 0, "sin autorización no hay correos comerciales");
const cons = (await pool.query(`select consentimiento from solicitudes_demo where email = $1`, [conEmail])).rows[0].consentimiento;
ok(cons?.texto?.includes("darme de baja") && cons.fecha, "queda la prueba de la autorización (texto y fecha)");
await p.goto(B + `/baja?t=${tokenBaja(conEmail)}`);
await p.getByRole("button", { name: "Sí, dejar de recibirlos" }).click();
await p.getByText("No te enviaremos más correos comerciales").waitFor();
const cancelados = (await pool.query(`select count(*)::int n from correos where para = $1 and tipo = 'comercial' and estado = 'cancelado'`, [conEmail])).rows[0].n;
ok(cancelados === 5, "la baja cancela el embudo pendiente", String(cancelados));
ok((await fetch(B + `/api/correo/baja?t=${tokenBaja(conEmail).replace(/.$/, "x")}`, { method: "POST" })).status === 400, "un enlace de baja alterado no sirve");
await p.goto(B + "/baja?t=falso.falso"); ok(await p.getByText("Este enlace no es válido").count() === 1, "página de baja con enlace inválido");
// Recordatorio de renovación: un pago Wompi aprobado que vence en 5 días (hoy de Bogotá)
const refR = `RG-PRO-REN${sufijo}-ABCDEF12`;
await pool.query(`insert into pagos_suscripcion (referencia, plan, periodo, monto, proveedor, nombre, empresa, email, telefono, estado, empresa_id, vence)
  values ($1, 'pro', 'mes', 139900, 'wompi', 'Marta Dueña', 'Droguería', $2, '300', 'aprobado', $3, (now() at time zone 'America/Bogota')::date + 5)`, [refR, DUENO.email, emp.id]);
ok((await fetch(B + "/api/tareas", { method: "POST" })).status === 401, "la tarea programada exige su clave");
const tarea = await fetch(B + "/api/tareas", { method: "POST", headers: { authorization: `Bearer ${CRON}` } });
const tj = await tarea.json();
ok(tarea.status === 200 && tj.correos && tj.dian && tj.recordatorios, "la tarea programada corre correos, recordatorios y DIAN", JSON.stringify(tj).slice(0, 200));
ok((await correo(DUENO.email, "renovacion_proxima"))?.estado === "simulado", "recordatorio de renovación 5 días antes");
await p.goto(B + "/admin/correos");
ok(await p.getByRole("cell", { name: conEmail }).count() >= 1, "la consola lista los correos");
await p.getByRole("link", { name: "Cancelados" }).click(); await p.waitForURL(/ver=cancelado/);
ok(await p.getByRole("cell", { name: conEmail }).count() === 5, "filtra los cancelados");
await p.screenshot({ path: "test-results/admin-correos.png", fullPage: true });

// ── Móvil y salida
const m = await (await b.newContext(devices["Pixel 7"])).newPage();
await m.context().addCookies(await ctx.cookies());
for (const r of ["/admin", "/admin/clientes", `/admin/clientes/${emp.id}`, "/admin/pagos", "/admin/solicitudes", "/admin/correos", "/admin/sistema"]) {
  await m.goto(B + r);
  const ancho = await m.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  ok(ancho <= 0, `consola en celular sin desborde: ${r}`, `${ancho}px`);
}
await p.goto(B + "/admin");
await p.getByRole("button", { name: "Salir de la consola" }).click();
await p.waitForURL(/\/admin\/entrar/);
ok(true, "sale de la consola");
ok([307, 308].includes((await p.request.get(B + "/inicio", { maxRedirects: 0 })).status()), "salir de la consola cierra también la sesión de soporte");
ok(errs.length === 0, "sin errores en consola del navegador", errs.join(" | "));

await b.close(); await pool.end();
console.log(fallos ? `\n${fallos} fallo(s)` : "\n0 fallos");
process.exit(fallos ? 1 : 0);
