// Correcciones de la auditoría integral (17/11/2026) que se prueban por HTTP:
//   AUD-03 · el pago manual de la consola enviado dos veces no suma dos periodos.
//   AUD-04 · el vendedor no entra por URL a inventario, productos ni alertas, ni descarga el Excel del inventario.
//   AUD-05 · la cajera no reemplaza el correo de un cliente que ya lo tiene (desviaba sus facturas electrónicas).
// Uso: servidor con la base sembrada (REGENTA_DEMO=1) → BASE=… DATABASE_URL=… REGENTA_SESSION_SECRET=… node tests/e2e/correcciones-auditoria.mjs
import pg from "pg";
import { execFileSync } from "node:child_process";
import { SignJWT } from "jose";
import { codigoTotp, TOTP } from "../ayudas/totp.mjs";

const B = process.env.BASE ?? "http://localhost:4540";
const DB = process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/regenta?host=/tmp";
const pool = new pg.Pool({ connectionString: DB });
const q = (s, v = []) => pool.query(s, v).then((r) => r.rows);
let fallos = 0;
const ok = (c, m, x = "") => { console.log(`${c ? "PASS" : "FAIL"} ${m}${x ? " — " + x : ""}`); if (!c) fallos++; };
const IP = `10.81.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
async function llamar(metodo, ruta, cuerpo, cookie) {
  const r = await fetch(B + ruta, { method: metodo, redirect: "manual", headers: { origin: B, "x-real-ip": IP, "content-type": "application/json", ...(cookie ? { cookie } : {}) }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
  const tipo = r.headers.get("content-type") ?? "";
  return { s: r.status, j: tipo.includes("json") ? await r.json().catch(() => ({})) : {}, loc: r.headers.get("location") ?? "", cookie: (r.headers.get("set-cookie") ?? "").split(";")[0] };
}
const sesion = async (uid, empresa, nombre, rol) => "regenta_sesion=" + await new SignJWT({ uid, empresa, nombre, rol, v: 0 }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h")
  .sign(new TextEncoder().encode(process.env.REGENTA_SESSION_SECRET ?? "prueba-local-0123456789abcdef0123456789abcdef"));

// ── AUD-03 · pago manual idempotente (droguería VECINA, no demo)
{
  const E = "10000000-0000-4000-8000-00000000000b";
  const suf = Date.now().toString().slice(-7);
  const ADMIN = `admin${suf}@correcciones.test`;
  execFileSync("node", ["scripts/crear-superadmin.mjs", ADMIN, "Admin Correcciones"], { env: { ...process.env, REGENTA_CLAVE_PRUEBA: "ConsolaCorr2026", REGENTA_TOTP_PRUEBA: TOTP, DATABASE_URL: DB } });
  const adm = (await llamar("POST", "/api/acceso", { email: ADMIN, clave: "ConsolaCorr2026", consola: true, codigo: codigoTotp() })).cookie;
  ok(adm.startsWith("regenta_admin="), "la consola entra");
  const antes = Number((await q(`select count(*) n from pagos_suscripcion where empresa_id = $1 and proveedor = 'manual'`, [E]))[0].n);
  const pago = { plan: "esencial", periodo: "mes", monto: 89900, medio: "Transferencia", soporte: `TRX-${suf}`, idem_key: crypto.randomUUID() };
  const [a, b] = await Promise.all([llamar("POST", `/api/admin/clientes/${E}/pagos`, pago, adm), llamar("POST", `/api/admin/clientes/${E}/pagos`, pago, adm)]);
  const despues = Number((await q(`select count(*) n from pagos_suscripcion where empresa_id = $1 and proveedor = 'manual'`, [E]))[0].n);
  ok([a.s, b.s].every((s) => s === 200 || s === 201) && despues - antes === 1, "el mismo pago enviado dos veces a la vez se registra UNA vez", `${a.s}/${b.s} · ${despues - antes} pagos`);
  ok([a.j, b.j].some((j) => j.repetido === true), "el segundo envío responde que ya estaba", JSON.stringify([a.j.mensaje, b.j.mensaje]));
  const sinIdem = { ...pago, idem_key: undefined, soporte: `TRX2-${suf}` };
  await llamar("POST", `/api/admin/clientes/${E}/pagos`, sinIdem, adm);
  const r2 = await llamar("POST", `/api/admin/clientes/${E}/pagos`, sinIdem, adm);
  ok(r2.j.repetido === true, "sin idem_key, el mismo pago repetido en 2 minutos tampoco se duplica", JSON.stringify(r2.j));
  const otro = await llamar("POST", `/api/admin/clientes/${E}/pagos`, { ...pago, idem_key: crypto.randomUUID(), soporte: `TRX3-${suf}` }, adm);
  ok(otro.s === 201 && !otro.j.repetido, "un pago distinto sí se registra", `${otro.s}`);
}

// ── AUD-04 · el vendedor no ve inventario por URL ni descarga el Excel
{
  const emp = (await q(`select id from empresas where demo limit 1`))[0].id;
  const VEND = "00000000-0000-4000-8000-0000000000e7";
  await q(`insert into miembros (empresa_id, user_id, nombre, rol) values ($1, $2, 'Vendedor correcciones', 'vendedor') on conflict (empresa_id, user_id) do update set activo = true, rol = 'vendedor'`, [emp, VEND]);
  const cv = await sesion(VEND, emp, "Vendedor correcciones", "vendedor");
  for (const ruta of ["/inventario", "/productos", "/alertas"]) {
    // Next responde 307 o, si la página ya empezó a transmitirse, 200 con la redirección en el flujo (NEXT_REDIRECT).
    const r = await fetch(B + ruta, { redirect: "manual", headers: { cookie: cv } });
    const cuerpo = await r.text();
    ok((r.status >= 300 && r.status < 400 && /\/inicio\?aviso=permiso/.test(r.headers.get("location") ?? ""))
      || (r.status === 200 && /NEXT_REDIRECT/.test(cuerpo) && /\/inicio\?aviso=permiso/.test(cuerpo) && !/data-saldo|<table/.test(cuerpo)), `el vendedor no entra a ${ruta}`, `${r.status}`);
  }
  const x = await llamar("GET", "/api/inventario/exportar", undefined, cv);
  ok(x.s === 403, "el vendedor no descarga el Excel del inventario", String(x.s));
  const cc = await sesion("00000000-0000-4000-8000-000000000002", emp, "Laura", "cajero");
  ok((await llamar("GET", "/api/inventario/exportar", undefined, cc)).s === 200, "la cajera sí lo descarga (sin costos)");
}

// ── AUD-05 · la cajera no reemplaza el correo de un cliente que ya lo tiene
{
  const emp = (await q(`select id from empresas where demo limit 1`))[0].id;
  const doc = "7" + Date.now().toString().slice(-8);
  await q(`insert into clientes (empresa_id, tipo_doc, numero_doc, nombre, email, telefono) values ($1, 'CC', $2, 'Cliente con correo', 'cliente@ejemplo.co', '3000000000')`, [emp, doc]);
  const cc = await sesion("00000000-0000-4000-8000-000000000002", emp, "Laura", "cajero");
  const r = await llamar("POST", "/api/clientes", { tipo_doc: "CC", numero_doc: doc, nombre: "Cliente con correo", email: "otro@desviado.co", telefono: "3119999999", autoriza_datos: true }, cc);
  const fila = (await q(`select email, telefono from clientes where empresa_id = $1 and numero_doc = $2`, [emp, doc]))[0];
  ok(r.s === 201 && fila.email === "cliente@ejemplo.co" && fila.telefono === "3000000000", "la cajera no reemplaza correo ni teléfono existentes", `${r.s} ${JSON.stringify(fila)}`);
  const doc2 = "8" + Date.now().toString().slice(-8);
  await q(`insert into clientes (empresa_id, tipo_doc, numero_doc, nombre) values ($1, 'CC', $2, 'Cliente sin correo')`, [emp, doc2]);
  await llamar("POST", "/api/clientes", { tipo_doc: "CC", numero_doc: doc2, nombre: "Cliente sin correo", email: "nuevo@cliente.co", telefono: "", autoriza_datos: true }, cc);
  ok((await q(`select email from clientes where empresa_id = $1 and numero_doc = $2`, [emp, doc2]))[0].email === "nuevo@cliente.co", "pero sí completa el correo que faltaba");
  const cd = await sesion("00000000-0000-4000-8000-000000000001", emp, "Carlos", "dueno");
  await llamar("POST", "/api/clientes", { tipo_doc: "CC", numero_doc: doc, nombre: "Cliente con correo", email: "nuevo@dueno.co", telefono: "", autoriza_datos: true }, cd);
  ok((await q(`select email from clientes where empresa_id = $1 and numero_doc = $2`, [emp, doc]))[0].email === "nuevo@dueno.co", "el dueño sí lo cambia");
}

await pool.end();
console.log(fallos ? `\n${fallos} fallo(s)` : "\nTodo en verde");
process.exit(fallos ? 1 : 0);
