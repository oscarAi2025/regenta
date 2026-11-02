// Operación automática (tarea programada): suscripción vencida → aviso en la gracia y suspensión después; numeración por
// vencer; documento rechazado por la DIAN → aviso al dueño. Uso: servidor en :4500 con REGENTA_CRON_KEY de pruebas.
import pg from "pg";

const B = process.env.BASE ?? "http://localhost:4500";
const CRON = process.env.REGENTA_CRON_KEY ?? "cron-prueba-0123456789abcdef0123456789";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/regenta?host=/tmp" });
let fallos = 0;
const ok = (c, m, x = "") => { console.log(`${c ? "PASS" : "FAIL"} ${m}${x ? " — " + x : ""}`); if (!c) fallos++; };
const sufijo = Date.now().toString().slice(-7);
const q = (s, v) => pool.query(s, v).then((r) => r.rows);

async function drogueria(n, venceHace) {
  const [e] = await q(`insert into empresas (nit, razon_social, nombre_comercial, plan) values ($1, $2, $2, 'esencial') returning id`, [`7${sufijo}${n}`, `Operación ${n} ${sufijo}`]);
  const [cu] = await q(`insert into cuentas (email, nombre) values ($1, 'Dueño ${n}') returning id`, [`op${n}.${sufijo}@prueba.example`]);
  await q(`insert into miembros (empresa_id, user_id, nombre, rol) values ($1, $2, 'Dueño', 'dueno')`, [e.id, cu.id]);
  await q(`insert into pagos_suscripcion (referencia, plan, periodo, monto, proveedor, nombre, empresa, email, telefono, estado, empresa_id, vence, atendido)
    values ($1, 'esencial', 'mes', 89900, 'qr', 'D', 'E', $2, '300', 'aprobado', $3, current_date - $4::int, true)`, [`RG-ES-OP${n}${sufijo}-ABCDEF12`, `op${n}.${sufijo}@prueba.example`, e.id, venceHace]);
  return { id: e.id, email: `op${n}.${sufijo}@prueba.example` };
}
const a = await drogueria(1, 1);   // en gracia
const b = await drogueria(2, 6);   // pasada la gracia
// Numeración de producción que vence en 5 días (en la droguería en gracia)
await q(`insert into resoluciones_dian (empresa_id, tipo, prefijo, desde, hasta, actual, pruebas, numero_resolucion, vigente_hasta) values ($1, 'pos', 'OP', 1, 1000, 10, false, '18760000001', current_date + 5)`, [a.id]);
const r = await fetch(`${B}/api/tareas?operacion=1`, { method: "POST", headers: { authorization: `Bearer ${CRON}` } });
const j = await r.json();
ok(r.status === 200 && !j.suscripciones?.error && !j.numeraciones?.error && !j.rechazos?.error, "la tarea corre los pasos de operación", JSON.stringify({ s: j.suscripciones, n: j.numeraciones, r: j.rechazos }));
const est = async (id) => (await q(`select estado from empresas where id = $1`, [id]))[0].estado;
ok(await est(a.id) === "activa", "en los días de gracia la cuenta sigue activa");
ok(await est(b.id) === "suspendida", "pasada la gracia la cuenta se suspende");
const correo = async (para, plantilla) => (await q(`select estado from correos where para = $1 and plantilla = $2`, [para, plantilla])).length;
ok(await correo(a.email, "cuenta_por_suspender") === 1, "aviso de suspensión próxima al dueño");
ok(await correo(b.email, "cuenta_suspendida") === 1, "aviso de cuenta suspendida al dueño");
ok(await correo(a.email, "resolucion_por_vencer") === 1, "aviso de numeración por vencer");
await fetch(`${B}/api/tareas?operacion=1`, { method: "POST", headers: { authorization: `Bearer ${CRON}` } });
ok(await correo(a.email, "cuenta_por_suspender") === 1 && await correo(a.email, "resolucion_por_vencer") === 1, "correr la tarea otra vez no repite avisos");
ok((await fetch(`${B}/api/tareas`, { method: "POST", headers: { authorization: "Bearer otra-clave-0123456789abcdefghij" } })).status === 401, "la tarea exige la clave");
ok((await fetch(`${B}/api/dian`, { method: "POST" })).status === 401, "la cola DIAN exige la clave");
await pool.end();
console.log(`\n${fallos} fallos`);
process.exit(fallos ? 1 : 0);
