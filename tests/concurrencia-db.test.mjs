// Concurrencia real contra la base (auditoría 17/11/2026): dos cajas vendiendo a la vez la última existencia, el mismo
// cobro enviado dos veces en paralelo (reintento por red / doble clic) y la misma entrada de mercancía repetida en paralelo.
// Cada operación va en su propia conexión y transacción confirmada, como dos servidores distintos.
// Uso: base recién sembrada → node --test tests/concurrencia-db.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

const url = process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/regenta?host=/tmp";
const pool = new pg.Pool({ connectionString: url, max: 10 });
const U = { carlos: "00000000-0000-4000-8000-000000000001", cajera: "00000000-0000-4000-8000-000000000002", bodega: "00000000-0000-4000-8000-000000000003" };
const E = { A: "10000000-0000-4000-8000-00000000000a" };
const S = { A: "20000000-0000-4000-8000-00000000000a" };
const C = { A: "30000000-0000-4000-8000-00000000000a" };

async function como(uid, fn) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })]);
    await c.query("set local role authenticated");
    const r = await fn(c);
    await c.query("commit");
    return r;
  } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
}
const stock = async (id) => Number((await pool.query(`select coalesce(sum(unidades), 0) u from v_stock_lotes where producto_id = $1`, [id])).rows[0].u);
const negativos = async (id) => Number((await pool.query(`select count(*) n from v_stock_lotes where producto_id = $1 and unidades < 0`, [id])).rows[0].n);
const venta = (producto, unidades, idem = crypto.randomUUID()) => ({ empresa_id: E.A, sede_id: S.A, caja_id: C.A, idem_key: idem, tipo_doc: "pos",
  lineas: [{ producto_id: producto, presentacion: "unidad", cantidad: unidades }], pagos: [{ medio: "efectivo", valor: 100000000 }] });

let prod;
before(async () => {
  // Un producto vendible sin fórmula, fraccionable por unidad, con existencias vigentes y sin bloqueos.
  prod = (await pool.query(`select p.id from productos p where p.empresa_id = $1 and p.activo and not p.requiere_formula and not p.control_especial
      and p.precio_unidad is not null and (select coalesce(sum(unidades), 0) from v_stock_vigente v where v.producto_id = p.id) between 2 and 500
    order by p.nombre limit 1`, [E.A])).rows[0];
  assert.ok(prod, "hay un producto vendible por unidad en la demo");
});
after(() => pool.end());

test("dos cajas venden a la vez TODA la existencia: solo una venta pasa y el stock no queda negativo", async () => {
  const n = await stock(prod.id);
  const r = await Promise.allSettled([como(U.cajera, (c) => c.query("select registrar_venta($1) r", [venta(prod.id, n)])),
                                      como(U.carlos, (c) => c.query("select registrar_venta($1) r", [venta(prod.id, n)]))]);
  const ok = r.filter((x) => x.status === "fulfilled").length;
  assert.equal(ok, 1, `exactamente una venta se registra (${r.map((x) => x.status === "rejected" ? x.reason.message : "ok").join(" | ")})`);
  assert.equal(await stock(prod.id), 0, "queda en cero, no en negativo");
  assert.equal(await negativos(prod.id), 0, "ningún lote en negativo");
});

test("el mismo cobro enviado dos veces en paralelo (misma idem_key) crea UNA venta y descuenta UNA vez", async () => {
  const p = (await pool.query(`select p.id from productos p where p.empresa_id = $1 and p.activo and not p.requiere_formula and not p.control_especial
      and p.precio_unidad is not null and p.id <> $2 and (select coalesce(sum(unidades), 0) from v_stock_vigente v where v.producto_id = p.id) >= 3
    order by p.nombre limit 1`, [E.A, prod.id])).rows[0];
  const antes = await stock(p.id), idem = crypto.randomUUID();
  const r = await Promise.allSettled([como(U.cajera, (c) => c.query("select registrar_venta($1) r", [venta(p.id, 1, idem)])),
                                      como(U.cajera, (c) => c.query("select registrar_venta($1) r", [venta(p.id, 1, idem)]))]);
  const ventas = Number((await pool.query(`select count(*) n from ventas where idem_key = $1`, [idem])).rows[0].n);
  assert.equal(ventas, 1, `una sola venta (${r.map((x) => x.status === "rejected" ? x.reason.message : "ok").join(" | ")})`);
  assert.equal(await stock(p.id), antes - 1, "descuenta una sola vez");
  const ids = r.filter((x) => x.status === "fulfilled").map((x) => x.value.rows[0].r.venta_id);
  assert.ok(ids.length >= 1 && new Set(ids).size === 1, "los dos intentos que responden devuelven la misma venta");
});

test("la misma entrada de mercancía enviada dos veces en paralelo suma UNA vez", async () => {
  const id = (await pool.query(`select id from productos where empresa_id = $1 and activo order by nombre desc limit 1`, [E.A])).rows[0].id;
  const antes = await stock(id), idem = "concurrencia-entrada-" + crypto.randomUUID();
  const e = { empresa_id: E.A, sede_id: S.A, tipo: "compra", idem_key: idem, lineas: [{ producto_id: id, lote: "CONC-" + idem.slice(-6), vence: "2031-01-01", unidades: 7, costo_unidad: 100 }] };
  const r = await Promise.allSettled([como(U.carlos, (c) => c.query("select registrar_entrada($1) r", [e])), como(U.carlos, (c) => c.query("select registrar_entrada($1) r", [e]))]);
  assert.equal(await stock(id), antes + 7, `suma una sola vez (${r.map((x) => x.status === "rejected" ? x.reason.message : "ok").join(" | ")})`);
});
