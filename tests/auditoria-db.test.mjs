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

// P1-1 (DIAN): el tiquete POS solo procede si la venta no supera 5 UVT sin impuestos (art. 616-1 par. 2 ET; Dec. 442/2023).
// Migración 053: tope_pos() = 5 × UVT del año (2026: 5 × 52.374 = 261.870); por encima, factura electrónica.
test("P1-1 · tope del POS: 5 UVT de 2026 = $261.870", async () => {
  const t = Number((await pool.query(`select tope_pos('2026-06-01'::timestamptz) t`)).rows[0].t);
  assert.equal(t, 261870);
});

test("P1-1 · POS por encima de 5 UVT se rechaza; hasta el tope se registra; la misma venta con factura sí", async () => {
  await como(U.cajera, async (c) => {
    // Producto con existencias de sobra para pasar el tope.
    const p = (await c.query(`select p.id, p.precio_unidad::numeric pu from productos p where p.empresa_id = $1 and p.activo and not p.requiere_formula and not p.control_especial
      and p.precio_unidad > 1000 and (select coalesce(sum(unidades), 0) from v_stock_vigente v where v.producto_id = p.id) * p.precio_unidad > 600000
      order by p.precio_unidad desc limit 1`, [E.A])).rows[0];
    assert.ok(p, "hay un producto con existencias suficientes");
    const venta = (tipo, cantidad, cli = null) => c.query("select registrar_venta($1) r", [{ empresa_id: E.A, sede_id: S.A, caja_id: C.A, idem_key: crypto.randomUUID(), tipo_doc: tipo, cliente_id: cli,
      lineas: [{ producto_id: p.id, presentacion: "unidad", cantidad }], pagos: [{ medio: "efectivo", valor: 100000000 }] }]);
    await c.query("savepoint a");
    const uno = (await venta("pos", 1)).rows[0].r;           // base de una unidad (sin IVA)
    await c.query("rollback to savepoint a");
    const n = Math.floor(261870 / Number(uno.base)) + 1;       // primera cantidad que pasa el tope
    await c.query("savepoint b");
    await assert.rejects(venta("pos", n), /supera 5 UVT \(\$261\.870 sin IVA\).*factura electrónica/);
    await c.query("rollback to savepoint b");
    const ok = (await venta("pos", n - 1)).rows[0].r;
    assert.ok(Number(ok.base) <= 261870 && ok.venta_id, "hasta el tope, POS");
    const cli = (await c.query(`insert into clientes (empresa_id, tipo_doc, numero_doc, nombre) values ($1, 'CC', '222222222222', 'Consumidor final')
      on conflict (empresa_id, tipo_doc, numero_doc) do update set nombre = excluded.nombre returning id`, [E.A])).rows[0].id;
    const f = (await venta("factura", n, cli)).rows[0].r;
    assert.ok(f.venta_id && Number(f.base) > 261870, "por encima, con factura a consumidor final");
  });
});

// P1-2 (DIAN): contingencia del tiquete POS (054). La caja aparta números; la venta hecha sin internet se registra con el
// número que salió impreso; un número no apartado para esa caja, o ya usado, se rechaza.
test("P1-2 · contingencia: venta con número apartado; no apartado o repetido se rechaza", async () => {
  await como(U.cajera, async (c) => {
    const nums = (await c.query(`select prefijo, numero from reservar_contingencia($1, 3)`, [C.A])).rows;
    assert.ok(nums.length >= 3, "aparta números");
    const antes = Number((await c.query(`select actual from resoluciones_dian where empresa_id = $1 and tipo = 'pos' and activa`, [E.A])).rows[0].actual);
    const pid = (await c.query(`select p.id from productos p where p.empresa_id = $1 and p.activo and not p.requiere_formula and not p.control_especial and p.precio_unidad is not null
      and (select coalesce(sum(unidades), 0) from v_stock_vigente v where v.producto_id = p.id) >= 2 order by p.nombre limit 1`, [E.A])).rows[0].id;
    const vender = (n) => c.query("select registrar_venta($1) r", [{ empresa_id: E.A, sede_id: S.A, caja_id: C.A, idem_key: crypto.randomUUID(), tipo_doc: "pos", numero_contingencia: n,
      lineas: [{ producto_id: pid, presentacion: "unidad", cantidad: 1 }], pagos: [{ medio: "efectivo", valor: 1000000 }] }]);
    const n0 = Number(nums[0].numero);
    const r = (await vender(n0)).rows[0].r;
    assert.equal(Number(r.numero), n0, "queda con el número impreso");
    assert.equal(Number((await c.query(`select actual from resoluciones_dian where empresa_id = $1 and tipo = 'pos' and activa`, [E.A])).rows[0].actual), antes, "no consume otro número");
    await c.query("savepoint a");
    await assert.rejects(vender(n0), /no está reservado para esta caja o ya se usó/);
    await c.query("rollback to savepoint a");
    await assert.rejects(vender(antes + 1000), /no está reservado/);
  });
});
