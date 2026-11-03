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

// Las pruebas funcionales entran a la demo sin las ofertas del embudo (las prueba embudo.mjs).
{ const nc = b.newContext.bind(b); b.newContext = async (o) => { const c = await nc(o); await c.addInitScript(() => { try { sessionStorage.setItem("regenta_demo_v1", JSON.stringify({ hechos: [], ofertas: ["prueba", "prueba"], cerrada: true, inicio: Date.now() })); } catch {} }); return c; }; }

// ── La consola sin sesión
{
  const r = await fetch(B + "/api/admin/clientes", { method: "POST", headers: { origin: B, "content-type": "application/json" }, body: "{}" });
  ok(r.status === 401, "la API de la consola exige sesión de administrador", String(r.status));
  const r2 = await fetch(B + "/admin", { redirect: "manual" });
  ok([307, 308].includes(r2.status) && (r2.headers.get("location") ?? "").includes("/admin/entrar"), "/admin sin sesión manda a la entrada", String(r2.status));
}

const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(new URL(p.url()).pathname + ": " + e.message)); p.on("console", (m) => m.type() === "error" && !/status of 4\d\d/.test(m.text()) && errs.push(m.text()));

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

// ── Mi droguería: el dueño configura, invita a su equipo, pide enlace de contraseña; sin habilitación no vende
{
  const h = { origin: B, "x-real-ip": IP };
  const cfg = await q.request.patch(B + "/api/configuracion", { headers: h, data: { nombre_comercial: "Droguería Marta", direccion: "Cra 1 # 2-3", ciudad: "Ibagué", telefono: "3001234567", email: "", descuento_max_cajero: 5, egreso_max_cajero: 50000 } });
  ok(cfg.status() === 200, "el dueño guarda los datos de su droguería", String(cfg.status()));
  ok((await pool.query(`select egreso_max_cajero::int e from empresas where id = $1`, [emp.id])).rows[0].e === 50000, "tope de salida de caja de la cajera guardado");
  const inv = await q.request.post(B + "/api/equipo", { headers: h, data: { nombre: "Cajera Equipo", email: `equipo.${sufijo}@prueba.example`, rol: "cajero" } });
  ok(inv.status() === 201 && /\/activar\?t=/.test((await inv.json()).enlace ?? ""), "el dueño invita a su cajera con enlace", String(inv.status()));
  ok((await correo(`equipo.${sufijo}@prueba.example`, "invitacion"))?.estado === "simulado", "la cajera recibe el correo de invitación");
  const otroDueno = await q.request.post(B + "/api/equipo", { headers: h, data: { nombre: "Otro Dueño", email: `otro.${sufijo}@prueba.example`, rol: "dueno" } });
  ok(otroDueno.status() === 400, "el dueño no crea otros dueños");
  // Toma de cuenta: invitar el correo del dueño de OTRA droguería no lo vincula ni le genera enlace
  // El dueño de la Droguería Vecina (otra empresa del sembrado) con su cuenta de acceso.
  const ajeno = (await pool.query(`insert into cuentas (id, email, nombre) values ('00000000-0000-4000-8000-000000000004', $1, 'Dueño Vecina')
    on conflict (id) do update set email = excluded.email returning id, email`, [`vecina.${sufijo}@prueba.example`])).rows[0];
  const robo = await q.request.post(B + "/api/equipo", { headers: h, data: { nombre: "Vecino", email: ajeno.email, rol: "cajero" } });
  ok(robo.status() === 409 && !(await robo.json()).enlace, "no se puede invitar la cuenta de otra droguería", String(robo.status()));
  ok((await pool.query(`select count(*)::int n from miembros where empresa_id = $1 and user_id = $2`, [emp.id, ajeno.id])).rows[0].n === 0, "la cuenta ajena no quedó vinculada");
  await pool.query(`insert into miembros (empresa_id, user_id, nombre, rol) values ($1, $2, 'Vecino', 'cajero')`, [emp.id, ajeno.id]); // aunque estuviera vinculada…
  const robo2 = await q.request.patch(B + "/api/equipo", { headers: h, data: { cuenta_id: ajeno.id, enlace: true } });
  ok(robo2.status() === 409, "…no se le genera enlace de contraseña", String(robo2.status()));
  await pool.query(`delete from miembros where empresa_id = $1 and user_id = $2`, [emp.id, ajeno.id]);
  const reenvio = await q.request.patch(B + "/api/equipo", { headers: h, data: { cuenta_id: (await pool.query(`select id from cuentas where email = $1`, [`equipo.${sufijo}@prueba.example`])).rows[0].id, enlace: true } });
  ok(reenvio.status() === 200, "reenviar la invitación a la propia cajera sigue funcionando", String(reenvio.status()));
  // Cajas: Esencial incluye 1; con Pro hasta 3; nombres únicos; no se apaga la última ni una con turno abierto
  const planAntes = (await pool.query(`select plan from empresas where id = $1`, [emp.id])).rows[0].plan;
  await pool.query(`update empresas set plan = 'esencial' where id = $1`, [emp.id]);
  const cj1b = await q.request.post(B + "/api/cajas", { headers: h, data: { nombre: "Caja 2" } });
  ok(cj1b.status() === 409 && /Pro tienes hasta 3 cajas/.test((await cj1b.json()).error), "Esencial: no deja crear una segunda caja", String(cj1b.status()));
  await pool.query(`update empresas set plan = 'pro' where id = $1`, [emp.id]);
  const cj2 = await q.request.post(B + "/api/cajas", { headers: h, data: { nombre: "Caja 2" } });
  const cj3 = await q.request.post(B + "/api/cajas", { headers: h, data: { nombre: "Mostrador" } });
  ok(cj2.status() === 201 && cj3.status() === 201, "Pro: crea la segunda y la tercera caja", `${cj2.status()} ${cj3.status()}`);
  const cj4 = await q.request.post(B + "/api/cajas", { headers: h, data: { nombre: "Caja 4" } });
  ok(cj4.status() === 409, "Pro: no pasa de 3 cajas", String(cj4.status()));
  const rep = await q.request.post(B + "/api/cajas", { headers: h, data: { nombre: "caja 2" } });
  ok(rep.status() === 409, "no deja dos cajas con el mismo nombre");
  const lista = (await (await q.request.get(B + "/api/cajas")).json()).cajas;
  const id2 = lista.find((x) => x.nombre === "Caja 2").id, idM = lista.find((x) => x.nombre === "Mostrador").id;
  ok((await q.request.patch(B + "/api/cajas", { headers: h, data: { id: idM, nombre: "Mostrador 2" } })).status() === 200, "renombra una caja");
  ok((await q.request.patch(B + "/api/cajas", { headers: h, data: { id: idM, activa: false } })).status() === 200, "desactiva una caja");
  await pool.query(`update cajas set activa = false where empresa_id = $1 and id <> $2`, [emp.id, id2]);
  const ultima = await q.request.patch(B + "/api/cajas", { headers: h, data: { id: id2, activa: false } });
  ok(ultima.status() === 409, "no deja sin ninguna caja activa", String(ultima.status()));
  await pool.query(`update cajas set activa = true where empresa_id = $1`, [emp.id]);
  await pool.query(`update cajas set activa = false where id = $1`, [idM]);
  await pool.query(`update empresas set plan = 'esencial' where id = $1`, [emp.id]);
  ok((await q.request.patch(B + "/api/cajas", { headers: h, data: { id: idM, activa: true } })).status() === 409, "de vuelta en Esencial no reactiva cajas por encima del plan");
  await pool.query(`update empresas set plan = $2 where id = $1`, [emp.id, planAntes]);
  await q.goto(B + "/equipo"); await q.waitForLoadState("networkidle");
  ok(await q.getByRole("region", { name: "Cajas" }).getByText("Caja 2").count() === 1, "Mi droguería lista las cajas");
  ok(await q.getByText("Cajera Equipo").count() === 1 && await q.getByText(/En proceso/).count() === 1, "Mi droguería muestra el equipo y la habilitación en proceso");
  await q.goto(B + "/inicio");
  ok(await q.getByRole("region", { name: "Primeros pasos" }).waitFor({ timeout: 10000 }).then(() => true).catch(() => false), "Inicio muestra los primeros pasos al dueño nuevo");
  await q.goto(B + "/caja"); await q.waitForLoadState("networkidle");
  ok(await q.getByText(/aún no está habilitada ante la DIAN/).count() >= 1, "la caja avisa que falta la habilitación DIAN");
  const r1 = await fetch(B + "/api/restablecer", { method: "POST", headers: { ...h, "content-type": "application/json" }, body: JSON.stringify({ email: DUENO.email }) });
  const r2 = await fetch(B + "/api/restablecer", { method: "POST", headers: { ...h, "content-type": "application/json" }, body: JSON.stringify({ email: `nadie.${sufijo}@prueba.example` }) });
  ok(r1.status === 200 && r2.status === 200 && (await r1.json()).mensaje === (await r2.json()).mensaje, "«olvidé mi contraseña» responde igual exista o no la cuenta");
  ok((await correo(DUENO.email, "restablecer"))?.estado === "simulado", "llega el enlace para crear contraseña nueva");
  const sigue = await d.request.post(B + "/api/acceso", { headers: { origin: B }, data: { email: DUENO.email, clave: DUENO.clave } });
  ok(sigue.status() === 200, "pedir el enlace no bloquea la contraseña actual");
}

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

// ── Facturación electrónica: conectar con MATIAS (UUID del cliente y número de resolución de producción)
{
  const seccion = p.getByRole("region", { name: "Facturación electrónica" });
  await seccion.getByLabel("UUID del cliente en MATIAS").fill("no-es-uuid");
  await seccion.getByRole("button", { name: "Guardar facturación electrónica" }).click();
  await seccion.getByText(/UUID de MATIAS no es válido/).waitFor();
  ok(true, "rechaza un UUID de MATIAS mal escrito");
  await seccion.getByLabel("UUID del cliente en MATIAS").fill("47a1257b-d8d6-428e-b28e-abddce5b8531");
  await seccion.getByLabel(/Número de resolución DIAN de POS/).fill("18764000001234");
  await seccion.getByRole("button", { name: "Guardar facturación electrónica" }).click();
  await seccion.getByText("Facturación electrónica guardada").waitFor();
  const e = (await pool.query(`select matias_cliente::text from empresas where id = $1`, [emp.id])).rows[0];
  const r = (await pool.query(`select numero_resolucion from resoluciones_dian where empresa_id = $1 and tipo = 'pos'`, [emp.id])).rows[0];
  ok(e.matias_cliente === "47a1257b-d8d6-428e-b28e-abddce5b8531" && r.numero_resolucion === "18764000001234", "guarda el UUID de MATIAS y el número de resolución");
  const idDemo = (await pool.query(`select id from empresas where demo limit 1`)).rows[0].id;
  const demo = await p.request.patch(B + `/api/admin/clientes/${idDemo}`, { headers: { origin: B }, data: { matias: { cliente: "", resoluciones: [] } } });
  ok(demo.status() === 404, "la demo no se conecta a MATIAS", String(demo.status()));
}

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
ok((await fetch(B + `/api/correo/baja?t=${tokenBaja(conEmail).replace(/.$/, (c) => (c === "x" ? "y" : "x"))}`, { method: "POST" })).status === 400, "un enlace de baja alterado no sirve");
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

// ── Pago con el QR de la cuenta Bancolombia (sin pasarela): orden, instrucciones, pantalla con el QR y confirmación en la consola
const pqEmail = `qr${sufijo}@pago.test`;
const rq = await fetch(B + "/api/pagos", { method: "POST", headers: { origin: B, "content-type": "application/json", "x-real-ip": `10.9.${Math.floor(Math.random() * 250)}.7` },
  body: JSON.stringify({ plan: "pro", periodo: "mes", proveedor: "qr", nombre: "Pablo QR", empresa: "Droguería QR", nit: `8${sufijo}2-1`, email: pqEmail, telefono: "3005556677", acepta: true }) });
const jq = await rq.json();
ok(rq.status === 201 && jq.url?.startsWith("/contratar/resultado?ref="), "QR: crea la orden y lleva a la página del QR", String(rq.status));
ok((await correo(pqEmail, "pago_qr"))?.estado === "simulado", "QR: correo con las instrucciones de pago");
const pq = await (await b.newContext({ ...devices["iPhone 13"] })).newPage();
await pq.goto(B + jq.url);
await pq.getByText("Paga exactamente").waitFor();
ok(await pq.getByText("$139.900").count() >= 1 && await pq.getByRole("link", { name: /enviar comprobante por WhatsApp/ }).count() === 1, "QR: muestra monto exacto, llave y botón del comprobante");
await pq.screenshot({ path: "test-results/pago-qr.png", fullPage: true });
await p.goto(B + "/admin/pagos?ver=qr");
const filaQr = p.locator("tr", { hasText: jq.referencia });
await filaQr.getByRole("button", { name: "Confirmar: el dinero llegó" }).click();
// Al confirmar, la fila sale de «QR por confirmar» (la pantalla se refresca): se comprueba la respuesta de la API.
const [respQr] = await Promise.all([p.waitForResponse((r) => r.url().includes("/api/admin/pagos") && r.request().method() === "PATCH"),
  filaQr.getByRole("button", { name: /¿Llegaron \$139\.900\? Sí/ }).click()]);
ok(respQr.ok() && /Pago confirmado/.test((await respQr.json()).mensaje), "QR: la consola confirma el pago");
const pagoQr = (await pool.query(`select estado, vence, confirmado_por from pagos_suscripcion where referencia = $1`, [jq.referencia])).rows[0];
ok(pagoQr.estado === "aprobado" && pagoQr.vence && pagoQr.confirmado_por, "QR: confirmado en la consola, con periodo pagado y quién lo confirmó");
ok((await correo(pqEmail, "pago_aprobado"))?.estado === "simulado", "QR: correo de pago aprobado");
// Alta automática: la droguería queda creada con su dueño invitado y numeraciones de prueba, sin pasar por la consola.
const alta = (await pool.query(`select e.id, e.nit, e.plan, p.atendido, (select count(*) from resoluciones_dian r where r.empresa_id = e.id and r.pruebas)::int pruebas,
  (select m.rol from miembros m join cuentas cu on cu.id = m.user_id where m.empresa_id = e.id and lower(cu.email) = lower($2)) rol
  from pagos_suscripcion p join empresas e on e.id = p.empresa_id where p.referencia = $1`, [jq.referencia, pqEmail])).rows[0];
ok(alta && alta.nit === `8${sufijo}2` && alta.plan === "pro" && alta.atendido && alta.pruebas === 3 && alta.rol === "dueno", "alta automática: droguería, dueño y numeraciones de prueba al aprobarse el pago", JSON.stringify(alta));
ok((await correo(pqEmail, "invitacion"))?.estado === "simulado", "alta automática: correo para crear la contraseña");
await pq.reload(); await pq.getByText("¡Pago aprobado!").waitFor({ timeout: 20000 });
ok(true, "QR: la página del cliente pasa a pago aprobado");
ok(await pq.getByText(/Tu cuenta ya está creada/).count() === 1 && await pq.getByText(/qr•••@p•••\.test/).count() === 1, "la página del pago dice a qué correo (enmascarado) llegó el acceso");
const otraVez = await p.request.patch(B + "/api/admin/pagos", { headers: { origin: B }, data: { referencia: jq.referencia, confirmar: "aprobado" } });
ok(otraVez.status() === 409, "QR: no se confirma dos veces");

// ── Descartar una orden de pasarela que nadie pagó (cierra el enlace; sin correo al cliente) y eliminar una droguería de prueba
{
  const ref = `RG-ESENCIAL-DESC${sufijo}`, pemail = `desc${sufijo}@pago.test`;
  await pool.query(`insert into pagos_suscripcion (referencia, plan, periodo, monto, proveedor, nombre, empresa, nit, email, telefono) values ($1, 'esencial', 'mes', 89900, 'wompi', 'Sin Pagar', 'Orden abandonada', '900123', $2, '3001112233')`, [ref, pemail]);
  await p.goto(B + "/admin/pagos");
  const fila = p.locator("tr", { hasText: ref });
  await fila.getByRole("button", { name: "Descartar orden sin pagar" }).click();
  await fila.getByRole("button", { name: /¿Descartar\?/ }).click();
  await fila.getByText("descartada sin pagar").waitFor();
  const o = (await pool.query(`select estado, atendido, detalle from pagos_suscripcion where referencia = $1`, [ref])).rows[0];
  ok(o.estado === "rechazado" && o.atendido && o.detalle?.descartado === true, "descartar: la orden queda rechazada, atendida y marcada", JSON.stringify(o));
  ok((await pool.query(`select count(*)::int n from correos where para = $1`, [pemail])).rows[0].n === 0, "descartar: no se escribe al cliente");
  const dos = await p.request.patch(B + "/api/admin/pagos", { headers: { origin: B }, data: { referencia: ref, descartar: true } });
  ok(dos.status() === 409, "descartar: una orden ya cerrada no se descarta otra vez", String(dos.status()));
  const qr = await p.request.patch(B + "/api/admin/pagos", { headers: { origin: B }, data: { referencia: jq.referencia, descartar: true } });
  ok(qr.status() === 409, "descartar: un pago por QR (ya aprobado) no se descarta", String(qr.status()));

  // Eliminar: la droguería creada por el pago QR (de prueba). Activa → no; NIT mal → no; suspendida → sí, con su dueño.
  const del = (data) => p.request.delete(B + `/api/admin/clientes/${alta.id}`, { headers: { origin: B }, data });
  ok((await del({ nit: alta.nit })).status() === 409, "eliminar: una droguería activa no se elimina (primero se suspende)");
  await p.request.patch(B + `/api/admin/clientes/${alta.id}`, { headers: { origin: B }, data: { estado: "suspendida" } });
  ok((await del({ nit: "123456789" })).status() === 400, "eliminar: exige escribir su NIT");
  const cuenta = (await pool.query(`select cu.id from miembros m join cuentas cu on cu.id = m.user_id where m.empresa_id = $1`, [alta.id])).rows[0].id;
  await p.goto(B + `/admin/clientes/${alta.id}`);
  await p.getByRole("button", { name: "Eliminar droguería de prueba" }).click();
  const borrar = p.getByRole("button", { name: "Eliminar para siempre" });
  ok(await borrar.isDisabled(), "eliminar: el botón espera el NIT");
  const dv = (await pool.query(`select dv from empresas where id = $1`, [alta.id])).rows[0].dv;
  await p.getByLabel(/Escribe el NIT/).fill(`${alta.nit}-${dv}`); // con dígito de verificación también vale
  await borrar.click();
  await p.waitForURL(/\/admin\/clientes\?eliminado=1/);
  const queda = (await pool.query(`select (select count(*) from empresas where id = $1)::int empresa, (select count(*) from cuentas where id = $2)::int cuenta,
    (select count(*) from pagos_suscripcion where referencia = $3 and empresa_id is null)::int pago, (select count(*) from admin_eventos where accion = 'eliminar_cliente_prueba' and datos ->> 'empresa_id' = $1::text)::int bitacora`, [alta.id, cuenta, jq.referencia])).rows[0];
  ok(queda.empresa === 0 && queda.cuenta === 0 && queda.pago === 1 && queda.bitacora === 1, "eliminar: se va la droguería y su cuenta; el pago y la bitácora quedan", JSON.stringify(queda));

  // Una droguería que facturó en producción no se elimina (sus documentos se conservan por ley).
  await pool.query(`update resoluciones_dian set pruebas = false, numero_resolucion = coalesce(numero_resolucion, '18764000001234'), vigente_desde = coalesce(vigente_desde, current_date) where empresa_id = $1 and tipo = 'pos'`, [emp.id]);
  await pool.query(`update resoluciones_dian set pruebas = false, numero_resolucion = coalesce(numero_resolucion, '18764000005678'), vigente_desde = coalesce(vigente_desde, current_date) where empresa_id = $1 and tipo = 'nota_credito'`, [emp.id]);
  await p.request.patch(B + `/api/admin/clientes/${emp.id}`, { headers: { origin: B }, data: { estado: "suspendida" } });
  const real = await p.request.delete(B + `/api/admin/clientes/${emp.id}`, { headers: { origin: B }, data: { nit: NIT } });
  ok(real.status() === 409 && /conservan por ley/.test((await real.json()).error), "eliminar: una droguería con facturación real solo se suspende", String(real.status()));
  await p.goto(B + `/admin/clientes/${emp.id}`);
  ok(await p.getByRole("button", { name: "Eliminar droguería de prueba" }).count() === 0, "eliminar: el botón no aparece en una droguería con facturación real");
  await p.request.patch(B + `/api/admin/clientes/${emp.id}`, { headers: { origin: B }, data: { estado: "activa" } });
  const idDemo = (await pool.query(`select id, nit from empresas where demo limit 1`)).rows[0];
  ok((await p.request.delete(B + `/api/admin/clientes/${idDemo.id}`, { headers: { origin: B }, data: { nit: idDemo.nit } })).status() === 409, "eliminar: la demo no se elimina");
  ok((await fetch(B + `/api/admin/clientes/${emp.id}`, { method: "DELETE", headers: { origin: B, "content-type": "application/json" }, body: JSON.stringify({ nit: NIT }) })).status === 401, "eliminar: exige sesión de administrador");

  // Ligar a su droguería un pago aprobado con otro correo (nit_existente): reactiva la suspendida por impago, plan y vencimiento.
  const refL = `RG-ESENCIAL-LIGA${sufijo}`;
  await pool.query(`update empresas set estado = 'suspendida', suspension = 'impago' where id = $1`, [emp.id]);
  await pool.query(`insert into pagos_suscripcion (referencia, plan, periodo, monto, proveedor, nombre, empresa, nit, email, telefono, estado, detalle)
    values ($1, 'pro', 'mes', 139900, 'wompi', 'Contadora', 'Pago de la droguería', $2, $3, '3001112233', 'aprobado', '{"revisar":"nit_existente"}')`, [refL, NIT, `contadora${sufijo}@pago.test`]);
  await p.goto(B + "/admin/pagos");
  const filaL = p.locator("tr", { hasText: refL });
  await filaL.getByRole("button", { name: /^Ligar a / }).click();
  await filaL.getByRole("button", { name: /Sí, ligar/ }).click();
  await filaL.getByText("Cliente:").waitFor();
  const lig = (await pool.query(`select e.estado, e.plan, p.vence is not null vence, p.detalle ? 'revisar' revisar, p.atendido from pagos_suscripcion p join empresas e on e.id = p.empresa_id where p.referencia = $1`, [refL])).rows[0];
  ok(lig?.estado === "activa" && lig.plan === "pro" && lig.vence && !lig.revisar && lig.atendido, "ligar: reactiva, deja el plan pagado y calcula el vencimiento", JSON.stringify(lig));

  // Número de la factura del servicio en el pago (lo ve el dueño).
  const fac = await p.request.patch(B + "/api/admin/pagos", { headers: { origin: B }, data: { referencia: refL, factura: "FE 1234" } });
  ok(fac.status() === 200 && (await pool.query(`select factura from pagos_suscripcion where referencia = $1`, [refL])).rows[0].factura === "FE 1234", "la consola anota la factura del servicio");

  // Datos fiscales desde la consola: razón social e IVA sí; el NIT no si ya factura en producción.
  const fis = { razon_social: "DROGUERIA CORREGIDA SAS", nombre_comercial: "Droguería Corregida", nit: NIT, responsable_iva: true, direccion: "Calle 10 # 5-20", ciudad: "Ibagué", telefono: "3001112233", email: "" };
  ok((await p.request.patch(B + `/api/admin/clientes/${emp.id}`, { headers: { origin: B }, data: { fiscal: fis } })).status() === 200, "datos fiscales: la consola los corrige");
  const ef = (await pool.query(`select razon_social, responsable_iva, ciudad, dv from empresas where id = $1`, [emp.id])).rows[0];
  ok(ef.razon_social === "DROGUERIA CORREGIDA SAS" && ef.responsable_iva && ef.ciudad === "Ibagué" && /^\d$/.test(ef.dv), "datos fiscales guardados con su DV", JSON.stringify(ef));
  ok((await p.request.patch(B + `/api/admin/clientes/${emp.id}`, { headers: { origin: B }, data: { fiscal: { ...fis, nit: "800999111" } } })).status() === 409, "datos fiscales: el NIT no cambia si ya factura en producción");

  // Copia de los datos desde la consola (ZIP con los CSV).
  const zc = await p.request.get(B + `/api/admin/clientes/${emp.id}/exportar`);
  const zb = await zc.body();
  ok(zc.status() === 200 && zb.subarray(0, 2).toString() === "PK", "la consola descarga la copia de los datos (ZIP)", String(zc.status()));
  const { writeFileSync } = await import("node:fs"); writeFileSync("test-results/copia.zip", zb);
  const lista = execFileSync("unzip", ["-l", "test-results/copia.zip"]).toString();
  ok(["productos.csv", "ventas.csv", "ventas_detalle.csv", "clientes.csv", "documentos_dian.csv", "cartera.csv", "LEEME.txt"].every((n) => lista.includes(n)), "la copia trae productos, ventas, clientes, cartera y documentos DIAN");

  // El dueño: sus pagos con comprobante y su copia de datos.
  await p.request.post(B + `/api/admin/clientes/${emp.id}/entrar`, { headers: { origin: B } });
  await p.goto(B + "/equipo", { waitUntil: "networkidle" });
  const pagosDueno = p.getByRole("region", { name: "Pagos de tu plan" });
  const conFactura = await pagosDueno.getByText("Factura FE 1234").waitFor({ timeout: 15000 }).then(() => true, () => false);
  ok(conFactura, "Mi droguería lista los pagos con su factura", p.url());
  await p.goto(B + `/recibo/${refL}`);
  ok(await p.getByRole("heading", { name: "Comprobante de pago" }).count() === 1 && await p.getByText("DROGUERIA CORREGIDA SAS").count() === 1 && await p.getByText("FE 1234").count() === 1, "comprobante del pago para el dueño");
  ok((await p.request.get(B + `/recibo/RG-PRO-${"X".repeat(8)}`)).status() === 404, "comprobante de otro pago: no existe");
  const zd = await p.request.get(B + "/api/exportar");
  ok(zd.status() === 200 && (await zd.body()).subarray(0, 2).toString() === "PK", "el dueño descarga su copia de datos", String(zd.status()));
  await p.goto(B + "/admin");
}

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
