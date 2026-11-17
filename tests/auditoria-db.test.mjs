// Fallos encontrados en la auditoría integral (17/11/2026), cada uno con la prueba que lo demostró antes de corregirlo.
// Uso: base recién sembrada → node --test tests/auditoria-db.test.mjs
import { test, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

const url = process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/regenta?host=/tmp";
const pool = new pg.Pool({ connectionString: url });
const U = { carlos: "00000000-0000-4000-8000-000000000001", cajera: "00000000-0000-4000-8000-000000000002" };
const E = { A: "10000000-0000-4000-8000-00000000000a" };
const S = { A: "20000000-0000-4000-8000-00000000000a" };
const C = { A: "30000000-0000-4000-8000-00000000000a" };
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
const producto = async (c) => (await c.query(`select p.id from productos p where p.empresa_id = $1 and p.activo and not p.requiere_formula and not p.control_especial
  and p.precio_unidad is not null and (select coalesce(sum(unidades), 0) from v_stock_vigente v where v.producto_id = p.id) >= 2 order by p.nombre limit 1`, [E.A])).rows[0].id;

// AUD-01 (P1): la caja ofrece «Consumidor final» para la factura electrónica (sin correo: la DIAN no se lo envía a nadie
// y MATIAS lo acepta), pero registrar_venta exigía correo a TODA factura: el botón Cobrar quedaba activo y el cobro fallaba.
test("AUD-01 · factura electrónica a consumidor final (222222222222) sin correo se registra", async () => {
  await como(U.cajera, async (c) => {
    const cli = (await c.query(`insert into clientes (empresa_id, tipo_doc, numero_doc, nombre) values ($1, 'CC', '222222222222', 'Consumidor final')
      on conflict (empresa_id, tipo_doc, numero_doc) do update set nombre = excluded.nombre returning id`, [E.A])).rows[0].id;
    const r = (await c.query("select registrar_venta($1) r", [{ empresa_id: E.A, sede_id: S.A, caja_id: C.A, idem_key: crypto.randomUUID(), tipo_doc: "factura", cliente_id: cli,
      lineas: [{ producto_id: await producto(c), presentacion: "unidad", cantidad: 1 }], pagos: [{ medio: "efectivo", valor: 1000000 }] }])).rows[0].r;
    assert.ok(r.venta_id, "la venta se registra");
  });
});

test("AUD-01 · a un cliente identificado SIN correo se le sigue exigiendo el correo en la factura", async () => {
  await como(U.cajera, async (c) => {
    const cli = (await c.query(`insert into clientes (empresa_id, tipo_doc, numero_doc, nombre) values ($1, 'CC', '1098765432', 'Cliente sin correo')
      on conflict (empresa_id, tipo_doc, numero_doc) do update set email = null returning id`, [E.A])).rows[0].id;
    await assert.rejects(c.query("select registrar_venta($1)", [{ empresa_id: E.A, sede_id: S.A, caja_id: C.A, idem_key: crypto.randomUUID(), tipo_doc: "factura", cliente_id: cli,
      lineas: [{ producto_id: await producto(c), presentacion: "unidad", cantidad: 1 }], pagos: [{ medio: "efectivo", valor: 1000000 }] }]), /necesita el correo del cliente/);
  });
});
