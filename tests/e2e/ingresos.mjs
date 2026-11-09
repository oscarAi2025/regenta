// Ingresos y operación de punta a punta (revisión por tipo de usuario, puntos medios y bajos):
// pago manual y bajada de plan al vencer (con recorte de cajas), reembolso (suspende por impago) y entrada del dueño
// suspendido con «Renovar», documentos extra (cargo mensual, aviso al 90 %, consola), correo «habilitado» al pasar a
// producción, clientes de la droguería (corregir y quitar contacto), proveedores y costos por completar, Mi cuenta
// (cambiar contraseña cierra las otras sesiones), enlace vencido → enlace nuevo, reintento de correo con enlace nuevo,
// rol y correo desde la consola (nunca sin dueño).
// Uso: servidor en :4500 con REGENTA_SESSION_SECRET y REGENTA_CRON_KEY de pruebas → node tests/e2e/ingresos.mjs
import pg from "pg";
import { codigoTotp, TOTP } from "../ayudas/totp.mjs";
import { createHash, randomBytes, scrypt, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";

const B = process.env.BASE ?? "http://localhost:4500";
const DB = process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/regenta?host=/tmp";
const CRON = process.env.REGENTA_CRON_KEY ?? "cron-prueba-0123456789abcdef0123456789";
const pool = new pg.Pool({ connectionString: DB });
const q = (s, v = []) => pool.query(s, v).then((r) => r.rows);
let fallos = 0;
const ok = (c, m, x = "") => { console.log(`${c ? "PASS" : "FAIL"} ${m}${x ? " — " + x : ""}`); if (!c) fallos++; };
const IP = `10.66.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
const suf = Date.now().toString().slice(-7);
const hashClave = (clave) => new Promise((res) => { const sal = randomBytes(16); scrypt(clave.normalize("NFKC"), sal, 64, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }, (e, k) => res(`${sal.toString("hex")}:${k.toString("hex")}`)); });

async function llamar(metodo, ruta, cuerpo, cookie) {
  const r = await fetch(B + ruta, { method: metodo, redirect: "manual", headers: { origin: B, "x-real-ip": IP, "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
  const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch {}
  return { s: r.status, j, cookie: (r.headers.get("set-cookie") ?? "").split(";")[0] };
}
// HTML de una página tal como se lee (React separa trozos de texto con comentarios <!-- -->).
const pagina = async (ruta, cookie) => (await (await fetch(B + ruta, { headers: cookie ? { cookie } : {} })).text()).replace(/<!--.*?-->/g, "").replace(/&amp;/g, "&");
const entrar = async (email, clave, consola = false) => (await llamar("POST", "/api/acceso", { email, clave, consola, ...(consola ? { codigo: codigoTotp() } : {}) })).cookie;
const tarea = () => fetch(`${B}/api/tareas?operacion=1`, { method: "POST", headers: { authorization: `Bearer ${CRON}` } }).then((r) => r.json());
const correo = async (para, plantilla) => (await q(`select estado, datos from correos where lower(para) = lower($1) and plantilla = $2 order by id desc limit 1`, [para, plantilla]))[0];

// ── Droguería de prueba propia: empresa, sede, 3 cajas, dueño y cajera con contraseña
const CLAVE = "Ingresos2026x";
const emp = randomUUID(), sede = randomUUID(), dueno = randomUUID(), cajera = randomUUID();
const NIT = "8" + suf.padStart(8, "0").slice(-8);
const DUENO = `dueno${suf}@ingresos.test`, CAJERA = `cajera${suf}@ingresos.test`;
await q(`insert into empresas (id, nit, dv, razon_social, nombre_comercial, plan) values ($1, $2, '1', 'DROGUERIA INGRESOS SAS', 'Droguería Ingresos', 'esencial')`, [emp, NIT]);
await q(`insert into sedes (id, empresa_id, nombre) values ($1, $2, 'Principal')`, [sede, emp]);
for (const n of ["Caja 1", "Caja 2", "Caja 3"]) await q(`insert into cajas (empresa_id, sede_id, nombre) values ($1, $2, $3)`, [emp, sede, n]);
for (const [id, email, nombre, rol] of [[dueno, DUENO, "Dueña Ingresos", "dueno"], [cajera, CAJERA, "Cajera Ingresos", "cajero"]]) {
  await q(`insert into cuentas (id, email, nombre, clave_hash) values ($1, $2, $3, $4)`, [id, email, nombre, await hashClave(CLAVE)]);
  await q(`insert into miembros (empresa_id, user_id, nombre, rol) values ($1, $2, $3, $4)`, [emp, id, nombre, rol]);
}
for (const [tipo, prefijo] of [["pos", "IGP"], ["factura", "IGF"], ["nota_credito", "IGN"]])
  await q(`insert into resoluciones_dian (empresa_id, tipo, prefijo, desde, hasta, actual, pruebas) values ($1, $2, $3, 1, 1000000, 0, true)`, [emp, tipo, prefijo]);

// ── Consola
const ADMIN = `admin${suf}@ingresos.test`;
execFileSync("node", ["scripts/crear-superadmin.mjs", ADMIN, "Admin Ingresos"], { env: { ...process.env, REGENTA_CLAVE_PRUEBA: "ConsolaIngresos2026", REGENTA_TOTP_PRUEBA: TOTP, DATABASE_URL: DB } });
const adm = await entrar(ADMIN, "ConsolaIngresos2026", true);
ok(adm.startsWith("regenta_admin="), "la consola entra");

// ── Pago manual (transferencia): Pro mensual con su vencimiento y correo al dueño
let r = await llamar("POST", `/api/admin/clientes/${emp}/pagos`, { plan: "pro", periodo: "mes", monto: 139900, medio: "Transferencia", soporte: "TRX-1" }, adm);
ok(r.s === 201, "pago manual registrado", `${r.s} ${r.j.error ?? ""}`);
let e = (await q(`select plan, plan_siguiente from empresas where id = $1`, [emp]))[0];
const pro = (await q(`select referencia, vence from pagos_suscripcion where empresa_id = $1 and proveedor = 'manual' and plan = 'pro'`, [emp]))[0];
ok(e.plan === "pro" && !!pro?.vence, "pago manual: plan Pro y vencimiento", JSON.stringify(e));
ok((await correo(DUENO, "pago_aprobado"))?.estado === "simulado", "pago manual: correo de pago aprobado al dueño");
ok((await llamar("POST", `/api/admin/clientes/${emp}/pagos`, { plan: "pro", periodo: "mes", monto: 139900, medio: "Bitcoin" }, adm)).s === 400, "pago manual: medio no válido rechazado");
ok((await llamar("POST", `/api/admin/clientes/${emp}/pagos`, { plan: "pro", periodo: "mes", monto: 139900, medio: "Efectivo" })).s === 401, "pago manual: exige consola");

// ── Bajar a Esencial: no quita lo pagado de Pro; se aplica al vencer y recorta lo que no cabe
r = await llamar("POST", `/api/admin/clientes/${emp}/pagos`, { plan: "esencial", periodo: "mes", monto: 89900, medio: "Efectivo" }, adm);
e = (await q(`select plan, plan_siguiente from empresas where id = $1`, [emp]))[0];
ok(r.s === 201 && e.plan === "pro" && e.plan_siguiente === "esencial", "bajar de plan: sigue en Pro hasta el vencimiento y queda Esencial programado", JSON.stringify(e));
const dueno1 = await entrar(DUENO, CLAVE);
let pag = await pagina(`/equipo`, dueno1);
ok(/Pasas a Esencial al terminar lo pagado de Pro/.test(pag), "Mi droguería avisa la bajada programada");
await q(`update pagos_suscripcion set vence = current_date - 1 where referencia = $1`, [pro.referencia]);
const t1 = await tarea();
e = (await q(`select plan, plan_siguiente, (select count(*)::int from cajas where empresa_id = $1 and activa) cajas from empresas where id = $1`, [emp]))[0];
ok(e.plan === "esencial" && !e.plan_siguiente && e.cajas === 1, "al vencer Pro: pasa a Esencial y deja 1 caja activa", JSON.stringify({ e, t: t1.bajadas }));
ok((await correo(DUENO, "plan_cambiado"))?.datos?.cajas === 2, "correo de cambio de plan con lo desactivado");

// ── Documentos extra: cargo del mes anterior, aviso al 90 % del mes actual, consola y Mi droguería
await q(`update empresas set matias_cliente = '47a1257b-d8d6-428e-b28e-abddce5b8531' where id = $1`, [emp]);
r = await llamar("POST", `/api/admin/clientes/${emp}/numeraciones`, { tipo: "nota_credito", prefijo: "NCI", desde: 1, hasta: 100000, numero_resolucion: "18764000009999", vigente_hasta: "2030-12-31", pruebas: false }, adm);
ok(r.s === 201, "numeración de notas crédito en producción", `${r.s} ${r.j.error ?? ""}`);
ok(!(await correo(DUENO, "habilitado")), "sin ventas en producción aún no se avisa la habilitación");
r = await llamar("POST", `/api/admin/clientes/${emp}/numeraciones`, { tipo: "pos", prefijo: "POI", desde: 1, hasta: 100000, numero_resolucion: "18764000008888", vigente_hasta: "2030-12-31", pruebas: false }, adm);
ok(r.s === 201 && (await correo(DUENO, "habilitado"))?.estado === "simulado", "al quedar en producción le llega «Ya facturas ante la DIAN»", `${r.s} ${r.j.error ?? ""}`);
const mesPasado = (await q(`select date_trunc('month', (now() at time zone 'America/Bogota') - interval '1 month')::date m, date_trunc('month', now() at time zone 'America/Bogota')::date h`))[0];
await q(`insert into documentos_dian (empresa_id, tipo, prefijo, numero, estado, simulado, creado) select $1, 'pos', 'POI', g, 'aceptado', false, ($2::date + interval '3 days') at time zone 'America/Bogota' from generate_series(1, 2012) g`, [emp, mesPasado.m]);
await q(`insert into documentos_dian (empresa_id, tipo, prefijo, numero, estado, simulado, creado) select $1, 'pos', 'IGP', g, 'aceptado', false, ($2::date + interval '3 days') at time zone 'America/Bogota' from generate_series(1, 300) g`, [emp, mesPasado.m]); // de pruebas: no cuentan
await q(`insert into documentos_dian (empresa_id, tipo, prefijo, numero, estado, simulado, creado) select $1, 'pos', 'POI', 5000 + g, 'aceptado', false, now() from generate_series(1, 1850) g`, [emp]);
await tarea(); await tarea();
const cargo = await q(`select id, documentos, extra, monto::float, estado, referencia from cargos_documentos where empresa_id = $1`, [emp]);
ok(cargo.length === 1 && cargo[0].documentos === 2012 && cargo[0].extra === 12 && cargo[0].monto === 600, "documentos extra: un solo cargo por los 12 de más (los de pruebas no cuentan)", JSON.stringify(cargo));
const cd = await correo(DUENO, "cargo_documentos");
ok(cd?.estado === "simulado" && cd.datos.referencia === cargo[0]?.referencia, "documentos extra: correo con valor y referencia");
ok((await correo(DUENO, "cupo_documentos"))?.estado === "simulado", "aviso al 90 % del cupo del mes");
pag = await pagina(`/equipo`, dueno1);
ok(pag.includes(cargo[0]?.referencia) && /por pagar/.test(pag), "Mi droguería muestra el cargo por pagar");
pag = await pagina(`/inicio`, dueno1);
ok(/de documentos adicionales por pagar/.test(pag), "la app avisa el cargo pendiente");
const consolaPagos = await pagina(`/admin/pagos`, adm);
ok(consolaPagos.includes(cargo[0]?.referencia), "la consola lista el cargo");
ok((await llamar("PATCH", "/api/admin/cargos", { id: cargo[0].id, estado: "pagado" }, adm)).s === 200 && (await q(`select estado from cargos_documentos where id = $1`, [cargo[0].id]))[0].estado === "pagado", "la consola marca el cargo pagado");
ok((await llamar("PATCH", "/api/admin/cargos", { id: cargo[0].id, estado: "condonado" }, adm)).s === 409, "un cargo ya pagado no cambia");

// ── Clientes de la droguería: el dueño corrige y quita el contacto; la cajera no
const cli = (await q(`insert into clientes (empresa_id, tipo_doc, numero_doc, nombre, email, telefono, autoriza_datos) values ($1, 'CC', '1012345678', 'Cliente Mal Escrito', 'mal@correo', '300', true) returning id`, [emp]))[0].id;
r = await llamar("PATCH", `/api/clientes/${cli}`, { tipo_doc: "CC", numero_doc: "1012345679", nombre: "Cliente Bien Escrito", email: "bien@correo.co", telefono: "3001234567", autoriza_datos: true }, dueno1);
let c1 = (await q(`select numero_doc, nombre, email from clientes where id = $1`, [cli]))[0];
ok(r.s === 200 && c1.numero_doc === "1012345679" && c1.email === "bien@correo.co", "clientes: el dueño corrige documento y correo", `${r.s} ${r.j.error ?? ""}`);
ok((await llamar("PATCH", `/api/clientes/${cli}`, { quitar_contacto: true }, dueno1)).s === 200 && !(await q(`select email from clientes where id = $1`, [cli]))[0].email, "clientes: quitar sus datos de contacto");
const caj = await entrar(CAJERA, CLAVE);
ok((await llamar("PATCH", `/api/clientes/${cli}`, { quitar_contacto: true }, caj)).s === 403, "clientes: la cajera no corrige clientes");
ok((await pagina("/clientes", dueno1)).includes("Cliente Bien Escrito"), "página de clientes del dueño");

// ── Proveedores y costos por completar (la bodega recibe sin costo; el dueño lo pone después)
const prod = (await q(`insert into productos (empresa_id, nombre, unidades_por_caja, precio_caja, precio_unidad, iva) values ($1, 'Acetaminofén Ingresos 500 mg', 10, 10000, 1000, 0) returning id`, [emp]))[0].id;
r = await llamar("POST", "/api/inventario", { tipo: "compra", proveedor: "Distribuidora Ejemplo", factura: "FV-77", idem_key: randomUUID(), lineas: [{ producto_id: prod, lote: "L-ING", vence: "2030-01-31", unidades: 50 }] }, dueno1);
const mov = (await q(`select m.motivo, m.lote_id from movimientos m where m.empresa_id = $1 and m.tipo = 'compra' order by m.creado desc limit 1`, [emp]))[0];
ok(r.s === 201 && mov?.motivo === "Proveedor: Distribuidora Ejemplo · Factura: FV-77", "recibir: proveedor y factura en el movimiento", `${r.s} ${mov?.motivo}`);
await llamar("POST", "/api/inventario", { tipo: "compra", proveedor: "distribuidora ejemplo", idem_key: randomUUID(), lineas: [{ producto_id: prod, lote: "L-ING2", vence: "2030-02-28", unidades: 5 }] }, dueno1);
ok((await q(`select count(*)::int n from proveedores where empresa_id = $1`, [emp]))[0].n === 1, "recibir: el proveedor queda una sola vez en la lista");
pag = await pagina(`/inventario`, dueno1);
ok(/Costos por completar/.test(pag), "inventario muestra los costos por completar");
ok((await llamar("POST", "/api/inventario/costos", { lote_id: mov.lote_id, costo_unidad: 450 }, caj)).s === 403, "costos: la cajera no los pone");
ok((await llamar("POST", "/api/inventario/costos", { lote_id: mov.lote_id, costo_unidad: 450 }, dueno1)).s === 200 && Number((await q(`select costo_unidad from lote_costos where lote_id = $1`, [mov.lote_id]))[0]?.costo_unidad) === 450, "costos: el dueño completa el costo del lote");
ok((await llamar("POST", "/api/inventario/costos", { lote_id: mov.lote_id, costo_unidad: 1 }, dueno1)).s === 409, "costos: un costo puesto no se reescribe");

// ── Reembolso (garantía): el pago queda anulado, la cuenta se suspende por impago y el dueño ve «Renovar» al entrar
const pagos = await q(`select referencia from pagos_suscripcion where empresa_id = $1 and estado = 'aprobado'`, [emp]);
for (const p of pagos) await llamar("PATCH", "/api/admin/pagos", { referencia: p.referencia, reembolsar: "manual" }, adm);
e = (await q(`select estado, suspension from empresas where id = $1`, [emp]))[0];
ok(e.estado === "suspendida" && e.suspension === "impago", "reembolso: sin pago vigente la cuenta queda suspendida por impago", JSON.stringify(e));
ok((await correo(DUENO, "cuenta_suspendida"))?.datos?.impago == 1, "reembolso: correo de suspensión con «Renovar»");
r = await llamar("POST", "/api/acceso", { email: DUENO, clave: CLAVE });
ok(r.s === 403 && r.j.renovar?.startsWith("/contratar"), "el dueño suspendido por impago recibe el camino para renovar", JSON.stringify(r.j));
r = await llamar("POST", "/api/acceso", { email: CAJERA, clave: CLAVE });
ok(r.s === 403 && !r.j.renovar && /avísale al dueño/.test(r.j.error), "la cajera ve «avísale al dueño»");
ok((await llamar("PATCH", "/api/admin/pagos", { referencia: pagos[0].referencia, reembolsar: "manual" }, adm)).s === 409, "reembolso: no se devuelve dos veces");
r = await llamar("POST", `/api/admin/clientes/${emp}/pagos`, { plan: "esencial", periodo: "mes", monto: 89900, medio: "Consignación" }, adm);
ok((await q(`select estado from empresas where id = $1`, [emp]))[0].estado === "activa", "un pago nuevo reactiva la cuenta suspendida por impago");

// ── Mi cuenta: cambiar la contraseña cierra las otras sesiones; este equipo sigue
const otra = await entrar(DUENO, CLAVE);
ok((await llamar("POST", "/api/cuenta", { accion: "clave", actual: "mala-clave-1", nueva: "NuevaClave2026", repetir: "NuevaClave2026" }, otra)).s === 400, "mi cuenta: la contraseña actual se verifica");
r = await llamar("POST", "/api/cuenta", { accion: "clave", actual: CLAVE, nueva: "NuevaClave2026", repetir: "NuevaClave2026" }, otra);
ok(r.s === 200 && r.cookie.startsWith("regenta_sesion="), "mi cuenta: contraseña cambiada", `${r.s} ${r.j.error ?? ""}`);
ok((await llamar("GET", "/api/cajas", undefined, dueno1)).s === 401, "mi cuenta: la sesión del otro equipo se cerró");
ok((await llamar("GET", "/api/cajas", undefined, r.cookie)).s === 200, "mi cuenta: este equipo sigue dentro");
ok((await entrar(DUENO, "NuevaClave2026")).startsWith("regenta_sesion="), "mi cuenta: entra con la contraseña nueva");

// ── Enlace vencido → «Envíame un enlace nuevo» (al correo de la cuenta)
const token = randomBytes(24).toString("base64url");
await q(`insert into invitaciones (token_hash, cuenta_id, expira) values ($1, $2, now() - interval '1 day')`, [createHash("sha256").update(token).digest("hex"), cajera]);
const antes = (await q(`select count(*)::int n from correos where lower(para) = lower($1) and plantilla = 'restablecer'`, [CAJERA]))[0].n;
r = await llamar("POST", "/api/activar/nuevo", { token });
const despues = (await q(`select count(*)::int n from correos where lower(para) = lower($1) and plantilla = 'restablecer'`, [CAJERA]))[0].n;
ok(r.s === 200 && despues === antes + 1, "enlace vencido: llega uno nuevo al correo de la cuenta");
ok((await llamar("POST", "/api/activar/nuevo", { token: "x".repeat(30) })).s === 200, "enlace falso: misma respuesta (no delata cuentas)");
const pagAct = await pagina(`/activar?t=${token}`);
ok(/Envíame un enlace nuevo/.test(pagAct), "la página del enlace vencido ofrece pedir uno nuevo");

// ── Reintentar un correo de contraseña que falló: sale con un enlace nuevo
const idc = (await q(`insert into correos (clave, para, plantilla, tipo, datos, estado, error) values ($1, $2, 'invitacion', 'transaccional', '{"nombre":"Cajera"}', 'error', 'falló') returning id`, [`prueba-reintento:${suf}`, CAJERA]))[0].id;
r = await llamar("PATCH", "/api/admin/correos", { id: Number(idc), accion: "reintentar" }, adm);
const reint = (await q(`select estado from correos where id = $1`, [idc]))[0];
const inv = (await q(`select count(*)::int n from invitaciones where cuenta_id = $1 and usada is null and expira > now()`, [cajera]))[0].n;
ok(r.s === 200 && reint.estado === "simulado" && inv === 1, "reintento: el correo sale con un enlace nuevo vigente", JSON.stringify({ s: r.s, reint, inv }));

// ── Consola: rol y correo de un usuario (siempre queda un dueño)
ok((await llamar("PATCH", `/api/admin/clientes/${emp}/usuarios`, { cuenta_id: dueno, rol: "admin" }, adm)).s === 400, "consola: no deja la droguería sin dueño");
ok((await llamar("PATCH", `/api/admin/clientes/${emp}/usuarios`, { cuenta_id: cajera, rol: "admin" }, adm)).s === 200 && (await q(`select rol from miembros where user_id = $1`, [cajera]))[0].rol === "admin", "consola: cambia el rol");
ok((await llamar("PATCH", `/api/admin/clientes/${emp}/usuarios`, { cuenta_id: cajera, email: DUENO }, adm)).s === 400, "consola: no repite un correo de otra cuenta");
ok((await llamar("PATCH", `/api/admin/clientes/${emp}/usuarios`, { cuenta_id: cajera, email: `nueva${suf}@ingresos.test` }, adm)).s === 200 && (await q(`select email from cuentas where id = $1`, [cajera]))[0].email === `nueva${suf}@ingresos.test`, "consola: corrige el correo");

// ── Stripe cancela la renovación (cobros fallidos, banco o panel): el dueño recibe el aviso con hasta cuándo va su plan
const { createHmac } = await import("node:crypto");
const sub = `sub_ing${suf}`;
await q(`insert into pagos_suscripcion (referencia, plan, periodo, monto, proveedor, nombre, empresa, email, telefono, empresa_id, estado, suscripcion, vence)
  values ($1, 'esencial', 'mes', 89900, 'stripe', 'Dueña', 'Droguería Ingresos', $2, '300', $3, 'aprobado', $4, current_date + 20)`, [`RG-ESENCIAL-STR${suf}-AAAAAAAA`, DUENO, emp, sub]);
const ev = JSON.stringify({ id: "evt_del", type: "customer.subscription.deleted", data: { object: { id: sub } } });
const t = Math.floor(Date.now() / 1000);
await fetch(`${B}/api/pagos/stripe`, { method: "POST", headers: { "stripe-signature": `t=${t},v1=${createHmac("sha256", "whsec_prueba").update(`${t}.${ev}`).digest("hex")}` }, body: ev });
const rc = await correo(DUENO, "renovacion_cancelada");
ok(rc?.estado === "simulado" && !!rc.datos?.vence, "Stripe canceló la renovación: el dueño recibe el aviso con su fecha", JSON.stringify(rc?.datos));

await pool.end();
console.log(fallos ? `\n${fallos} fallo(s)` : "\n0 fallos");
process.exit(fallos ? 1 : 0);
