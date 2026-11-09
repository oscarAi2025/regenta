// Habilitación DIAN desde la consola contra un MATIAS simulado (mismo contrato que docs.matias-api.com): cuenta principal
// (Farmagenéricos: mismo NIT que la casa de software, sin client_uuid), cliente con su UUID, certificado, registro del
// software, set de pruebas, paso a producción y numeraciones de la DIAN. Comprueba lo que recibe MATIAS en cada llamada.
// Uso: servidor en :4540 con REGENTA_DIAN=matias, MATIAS_URL=http://localhost:$MATIAS_MOCK_PUERTO, MATIAS_TOKEN=prueba-matias
//      → node tests/e2e/habilitacion.mjs
import pg from "pg";
import http from "node:http";
import { randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { codigoTotp, TOTP } from "../ayudas/totp.mjs";

const B = process.env.BASE ?? "http://localhost:4540";
const DB = process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/regenta?host=/tmp";
const PUERTO = Number(process.env.MATIAS_MOCK_PUERTO ?? 4840);
const pool = new pg.Pool({ connectionString: DB });
const q = (s, v = []) => pool.query(s, v).then((r) => r.rows);
let fallos = 0;
const ok = (c, m, x = "") => { console.log(`${c ? "PASS" : "FAIL"} ${m}${x ? " — " + x : ""}`); if (!c) fallos++; };
const suf = Date.now().toString().slice(-7);
const IP = `10.77.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;

// ── MATIAS simulado
const PRINCIPAL = { uuid: randomUUID(), dni: "901845370", company_name: "IA DEV INVESTIMENTS COLOMBIA SAS" };
const CLIENTE_B = randomUUID();
const llamadas = [];
const estado = new Map(); // empresa (uuid o "principal") → { cert, software: [], res: [] }
const de = (k) => { if (!estado.has(k)) estado.set(k, { cert: null, software: [], res: [] }); return estado.get(k); };
de("principal").cert = { id: 1, name: "9018453705.p12", description: "IA DEV", extension: ".p12", expiration_date: "08-11-2028 01:23:23 pm" };
const srv = http.createServer(async (req, res) => {
  let cuerpo = ""; for await (const ch of req) cuerpo += ch;
  const u = new URL(req.url, "http://x"); const ruta = u.pathname.replace("/api/ubl2.1", "");
  const cliente = u.searchParams.get("client_uuid");
  llamadas.push({ metodo: req.method, ruta, cliente, auth: req.headers.authorization, query: u.search, cuerpo: cuerpo ? JSON.parse(cuerpo) : null });
  const enviar = (s, j) => { res.writeHead(s, { "content-type": "application/json" }); res.end(JSON.stringify(j)); };
  if (req.headers.authorization !== "Bearer prueba-matias") return enviar(401, { message: "Unauthenticated." });
  if (cliente === PRINCIPAL.uuid) return enviar(403, { success: false, message: "Acceso no autorizado. Acceso denegado: No tiene permisos para operar sobre esta empresa o la relación no está activa." });
  if (cliente && cliente !== CLIENTE_B) return enviar(404, { success: false, message: "Empresa no encontrada" });
  const e = de(cliente ?? "principal");
  if (req.method === "GET" && ruta === "/company") return enviar(200, { dataRecords: { data: cliente ? { uuid: CLIENTE_B, dni: "800111222" } : PRINCIPAL }, success: true });
  if (req.method === "GET" && ruta === "/certificate") return e.cert ? enviar(200, { dataRecords: { data: e.cert }, success: true }) : enviar(500, { success: false, message: "Error interno del servidor. No existe un certificado para esta empresa." });
  if (req.method === "GET" && ruta === "/software") return enviar(200, { dataRecords: { current_page: 1, data: e.software, total: e.software.length }, success: true });
  if (req.method === "POST" && ruta === "/software") {
    const r = JSON.parse(cuerpo).records; const x = JSON.parse(r);
    if (e.software.some((s) => s.type_id === x.type_id)) return enviar(400, { success: false, message: "Ya existe un software registrado para esta compañía con el mismo tipo." });
    const s = { id: 27 + e.software.length + (cliente ? 100 : 0), ...x, test_process_status: "INITIAL", test_process: null }; e.software.push(s);
    return enviar(200, { message: "Registro creado correctamente.", record: s, success: true });
  }
  if (req.method === "POST" && ruta === "/document/run-test") {
    const s = e.software.find((z) => z.id === JSON.parse(cuerpo).software_id);
    if (!s) return enviar(404, { success: false, message: "No se encontró el software especificado." });
    s.test_process = { id: 54, status: "RUNNING", status_description: "En ejecución", error_message: null };
    return enviar(200, { message: "Se ha iniciado el proceso de habilitación de documentos electrónicos.", process_id: 54, success: true });
  }
  if (req.method === "GET" && ruta === "/numbering-range") {
    const s = e.software.find((z) => z.type_id === Number(u.searchParams.get("type_id")));
    if (!s || s.environment_id !== 1) return enviar(200, { message: "Consulta generada con éxito", sync: null, success: true });
    e.res.push({ id: 813, type_document_id: 7, resolution_number: "18764112492320", prefix: "FGE", range_from: 1, range_up: 5000, date_up: "2028-11-09", active: 1 });
    return enviar(200, { message: "Consulta generada con éxito", sync: { created: 1, updated: 0, failed: 0, errors: [], total: 1 }, success: true });
  }
  if (req.method === "GET" && ruta === "/resolutions") return enviar(200, { dataRecords: { current_page: 1, data: e.res, total: e.res.length }, success: true });
  enviar(404, { message: "ruta no simulada" });
});
await new Promise((r) => srv.listen(PUERTO, r));

async function llamar(metodo, ruta, cuerpo, cookie) {
  const r = await fetch(B + ruta, { method: metodo, redirect: "manual", headers: { origin: B, "x-real-ip": IP, "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
  const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch {}
  return { s: r.status, j, cookie: (r.headers.get("set-cookie") ?? "").split(";")[0] };
}
const ultimas = (n) => llamadas.slice(-n);

// ── Dos clientes: A con el NIT de la cuenta principal (Farmagenéricos) y B, una droguería cualquiera
const A = randomUUID(), Bx = randomUUID();
await q(`delete from empresas where nit = '901845370' and not demo and not exists (select 1 from resoluciones_dian r where r.empresa_id = empresas.id and not r.pruebas)`).catch(() => {});
await q(`insert into empresas (id, nit, dv, razon_social, plan) values ($1, '901845370', '5', 'IA DEV INVESTIMENTS COLOMBIA SAS', 'pro')`, [A]);
await q(`insert into empresas (id, nit, dv, razon_social, plan) values ($1, $2, '1', 'DROGUERIA B SAS', 'esencial')`, [Bx, "7" + suf.padStart(8, "0").slice(-8)]);
await q(`insert into resoluciones_dian (empresa_id, tipo, prefijo, desde, hasta, actual, pruebas) values ($1, 'factura', 'SETP', 1, 1000, 0, true)`, [A]);

const ADMIN = `admin${suf}@habilitacion.test`;
execFileSync("node", ["scripts/crear-superadmin.mjs", ADMIN, "Admin Habilitación"], { env: { ...process.env, REGENTA_CLAVE_PRUEBA: "ConsolaHabil2026", REGENTA_TOTP_PRUEBA: TOTP, DATABASE_URL: DB } });
const adm = (await llamar("POST", "/api/acceso", { email: ADMIN, clave: "ConsolaHabil2026", consola: true, codigo: codigoTotp() })).cookie;
ok(adm.startsWith("regenta_admin="), "la consola entra");

// ── Seguridad de la ruta
ok((await llamar("GET", `/api/admin/clientes/${A}/habilitacion`)).s === 401, "sin consola: 401");
const demo = (await q(`select id from empresas where demo limit 1`))[0]?.id;
if (demo) ok((await llamar("GET", `/api/admin/clientes/${demo}/habilitacion`, undefined, adm)).s === 404, "la demo no se habilita");

// ── A: aún sin conectar; ofrece la cuenta principal (mismo NIT)
let r = await llamar("GET", `/api/admin/clientes/${A}/habilitacion`, undefined, adm);
ok(r.s === 200 && r.j.configurado && r.j.principal?.mismo_nit && !r.j.conectado, "A: ve la cuenta principal con su mismo NIT", JSON.stringify(r.j));
ok(llamadas.every((l) => l.auth === "Bearer prueba-matias") && llamadas.some((l) => l.ruta === "/company" && !l.cliente), "a MATIAS va el token del servidor y la consulta de la cuenta principal");

// ── B no puede usar la cuenta principal (otro NIT)
r = await llamar("POST", `/api/admin/clientes/${Bx}/habilitacion`, { accion: "principal" }, adm);
ok(r.s === 409 && /no es el de la cuenta principal/.test(r.j.error), "B (otro NIT): no se conecta a la cuenta principal", `${r.s} ${r.j.error}`);
r = await llamar("PATCH", `/api/admin/clientes/${Bx}`, { matias: { cliente: PRINCIPAL.uuid, resoluciones: [] } }, adm);
ok(r.s === 409 && !(await q(`select matias_cliente from empresas where id = $1`, [Bx]))[0].matias_cliente, "B: tampoco escribiendo a mano el UUID de la cuenta principal", `${r.s} ${r.j.error}`);

// ── A se conecta a la cuenta principal
r = await llamar("POST", `/api/admin/clientes/${A}/habilitacion`, { accion: "principal" }, adm);
ok(r.s === 200 && (await q(`select matias_cliente::text c from empresas where id = $1`, [A]))[0].c === PRINCIPAL.uuid, "A: conectado a la cuenta principal", `${r.s} ${r.j.error ?? r.j.mensaje}`);
ok((await q(`select 1 from admin_eventos where empresa_id = $1 and accion = 'matias_cuenta_principal'`, [A])).length === 1, "queda en la bitácora de la consola");

// ── Estado de A: certificado de la cuenta principal, sin client_uuid
let n = llamadas.length;
r = await llamar("GET", `/api/admin/clientes/${A}/habilitacion`, undefined, adm);
ok(r.s === 200 && r.j.principal.es_este && r.j.certificado?.vence === "08-11-2028 01:23:23 pm" && r.j.software.length === 0, "A: certificado cargado y sin software aún", JSON.stringify(r.j));
ok(llamadas.slice(n).length >= 3 && llamadas.slice(n).every((l) => !l.cliente), "A: ninguna llamada lleva client_uuid (MATIAS lo rechazaría)");

// ── Registrar el software de la DIAN (validación y lo que recibe MATIAS)
const SW = { tipo: 1, identificacion: "96ab0f7c-2ab0-4de4-8c30-1268e6c8c6c3", pin: "12345", testsetid: "6142be76-4d36-5c08-8729-33a58c67177b" };
ok((await llamar("POST", `/api/admin/clientes/${A}/habilitacion`, { accion: "software", ...SW, pin: "12" }, adm)).s === 400, "PIN de menos de 5 dígitos: rechazado");
ok((await llamar("POST", `/api/admin/clientes/${A}/habilitacion`, { accion: "software", ...SW, testsetid: "no-es" }, adm)).s === 400, "TestSetId mal escrito: rechazado");
ok((await llamar("POST", `/api/admin/clientes/${A}/habilitacion`, { accion: "software", ...SW, tipo: 2 }, adm)).s === 400, "nómina (tipo 2) no se registra desde aquí");
r = await llamar("POST", `/api/admin/clientes/${A}/habilitacion`, { accion: "software", ...SW }, adm);
const reg = llamadas.filter((l) => l.metodo === "POST" && l.ruta === "/software").at(-1);
const rec = reg ? JSON.parse(reg.cuerpo.records) : {};
ok(r.s === 200 && r.j.software === 27, "software registrado", `${r.s} ${r.j.error ?? ""}`);
ok(!reg?.cliente && rec.type_id === 1 && rec.environment_id === 2 && rec.integration_type === 1 && rec.pin === "12345" && rec.identification === SW.identificacion && rec.testsetid === SW.testsetid, "MATIAS recibe records como texto JSON: tipo 1, pruebas, software propio, PIN, ID y TestSetId", JSON.stringify(rec));
const ev = (await q(`select datos from admin_eventos where empresa_id = $1 and accion = 'matias_registrar_software'`, [A]))[0]?.datos;
ok(ev && !JSON.stringify(ev).includes("12345"), "la bitácora no guarda el PIN del software");
r = await llamar("POST", `/api/admin/clientes/${A}/habilitacion`, { accion: "software", ...SW }, adm);
ok(r.s === 400 && /mismo tipo/.test(r.j.error), "el mismo tipo dos veces: MATIAS lo rechaza y se muestra su mensaje", `${r.s} ${r.j.error}`);

// ── Set de pruebas
ok((await llamar("POST", `/api/admin/clientes/${A}/habilitacion`, { accion: "pruebas", software: 999 }, adm)).s === 404, "set de pruebas de un software ajeno: 404");
n = llamadas.length;
r = await llamar("POST", `/api/admin/clientes/${A}/habilitacion`, { accion: "pruebas", software: 27 }, adm);
const rt = llamadas.slice(n).find((l) => l.ruta === "/document/run-test");
ok(r.s === 200 && rt?.cuerpo?.software_id === 27 && !rt.cliente, "set de pruebas iniciado con el software_id", `${r.s} ${r.j.error ?? r.j.mensaje}`);
r = await llamar("GET", `/api/admin/clientes/${A}/habilitacion`, undefined, adm);
ok(r.j.software?.[0]?.estado === "En ejecución" && !r.j.software[0].produccion, "el estado del set se ve en la consola", JSON.stringify(r.j.software));

// ── Antes de producción no sincroniza; al terminar el set (MATIAS lo pasa a producción) trae la numeración de la DIAN
r = await llamar("POST", `/api/admin/clientes/${A}/habilitacion`, { accion: "sincronizar", tipo: 1 }, adm);
ok(r.s === 200 && /aún no está en producción/.test(r.j.mensaje), "sin producción: avisa que no hay nada que sincronizar", r.j.mensaje);
Object.assign(de("principal").software[0], { environment_id: 1, test_process: { status: "FINISHED", status_description: "Finalizado", error_message: { string: "El proceso de habilitación ha sido finalizado con éxito." } } });
r = await llamar("GET", `/api/admin/clientes/${A}/habilitacion`, undefined, adm);
ok(r.j.software?.[0]?.produccion && r.j.software[0].estado === "Finalizado" && /finalizado con éxito/.test(r.j.software[0].detalle), "set terminado: el software sale en producción", JSON.stringify(r.j.software));
n = llamadas.length;
r = await llamar("POST", `/api/admin/clientes/${A}/habilitacion`, { accion: "sincronizar", tipo: 1 }, adm);
const nr = llamadas.slice(n).find((l) => l.ruta === "/numbering-range");
ok(r.s === 200 && /nuevas 1/.test(r.j.mensaje) && nr?.query.includes("type_id=1") && nr.query.includes("sync=1"), "trae la numeración autorizada de la DIAN", `${r.j.mensaje} ${nr?.query}`);
r = await llamar("GET", `/api/admin/clientes/${A}/habilitacion`, undefined, adm);
ok(r.j.resoluciones?.[0]?.numero === "18764112492320" && r.j.resoluciones[0].prefijo === "FGE", "la consola muestra las numeraciones que tiene MATIAS", JSON.stringify(r.j.resoluciones));

// ── B: con su UUID de cliente, todas las llamadas llevan client_uuid
r = await llamar("PATCH", `/api/admin/clientes/${Bx}`, { matias: { cliente: CLIENTE_B, resoluciones: [] } }, adm);
ok(r.s === 200, "B: conectado con su UUID de cliente", `${r.s} ${r.j.error ?? ""}`);
n = llamadas.length;
r = await llamar("GET", `/api/admin/clientes/${Bx}/habilitacion`, undefined, adm);
const deB = llamadas.slice(n).filter((l) => l.ruta !== "/company");
ok(r.s === 200 && !r.j.principal.es_este && r.j.certificado === null && deB.length === 3 && deB.every((l) => l.cliente === CLIENTE_B), "B: sin certificado y cada consulta con su client_uuid", JSON.stringify({ c: r.j.certificado, q: deB.map((l) => l.query) }));
r = await llamar("POST", `/api/admin/clientes/${Bx}/habilitacion`, { accion: "pruebas", software: 27 }, adm);
ok(r.s === 404, "B no lanza el set de pruebas del software de A", String(r.s));

// ── Cliente sin conectar: no registra software
const C = randomUUID();
await q(`insert into empresas (id, nit, dv, razon_social, plan) values ($1, $2, '1', 'DROGUERIA C SAS', 'esencial')`, [C, "6" + suf.padStart(8, "0").slice(-8)]);
r = await llamar("POST", `/api/admin/clientes/${C}/habilitacion`, { accion: "software", ...SW }, adm);
ok(r.s === 409 && /Primero conecta/.test(r.j.error), "un cliente sin conectar no registra software", `${r.s} ${r.j.error}`);

// ── La pantalla de la consola
const html = (await (await fetch(`${B}/admin/clientes/${A}`, { headers: { cookie: adm } })).text());
ok(/Habilitación DIAN en MATIAS/.test(html), "la ficha del cliente tiene la sección de habilitación");

await q(`delete from admin_eventos where empresa_id = any($1)`, [[A, Bx, C]]).catch(() => {});
await q(`delete from resoluciones_dian where empresa_id = any($1)`, [[A, Bx, C]]);
await q(`delete from empresas where id = any($1)`, [[A, Bx, C]]).catch((e) => console.log("limpieza:", e.message));
srv.close(); await pool.end();
console.log(`\n${fallos} fallos`);
process.exit(fallos ? 1 : 0);
