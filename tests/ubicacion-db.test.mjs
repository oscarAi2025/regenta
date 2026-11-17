// Ubicación del producto (migración 050): la cambian dueño, administrador y bodega; la cajera no; otra droguería no;
// se guarda limpia en mayúscula, vacío la quita, queda en la auditoría y la migración se puede aplicar otra vez.
// Uso: node scripts/db-reset.mjs && node --test tests/ubicacion-db.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/regenta?host=/tmp" });
const U = { carlos: "00000000-0000-4000-8000-000000000001", cajera: "00000000-0000-4000-8000-000000000002", bodega: "00000000-0000-4000-8000-000000000003", duenoB: "00000000-0000-4000-8000-000000000004" };
const E = { A: "10000000-0000-4000-8000-00000000000a" };
let prod;
before(async () => { prod = (await pool.query(`select id from productos where empresa_id = $1 and activo order by nombre limit 1`, [E.A])).rows[0].id; });
after(() => pool.end());

async function como(uid, fn) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })]);
    await c.query("set local role authenticated");
    return await fn(c);
  } finally { await c.query("rollback").catch(() => {}); c.release(); }
}
const cambiar = (c, u) => c.query(`select cambiar_ubicacion($1, $2) u`, [prod, u]).then((r) => r.rows[0].u);

test("la migración 050 se puede aplicar otra vez sin error", async () => {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query(readFileSync(new URL("../db/migrations/050_ubicacion.sql", import.meta.url), "utf8"));
  } finally { await c.query("rollback"); c.release(); }
});

test("la bodega pone la ubicación: limpia, en mayúscula y en la auditoría; vacío la quita", async () => {
  const r = await como(U.bodega, async (c) => {
    const a = await cambiar(c, "  e3 -   n2 ");
    const visto = (await c.query(`select ubicacion from productos where id = $1`, [prod])).rows[0].ubicacion;
    const b = await cambiar(c, "");
    await c.query("reset role");
    const aud = (await c.query(`select datos from auditoria where entidad_id = $1 and accion = 'ubicacion_producto' order by id`, [prod])).rows.map((x) => [x.datos.antes, x.datos.despues]);
    return { a, visto, b, aud };
  });
  assert.equal(r.a, "E3 - N2"); assert.equal(r.visto, "E3 - N2"); assert.equal(r.b, null);
  assert.deepEqual(r.aud, [[null, "E3 - N2"], ["E3 - N2", null]]);
});

test("el dueño también; repetir la misma ubicación no deja otra línea en la auditoría", async () => {
  const n = await como(U.carlos, async (c) => {
    await cambiar(c, "Nevera"); await cambiar(c, "NEVERA");
    await c.query("reset role");
    return (await c.query(`select count(*)::int n from auditoria where entidad_id = $1 and accion = 'ubicacion_producto'`, [prod])).rows[0].n;
  });
  assert.equal(n, 1);
});

test("la cajera y otra droguería no la cambian; más de 40 caracteres no entra", async () => {
  await assert.rejects(como(U.cajera, (c) => cambiar(c, "E1")), /dueño, el administrador o la bodega/);
  await assert.rejects(como(U.duenoB, (c) => cambiar(c, "E1")), /dueño, el administrador o la bodega/);
  await assert.rejects(como(U.bodega, (c) => cambiar(c, "X".repeat(41))), /hasta 40 caracteres/);
});
