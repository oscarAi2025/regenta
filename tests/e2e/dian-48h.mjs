// DIAN · documento sin respuesta pasadas 48 horas (auditoría P1-3): ya no se marca «rechazado», sigue pendiente con
// reintento cada 6 horas, avisa al dueño y anular la venta exige nota crédito. También la migración 052 (devuelve a la
// cola los que la regla anterior dejó «rechazados» por plazo, sin tocar un rechazo real).
// Uso: servidor con REGENTA_DIAN=matias MATIAS_TOKEN=prueba-matias (MATIAS no hace falta: la droguería no está conectada,
//      lo que da un error «para reintentar», igual que una caída) y REGENTA_CRON_KEY → node tests/e2e/dian-48h.mjs
import pg from "pg";
import { readFileSync } from "node:fs";

const B = process.env.BASE ?? "http://localhost:4500";
const DB = process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/regenta?host=/tmp";
const CRON = process.env.REGENTA_CRON_KEY ?? "cron-prueba-0123456789abcdef0123456789";
const pool = new pg.Pool({ connectionString: DB });
const q = (s, v = []) => pool.query(s, v).then((r) => r.rows);
let fallos = 0;
const ok = (c, m, x = "") => { console.log(`${c ? "PASS" : "FAIL"} ${m}${x ? " — " + x : ""}`); if (!c) fallos++; };
const E = "10000000-0000-4000-8000-00000000000a", S = "20000000-0000-4000-8000-00000000000a", C = "30000000-0000-4000-8000-00000000000a";
const CARLOS = "00000000-0000-4000-8000-000000000001";

async function como(uid, sql, v) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })]);
    await c.query("set local role authenticated");
    const r = await c.query(sql, v);
    await c.query("commit");
    return r.rows;
  } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
}
const tareas = () => fetch(B + "/api/tareas?operacion=1", { method: "POST", headers: { authorization: `Bearer ${CRON}` } }).then(async (r) => ({ s: r.status, j: await r.json().catch(() => ({})) }));

// La demo pasa a ser una droguería «real» con numeración de producción mientras dura la prueba (se restaura al final).
const res = await q(`select id, tipo, pruebas, numero_resolucion from resoluciones_dian where empresa_id = $1 and tipo in ('pos', 'nota_credito') and activa`, [E]);
const matias = (await q(`select matias_cliente from empresas where id = $1`, [E]))[0].matias_cliente;
await q(`delete from incidencias_dian where empresa_id = $1`, [E]);
await q(`update empresas set demo = false, matias_cliente = null where id = $1`, [E]);
// Un dueño con correo para recibir los avisos (la demo no tiene cuentas con correo).
const DUENO = crypto.randomUUID(), CORREO = `dueno48h${Date.now()}@prueba.test`;
await q(`insert into cuentas (id, email, nombre, clave_hash) values ($1, $2, 'Dueño 48h', 'x:y')`, [DUENO, CORREO]);
await q(`insert into miembros (empresa_id, user_id, nombre, rol) values ($1, $2, 'Dueño 48h', 'dueno')`, [E, DUENO]);
for (const r of res) await q(`update resoluciones_dian set pruebas = false, numero_resolucion = coalesce(numero_resolucion, '18760000099999') where id = $1`, [r.id]);
try {
  const prod = (await q(`select p.id, p.precio_unidad from productos p where p.empresa_id = $1 and p.precio_unidad is not null and not p.requiere_formula
    and exists (select 1 from v_stock_lotes s where s.producto_id = p.id and s.unidades > 0) limit 1`, [E]))[0];
  const v = (await como(CARLOS, `select registrar_venta($1) r`, [{ empresa_id: E, sede_id: S, caja_id: C, idem_key: crypto.randomUUID(), tipo_doc: "pos",
    lineas: [{ producto_id: prod.id, presentacion: "unidad", cantidad: 1 }], pagos: [{ medio: "efectivo", valor: 1e7 }] }]))[0].r;
  const venta = v.venta_id ?? v.id ?? v;
  let doc = (await q(`select id, estado from documentos_dian where venta_id = $1 and tipo = 'pos'`, [venta]))[0];
  ok(doc?.estado === "pendiente", "venta POS con su documento en cola", JSON.stringify(v).slice(0, 120));

  // ── Antes de 48 h: un error «para reintentar» deja el documento pendiente con la espera corta
  await q(`update documentos_dian set proximo_intento = now() - interval '1 minute' where id = $1`, [doc.id]);
  let t = await tareas();
  doc = (await q(`select id, estado, ultimo_error, proximo_intento - now() < interval '1 hour' corto from documentos_dian where id = $1`, [doc.id]))[0];
  ok(t.s === 200 && doc.estado === "pendiente" && doc.corto && /conectar la droguería en MATIAS/.test(doc.ultimo_error ?? ""), "antes de 48 h: pendiente con reintento corto", `${t.s} ${doc.estado} ${doc.ultimo_error}`);

  // ── Pasadas 48 h sin respuesta: NO pasa a «rechazado»
  await q(`update documentos_dian set reenviado = now() - interval '49 hours', proximo_intento = now() - interval '1 minute' where id = $1`, [doc.id]);
  t = await tareas();
  doc = (await q(`select id, estado, ultimo_error, extract(epoch from proximo_intento - now()) / 3600 horas from documentos_dian where id = $1`, [doc.id]))[0];
  ok(doc.estado === "pendiente", "pasadas 48 h: sigue pendiente (no «rechazado»)", doc.estado);
  ok(/Más de 48 h sin respuesta/.test(doc.ultimo_error) && /No lo anules sin nota crédito/.test(doc.ultimo_error), "el motivo explica que no se anula sin nota crédito", doc.ultimo_error.slice(0, 90));
  ok(doc.horas > 5.5 && doc.horas <= 6.01, "se reintenta cada 6 horas", String(doc.horas));

  // Aviso al dueño (además del de 24 h) y en la consola
  const avisos = await q(`select plantilla, datos->>'error' error from correos where clave = 'demorado48:' || $1 || ':' || $2`, [doc.id, CORREO]);
  ok(avisos.length >= 1 && /No anules esa venta/.test(avisos[0].error), "el dueño recibe el aviso de las 48 h", String(avisos.length));
  t = await tareas();
  ok((await q(`select count(*)::int n from correos where clave like 'demorado48:' || $1 || ':%'`, [doc.id]))[0].n === avisos.length, "el aviso de 48 h no se repite en cada pasada");

  // ── Bitácora de contingencias (054): una caída del proveedor abre la incidencia «proveedor» de la droguería
  await q(`update empresas set matias_cliente = $2 where id = $1`, [E, crypto.randomUUID()]);
  await q(`update documentos_dian set proximo_intento = now() - interval '1 minute' where id = $1`, [doc.id]);
  await tareas();
  const inc = (await q(`select causa, fin, detalle from incidencias_dian where empresa_id = $1 and caja_id is null and fin is null`, [E]))[0];
  ok(inc?.causa === "proveedor" && !inc.fin, "proveedor sin respuesta: queda abierta la incidencia en la bitácora", JSON.stringify(inc));
  await tareas();
  ok(Number((await q(`select count(*) n from incidencias_dian where empresa_id = $1 and caja_id is null and fin is null`, [E]))[0].n) === 1, "una sola incidencia abierta por causa");
  await q(`update empresas set matias_cliente = null where id = $1`, [E]);

  // ── Anular la venta: con el documento sin respuesta sale nota crédito (no se descarta)
  await como(CARLOS, `select anular_venta($1, 'Prueba 48 h')`, [venta]);
  const tras = await q(`select tipo, estado from documentos_dian where venta_id = $1 order by tipo`, [venta]);
  ok(tras.some((d) => d.tipo === "nota_credito") && tras.find((d) => d.tipo === "pos")?.estado !== "anulado", "anular: genera nota crédito y no descarta el documento", JSON.stringify(tras));

  // ── Migración 052: devuelve a la cola los «rechazados» por plazo y no toca un rechazo real
  const [r1] = await q(`insert into documentos_dian (empresa_id, tipo, prefijo, numero, estado, ultimo_error) values ($1, 'nota_credito', 'NCT', 90001, 'rechazado', 'Sin respuesta tras 48 horas (7 intentos): revisar y reenviar') returning id`, [E]);
  const [r2] = await q(`insert into documentos_dian (empresa_id, tipo, prefijo, numero, estado, ultimo_error) values ($1, 'nota_credito', 'NCT', 90002, 'rechazado', 'Rechazo DIAN 99: NIT del adquirente inválido') returning id`, [E]);
  await q(readFileSync(new URL("../../db/migrations/052_dian_sin_respuesta.sql", import.meta.url), "utf8"));
  const m = Object.fromEntries((await q(`select id, estado from documentos_dian where id = any($1)`, [[r1.id, r2.id]])).map((x) => [x.id, x.estado]));
  ok(m[r1.id] === "pendiente", "052: el «rechazado» por plazo vuelve a la cola");
  ok(m[r2.id] === "rechazado", "052: un rechazo real de la DIAN no se toca");
  await q(readFileSync(new URL("../../db/migrations/052_dian_sin_respuesta.sql", import.meta.url), "utf8"));
  ok((await q(`select estado from documentos_dian where id = $1`, [r2.id]))[0].estado === "rechazado", "052 se puede aplicar otra vez sin cambios");
  await q(`delete from documentos_dian where id = any($1)`, [[r1.id, r2.id]]).catch(() => {});
} finally {
  await q(`delete from miembros where user_id = $1`, [DUENO]).catch(() => {}); await q(`delete from cuentas where id = $1`, [DUENO]).catch(() => {});
  for (const r of res) await q(`update resoluciones_dian set pruebas = $2, numero_resolucion = $3 where id = $1`, [r.id, r.pruebas, r.numero_resolucion]);
  await q(`update empresas set demo = true, matias_cliente = $2 where id = $1`, [E, matias]);
  // Lo que quedó en cola de la prueba no debe salir a ningún lado: se marca anulado.
  await q(`update documentos_dian set estado = 'anulado', ultimo_error = 'Prueba dian-48h' where empresa_id = $1 and estado in ('pendiente', 'enviando') and ultimo_error ~ 'MATIAS|48 h'`, [E]);
}
await pool.end();
console.log(`\n${fallos ? `${fallos} fallos` : "Todo en verde"}`);
process.exit(fallos ? 1 : 0);
