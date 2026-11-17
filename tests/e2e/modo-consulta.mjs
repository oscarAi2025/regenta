// Modo consulta (cuenta suspendida por falta de pago) y renovación sin fricción, de punta a punta:
// el dueño y el administrador entran a /cuenta-suspendida (la cajera y las suspensiones manuales no); la sesión de consulta no
// abre ninguna otra pantalla ni API; descarga de XML (dueño y admin) y copia de datos (solo dueño); /contratar?renovar=1 llega
// con los datos puestos; el pago iniciado desde la sesión queda ligado a la droguería y, al aprobarse, la reactiva sola;
// «Continuar» cambia la sesión de consulta por una normal. También: el aviso del plan vencido dice cuándo se detiene la caja.
// Uso: servidor con las variables de Wompi de prueba (WOMPI_API_URL → :WOMPI_MOCK_PUERTO) → node tests/e2e/modo-consulta.mjs
import pg from "pg";
import { createHash, randomBytes, scrypt, randomUUID } from "node:crypto";
import { createServer } from "node:http";

const B = process.env.BASE ?? "http://localhost:4500";
const DB = process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/regenta?host=/tmp";
const pool = new pg.Pool({ connectionString: DB });
const q = (s, v = []) => pool.query(s, v).then((r) => r.rows);
let fallos = 0;
const ok = (c, m, x = "") => { console.log(`${c ? "PASS" : "FAIL"} ${m}${x ? " — " + x : ""}`); if (!c) fallos++; };
const IP = `10.88.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const suf = Date.now().toString().slice(-7);
const sha = (s) => createHash("sha256").update(s).digest("hex");
const hashClave = (clave) => new Promise((res) => { const sal = randomBytes(16); scrypt(clave.normalize("NFKC"), sal, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (e, k) => res(`${sal.toString("hex")}:${k.toString("hex")}`)); });

// API de Wompi simulada (el webhook confirma cada transacción contra ella).
const WOMPI = new Map();
const mock = createServer((req, res) => {
  const t = WOMPI.get(decodeURIComponent((req.url ?? "").split("/transactions/")[1] ?? ""));
  res.writeHead(t ? 200 : 404, { "content-type": "application/json" }).end(JSON.stringify(t ? { data: t } : { error: { type: "NOT_FOUND_ERROR" } }));
}).listen(Number(process.env.WOMPI_MOCK_PUERTO ?? 4602));
const evento = (t) => {
  const e = { event: "transaction.updated", data: { transaction: t }, signature: { properties: ["transaction.id", "transaction.status", "transaction.amount_in_cents"] }, timestamp: Math.floor(Date.now() / 1000) };
  e.signature.checksum = sha(`${t.id}${t.status}${t.amount_in_cents}${e.timestamp}test_events_prueba`);
  return e;
};

async function llamar(metodo, ruta, cuerpo, cookie) {
  const r = await fetch(B + ruta, { method: metodo, redirect: "manual", headers: { origin: B, "x-real-ip": IP, "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
  const buf = Buffer.from(await r.arrayBuffer()); let j = {}; try { j = JSON.parse(buf.toString()); } catch {}
  return { s: r.status, j, buf, tipo: r.headers.get("content-type") ?? "", ir: r.headers.get("location") ?? "", cookie: (r.headers.get("set-cookie") ?? "").split(";")[0] };
}
const pagina = async (ruta, cookie) => { const r = await fetch(B + ruta, { redirect: "manual", headers: cookie ? { cookie } : {} }); return { s: r.status, ir: r.headers.get("location") ?? "", html: (await r.text()).replace(/<!--.*?-->/g, "").replace(/&amp;/g, "&") }; };
const entrar = (email) => llamar("POST", "/api/acceso", { email, clave: CLAVE });

// ── Droguería suspendida por impago: dueño, administrador y cajera; un pago vencido y un documento con XML
const CLAVE = "Consulta2026x";
const emp = randomUUID(), sede = randomUUID();
const NIT = "9" + suf.padStart(8, "0").slice(-8);
const P = { dueno: [randomUUID(), `dueno${suf}@consulta.test`, "Dueña Consulta"], admin: [randomUUID(), `admin${suf}@consulta.test`, "Admin Consulta"], cajero: [randomUUID(), `cajera${suf}@consulta.test`, "Cajera Consulta"] };
await q(`insert into empresas (id, nit, dv, razon_social, nombre_comercial, plan, telefono) values ($1, $2, '7', 'DROGUERIA CONSULTA SAS', 'Droguería Consulta', 'esencial', '3109998877')`, [emp, NIT]);
await q(`insert into sedes (id, empresa_id, nombre) values ($1, $2, 'Principal')`, [sede, emp]);
await q(`insert into cajas (empresa_id, sede_id, nombre) values ($1, $2, 'Caja 1')`, [emp, sede]);
for (const [rol, [id, email, nombre]] of Object.entries(P)) {
  await q(`insert into cuentas (id, email, nombre, clave_hash) values ($1, $2, $3, $4)`, [id, email, nombre, await hashClave(CLAVE)]);
  await q(`insert into miembros (empresa_id, user_id, nombre, rol) values ($1, $2, $3, $4)`, [emp, id, nombre, rol]);
}
await q(`insert into pagos_suscripcion (referencia, plan, periodo, monto, proveedor, nombre, empresa, nit, email, telefono, estado, vence, empresa_id, atendido)
  values ($1, 'esencial', 'mes', 89900, 'manual', 'Dueña Consulta', 'Droguería Consulta', $2, $3, '3001112233', 'aprobado', current_date - 5, $4, true)`, [`RG-VIEJO-${suf}`, NIT, P.dueno[1], emp]);
await q(`insert into documentos_dian (empresa_id, tipo, prefijo, numero, estado, xml, creado) values ($1, 'nota_credito', 'CNS', 7, 'aceptado', '<Invoice>prueba-consulta</Invoice>', now() - interval '2 days')`, [emp]);

// Aviso del plan vencido (cuenta todavía activa): dice cuándo se detiene la caja y que los datos quedan en modo consulta
let r = await entrar(P.dueno[1]);
ok(r.s === 200 && r.j.destino === "/inicio", "cuenta activa con el plan vencido: el dueño entra normal", JSON.stringify(r.j));
await q(`update pagos_suscripcion set vence = current_date - 1 where empresa_id = $1`, [emp]);
let pg1 = await pagina("/inicio", r.cookie);
ok(/la caja se detiene y la cuenta pasa a modo consulta/.test(pg1.html) && /En 2 días/.test(pg1.html), "aviso: cuántos días faltan para que se detenga la caja y qué pasa con los datos");
ok(/contratar\?plan=esencial&renovar=1/.test(pg1.html), "aviso: «Renovar ahora» lleva a la renovación con los datos puestos");
const normal = r.cookie;

// ── Se suspende por impago
await q(`update empresas set estado = 'suspendida', suspension = 'impago' where id = $1`, [emp]);
ok((await pagina("/inicio", normal)).s !== 200 || !(await pagina("/inicio", normal)).html.includes("Droguería Consulta"), "la sesión normal anterior ya no abre la app");

r = await entrar(P.dueno[1]);
ok(r.s === 200 && r.j.destino === "/cuenta-suspendida" && r.cookie.startsWith("regenta_sesion="), "dueño: entra en modo consulta", JSON.stringify(r.j));
const dueno = r.cookie;
r = await entrar(P.admin[1]);
ok(r.s === 200 && r.j.destino === "/cuenta-suspendida", "administrador: entra en modo consulta");
const admin = r.cookie;
r = await entrar(P.cajero[1]);
ok(r.s === 403 && /avísale al dueño/.test(r.j.error ?? "") && !r.cookie, "cajera: no entra (avísale al dueño)", JSON.stringify(r.j));

// La sesión de consulta no abre nada más
for (const ruta of ["/inicio", "/caja", "/inventario", "/documentos"]) {
  const x = await pagina(ruta, dueno);
  ok(!/Droguería Consulta/.test(x.html) || x.s >= 300, `consulta: ${ruta} no abre`, String(x.s));
}
for (const [m, ruta, cuerpo] of [["GET", "/api/turnos"], ["GET", "/api/inventario/exportar"], ["POST", "/api/ventas", { idem_key: randomUUID(), lineas: [] }], ["GET", "/api/documentos/exportar"]]) {
  const x = await llamar(m, ruta, cuerpo, dueno);
  ok(x.s === 401 || x.s === 403 || x.s === 404, `consulta: ${m} ${ruta} rechazado`, String(x.s));
}

// Pantalla de la cuenta en pausa
let pag = await pagina("/cuenta-suspendida", dueno);
ok(pag.s === 200 && /Renovar ahora/.test(pag.html) && /renovar=1/.test(pag.html), "pantalla: «Renovar ahora» con los datos puestos");
ok(/Droguería Consulta/.test(pag.html) && /XML/.test(pag.html) && /copia/i.test(pag.html), "pantalla: nombre de la droguería, XML y copia de datos");
pag = await pagina("/cuenta-suspendida", admin);
ok(pag.s === 200 && /avísale al dueño/i.test(pag.html) && !/api\/consulta\/copia/.test(pag.html), "pantalla del administrador: avisar al dueño y sin copia completa");
pag = await pagina("/cuenta-suspendida");
ok(pag.s >= 300 || /NEXT_REDIRECT|entrar/.test(pag.html), "pantalla: sin sesión no abre");

// Descargas
const hoy = new Date(Date.now() - 5 * 3600e3).toISOString().slice(0, 10), antes = new Date(Date.now() - 10 * 86400e3).toISOString().slice(0, 10);
let x = await llamar("GET", `/api/consulta/xml?desde=${antes}&hasta=${hoy}`, undefined, dueno);
ok(x.s === 200 && x.tipo.includes("zip") && x.buf.includes(Buffer.from("nota_credito/CNS7.xml")), "XML: el dueño descarga el ZIP con sus documentos", String(x.s));
x = await llamar("GET", `/api/consulta/xml?desde=${antes}&hasta=${hoy}`, undefined, admin);
ok(x.s === 200 && x.tipo.includes("zip"), "XML: el administrador también");
x = await llamar("GET", `/api/consulta/xml?desde=2020-01-01&hasta=2020-01-31`, undefined, dueno);
ok(x.s === 404, "XML: rango sin documentos → 404 con mensaje", x.j.error);
x = await llamar("GET", `/api/consulta/copia`, undefined, dueno);
ok(x.s === 200 && x.tipo.includes("zip") && x.buf.length > 100, "copia: el dueño descarga sus datos", String(x.s));
x = await llamar("GET", `/api/consulta/copia`, undefined, admin);
ok(x.s === 403, "copia: el administrador no");
x = await llamar("GET", `/api/consulta/xml?desde=${antes}&hasta=${hoy}`, undefined, normal);
ok(x.s === 401, "XML: una sesión normal no sirve para la descarga de consulta");

// Renovación: formulario con los datos puestos
pag = await pagina("/contratar?plan=esencial&renovar=1", dueno);
ok(/Renovar Droguería Consulta/.test(pag.html), "renovar: título con la droguería");
ok(pag.html.includes(P.dueno[1]) && pag.html.includes(`${NIT}-7`) && pag.html.includes("3001112233"), "renovar: correo, NIT y el último celular ya puestos");
pag = await pagina("/contratar?plan=esencial&renovar=1", admin);
ok(!/Renovar Droguería Consulta/.test(pag.html) && !pag.html.includes(P.dueno[1]), "renovar: al administrador no se le llenan los datos del dueño");
pag = await pagina("/contratar?plan=esencial&renovar=1");
ok(/Contrata Regenta en dos minutos/.test(pag.html), "renovar sin sesión: formulario normal y vacío");

// Pago iniciado desde la sesión de consulta: queda ligado a la droguería aunque el correo sea otro
const datos = { plan: "esencial", periodo: "mes", proveedor: "wompi", nombre: "Dueña Consulta", empresa: "Droguería Consulta", nit: `${NIT}-7`, email: `otro${suf}@consulta.test`, telefono: "3001112233", acepta: true };
x = await llamar("POST", "/api/pagos", datos, dueno);
ok(x.s === 201 && x.j.referencia, "renovar: orden de pago creada", JSON.stringify(x.j));
const ref = x.j.referencia;
let fila = (await q(`select empresa_id, atendido from pagos_suscripcion where referencia = $1`, [ref]))[0];
ok(fila?.empresa_id === emp && !fila.atendido, "renovar: la orden queda ligada a la droguería (no a «revisar»)", JSON.stringify(fila));
x = await llamar("POST", "/api/pagos", { ...datos, nit: "800123456" }, dueno);
fila = (await q(`select empresa_id from pagos_suscripcion where referencia = $1`, [x.j.referencia]))[0];
ok(x.s === 201 && fila?.empresa_id === null, "renovar: con otro NIT no se liga (se revisa a mano)");
x = await llamar("POST", "/api/pagos", datos, admin);
fila = (await q(`select empresa_id from pagos_suscripcion where referencia = $1`, [x.j.referencia]))[0];
ok(x.s === 201 && fila?.empresa_id === null, "renovar: el administrador no liga pagos (solo el dueño)");

// «Continuar» antes de pagar no entra
x = await llamar("GET", "/cuenta-suspendida/continuar", undefined, dueno);
ok(x.s === 303 && x.ir === "/cuenta-suspendida", "continuar: sin pagar vuelve a la cuenta en pausa", `${x.s} ${x.ir}`);

// Se aprueba el pago → la cuenta se reactiva sola y la orden queda atendida
const tx = { id: `555-${Date.now().toString(36)}-1`, reference: ref, status: "APPROVED", amount_in_cents: 89900 * 100, currency: "COP", payment_method_type: "NEQUI" };
WOMPI.set(tx.id, tx);
x = await llamar("POST", "/api/pagos/wompi", evento(tx));
ok(x.s === 200, "Wompi: pago aprobado", String(x.s));
const e = (await q(`select estado, suspension from empresas where id = $1`, [emp]))[0];
ok(e.estado === "activa" && e.suspension === null, "la cuenta se reactiva sola al aprobarse el pago", JSON.stringify(e));
fila = (await q(`select atendido, vence from pagos_suscripcion where referencia = $1`, [ref]))[0];
ok(fila.atendido && fila.vence, "la orden ligada queda atendida y con su vencimiento");

pag = await pagina("/cuenta-suspendida", dueno);
ok(/reactivada|Continuar/i.test(pag.html), "pantalla: avisa que la cuenta ya está activa");
x = await llamar("GET", "/cuenta-suspendida/continuar", undefined, dueno);
ok(x.s === 303 && x.ir === "/inicio" && x.cookie.startsWith("regenta_sesion="), "continuar: cambia a sesión normal", `${x.s} ${x.ir}`);
pag = await pagina("/inicio", x.cookie);
ok(pag.s === 200 && /Droguería Consulta/.test(pag.html), "con la sesión nueva la app abre");
x = await llamar("GET", "/api/turnos", undefined, dueno);
ok(x.s === 401 || x.s === 403, "la cookie de consulta sigue sin abrir la app");

// ── Suspensión manual: nadie entra en modo consulta
await q(`update empresas set estado = 'suspendida', suspension = 'manual' where id = $1`, [emp]).catch(async () => q(`update empresas set estado = 'suspendida', suspension = null where id = $1`, [emp]));
r = await entrar(P.dueno[1]);
ok(r.s === 403 && !r.cookie, "suspensión manual: el dueño no entra en modo consulta", JSON.stringify(r.j));
x = await llamar("GET", `/api/consulta/xml?desde=${antes}&hasta=${hoy}`, undefined, dueno);
ok(x.s === 401, "suspensión manual: la sesión de consulta anterior deja de servir");

// Limpieza
await q(`select eliminar_empresa_prueba($1)`, [emp]).catch(() => {});
mock.close(); await pool.end();
console.log(`\n${fallos ? `${fallos} fallos` : "Todo en verde"}`);
process.exit(fallos ? 1 : 0);
