// Control especial · migración 048 en la base: fichas, configuración e informes presentados. Solo dueño y administrador
// leen y escriben; cada droguería ve solo lo suyo; los informes no se editan ni se borran; la demo no guarda; la migración
// se puede aplicar de nuevo sin error. Todo dentro de transacciones que se deshacen.
// Uso: node scripts/db-reset.mjs && node --test tests/anexo13-db.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import pg from "pg";

const url = process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/regenta?host=/tmp";
const pool = new pg.Pool({ connectionString: url });
const U = { carlos: "00000000-0000-4000-8000-000000000001", cajera: "00000000-0000-4000-8000-000000000002", duenoB: "00000000-0000-4000-8000-000000000004", nadie: "00000000-0000-4000-8000-0000000000ff" };
const E = { A: "10000000-0000-4000-8000-00000000000a", B: "10000000-0000-4000-8000-00000000000b" };

/** fn como el usuario indicado (rol authenticated + claims), en una transacción que se deshace. `prep` corre antes como
 *  superusuario dentro de la misma transacción (datos de prueba que no quedan). */
async function como(uid, fn, prep) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    const datos = prep ? await prep(c) : undefined;
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })]);
    await c.query("set local role authenticated");
    return await fn(c, datos);
  } finally { await c.query("rollback").catch(() => {}); c.release(); }
}
/** Un producto de control especial en la droguería B (no es demo, así que guarda). */
const prodB = async (c) => (await c.query(`insert into productos (empresa_id, nombre, iva, unidades_por_caja, precio_caja, control_especial, requiere_formula)
  values ($1, 'Prueba control 048', 0, 10, 10000, true, true) returning id`, [E.B])).rows[0].id;
const mesPasado = () => { const d = new Date(); d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - 1); return d.toISOString().slice(0, 7) + "-01"; };
const mesActual = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" }).slice(0, 8) + "01";
const ficha = { principio_activo: "Acetaminofén + codeína", concentracion: "325 mg + 30 mg", forma_farmaceutica: "Tableta", cum: "19912345-01", categoria: "Medicamento de control especial de uso humano" };

let prodA;
before(async () => {
  prodA = (await pool.query(`select id from productos where empresa_id = $1 and control_especial limit 1`, [E.A])).rows[0]?.id;
  assert.ok(prodA, "la demo trae un producto de control especial");
});
after(() => pool.end());

test("la migración 048 se puede aplicar otra vez sin error ni cambios de datos", async () => {
  const c = await pool.connect();
  try {
    await c.query("begin");
    const antes = (await c.query(`select (select count(*) from control_fichas) + (select count(*) from control_config) + (select count(*) from control_informes) n`)).rows[0].n;
    await c.query(readFileSync(new URL("../db/migrations/048_anexo13.sql", import.meta.url), "utf8"));
    const despues = (await c.query(`select (select count(*) from control_fichas) + (select count(*) from control_config) + (select count(*) from control_informes) n`)).rows[0].n;
    assert.equal(despues, antes);
  } finally { await c.query("rollback"); c.release(); }
});

test("el dueño guarda la ficha; queda en la auditoría y la lee", async () => {
  const r = await como(U.duenoB, async (c, id) => {
    await c.query(`select guardar_ficha_control($1, $2)`, [id, { ...ficha, cum: "19912345-01 " }]);
    await c.query(`select guardar_ficha_control($1, $2)`, [id, { ...ficha, concentracion: "500 mg + 30 mg" }]); // actualizar
    return {
      f: (await c.query(`select principio_activo, concentracion, cum, categoria from control_fichas where producto_id = $1`, [id])).rows,
      a: (await c.query(`select count(*)::int n from auditoria where entidad_id = $1 and accion = 'ficha_control'`, [id])).rows[0].n,
    };
  }, prodB);
  assert.deepEqual(r.f, [{ principio_activo: "Acetaminofén + codeína", concentracion: "500 mg + 30 mg", cum: "19912345-01", categoria: ficha.categoria }]);
  assert.equal(r.a, 2);
});

test("CUM mal escrito se rechaza con un mensaje claro", async () => {
  await assert.rejects(como(U.duenoB, (c, id) => c.query(`select guardar_ficha_control($1, $2)`, [id, { ...ficha, cum: "1-2-3" }]), prodB), /CUM va como expediente-consecutivo/);
});

test("la cajera no escribe ni lee fichas, configuración ni informes", async () => {
  await assert.rejects(como(U.cajera, (c) => c.query(`select guardar_ficha_control($1, $2)`, [prodA, ficha])), /dueño o el administrador/);
  await assert.rejects(como(U.cajera, (c) => c.query(`select configurar_anexo13($1, '{}')`, [E.A])), /dueño o el administrador/);
  const n = await como(U.cajera, async (c) => (await c.query(`select (select count(*) from control_fichas) + (select count(*) from control_config) + (select count(*) from control_informes) n`)).rows[0].n, async (c) => {
    await c.query(`insert into control_fichas (producto_id, empresa_id, principio_activo) values ($1, $2, 'Codeína') on conflict do nothing`, [prodA, E.A]);
  });
  assert.equal(Number(n), 0);
});

test("una droguería no ve ni toca lo de otra", async () => {
  await assert.rejects(como(U.duenoB, (c) => c.query(`select guardar_ficha_control($1, $2)`, [prodA, ficha])), /dueño o el administrador/);
  await assert.rejects(como(U.duenoB, (c) => c.query(`select configurar_anexo13($1, '{}')`, [E.A])), /dueño o el administrador/);
  const vistos = await como(U.duenoB, async (c) => (await c.query(`select count(*)::int n from control_fichas where empresa_id = $1`, [E.A])).rows[0].n, async (c) => {
    await c.query(`insert into control_fichas (producto_id, empresa_id, principio_activo) values ($1, $2, 'Codeína') on conflict do nothing`, [prodA, E.A]);
  });
  assert.equal(vistos, 0);
  await assert.rejects(como(U.nadie, (c) => c.query(`select guardar_ficha_control($1, $2)`, [prodA, ficha])), /dueño o el administrador/);
});

test("la demostración muestra pero no guarda", async () => {
  await assert.rejects(como(U.carlos, (c) => c.query(`select guardar_ficha_control($1, $2)`, [prodA, ficha])), /demostración/);
  await assert.rejects(como(U.carlos, (c) => c.query(`select registrar_informe_anexo13($1, null, $2::date, $3)`, [E.A, mesPasado(), { presentado: mesActual(), canal: "correo", totales: {} }])), /demostración/);
});

test("configuración: guarda departamento, fondo y plantilla; plantilla inválida se rechaza", async () => {
  const r = await como(U.duenoB, async (c) => {
    await c.query(`select configurar_anexo13($1, $2)`, [E.B, { departamento: "Tolima", fondo: "Fondo Rotatorio de Estupefacientes del Tolima", canal: "correo",
      destino: "fondo@ejemplo.gov.co", responsable: "  Ana   Regente ", responsable_registro: "rf-123", plantilla: [{ campo: "cum", titulo: "CUM" }] }]);
    return (await c.query(`select departamento, canal, responsable, responsable_registro, plantilla from control_config where empresa_id = $1`, [E.B])).rows[0];
  });
  assert.deepEqual(r, { departamento: "Tolima", canal: "correo", responsable: "Ana Regente", responsable_registro: "RF-123", plantilla: [{ campo: "cum", titulo: "CUM" }] });
  await assert.rejects(como(U.duenoB, (c) => c.query(`select configurar_anexo13($1, $2)`, [E.B, { plantilla: [] }])), /entre 1 y 40 columnas/);
  await assert.rejects(como(U.duenoB, (c) => c.query(`select configurar_anexo13($1, $2)`, [E.B, { canal: "fax" }])), /canal/);
});

test("informe presentado: solo meses cerrados; la corrección reemplaza; no se edita ni se borra", async () => {
  await assert.rejects(como(U.duenoB, (c) => c.query(`select registrar_informe_anexo13($1, null, $2::date, $3)`, [E.B, mesActual(), { presentado: mesActual(), canal: "correo", totales: {} }])), /mes que ya terminó/);
  await assert.rejects(como(U.duenoB, (c) => c.query(`select registrar_informe_anexo13($1, null, $2::date, $3)`, [E.B, mesPasado(), { presentado: "2020-01-01", canal: "correo", totales: {} }])), /entre el mes informado y hoy/);
  const r = await como(U.duenoB, async (c) => {
    const p = { presentado: mesActual(), canal: "correo", radicado: "FRE-1", totales: { productos: 1, final: 10 } };
    const a = (await c.query(`select registrar_informe_anexo13($1, null, $2::date, $3) id`, [E.B, mesPasado(), p])).rows[0].id;
    const b = (await c.query(`select registrar_informe_anexo13($1, null, $2::date, $3) id`, [E.B, mesPasado(), { ...p, radicado: "FRE-2" }])).rows[0].id;
    const filas = (await c.query(`select id, reemplaza, radicado from control_informes where empresa_id = $1 order by id`, [E.B])).rows;
    let edita = null, borra = null;
    await c.query("savepoint s1");
    try { await c.query(`update control_informes set radicado = 'X' where id = $1`, [a]); } catch (e) { edita = e.message; }
    await c.query("rollback to savepoint s1");
    try { await c.query(`delete from control_informes where id = $1`, [a]); } catch (e) { borra = e.message; }
    return { a, b, filas, edita, borra };
  });
  assert.deepEqual(r.filas.map((f) => [f.radicado, f.reemplaza]), [["FRE-1", null], ["FRE-2", r.a]]);
  assert.ok(r.edita, "no se puede editar"); assert.ok(r.borra, "no se puede borrar");
  // Ni siquiera el superusuario: el disparador lo impide.
  const c = await pool.connect();
  try {
    await c.query("begin");
    const id = (await c.query(`insert into control_informes (empresa_id, periodo, presentado, canal, totales, usuario_id) values ($1, $2::date, current_date, 'correo', '{}', $3) returning id`, [E.B, mesPasado(), U.duenoB])).rows[0].id;
    await assert.rejects(c.query(`update control_informes set radicado = 'X' where id = $1`, [id]), /no se modifican ni se borran/);
  } finally { await c.query("rollback"); c.release(); }
});

test("la sede del informe debe ser de la misma droguería", async () => {
  const sedeA = (await pool.query(`select id from sedes where empresa_id = $1 limit 1`, [E.A])).rows[0].id;
  await assert.rejects(como(U.duenoB, (c) => c.query(`select registrar_informe_anexo13($1, $2, $3::date, $4)`, [E.B, sedeA, mesPasado(), { presentado: mesActual(), canal: "correo", totales: {} }])), /sede no es de esta droguería/);
});
