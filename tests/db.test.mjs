// Pruebas de la base de datos: aislamiento entre empresas, permisos por rol, ventas FEFO, idempotencia e inmutabilidad.
// Uso: node scripts/db-reset.mjs && node --test tests/
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";

const url = process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/regenta?host=/tmp";
const pool = new pg.Pool({ connectionString: url });
const U = { carlos: "00000000-0000-4000-8000-000000000001", cajera: "00000000-0000-4000-8000-000000000002", bodega: "00000000-0000-4000-8000-000000000003", duenoB: "00000000-0000-4000-8000-000000000004", nadie: "00000000-0000-4000-8000-0000000000ff" };
const E = { A: "10000000-0000-4000-8000-00000000000a", B: "10000000-0000-4000-8000-00000000000b" };
const S = { A: "20000000-0000-4000-8000-00000000000a" };
const C = { A: "30000000-0000-4000-8000-00000000000a" };

/** Ejecuta fn como el usuario indicado, igual que la app (rol authenticated + claims), dentro de una transacción. */
async function como(uid, fn, { commit = false } = {}) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })]);
    await c.query("set local role authenticated");
    const r = await fn(c);
    await c.query(commit ? "commit" : "rollback");
    return r;
  } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
}
const venta = (lineas, extra = {}) => ({ empresa_id: E.A, sede_id: S.A, caja_id: C.A, idem_key: crypto.randomUUID(), tipo_doc: "pos", lineas, ...extra });

let prod; // un producto con dos lotes y existencias
before(async () => {
  const { rows } = await pool.query(`select p.id, p.precio_caja, p.unidades_por_caja, p.precio_unidad from productos p
    where p.empresa_id = $1 and p.unidades_por_caja > 1 and p.precio_unidad is not null
      and (select count(*) from v_stock_lotes s where s.producto_id = p.id and s.unidades > 0) = 2 limit 1`, [E.A]);
  prod = rows[0];
  assert.ok(prod, "hay un producto fraccionable con dos lotes en la demo");
});
after(() => pool.end());

test("el dueño de B no ve nada de A (empresas, productos, ventas, lotes)", async () => {
  const r = await como(U.duenoB, async (c) => ({
    emp: (await c.query("select id from empresas")).rows.map((x) => x.id),
    prod: (await c.query("select count(*)::int n from productos where empresa_id = $1", [E.A])).rows[0].n,
    lotes: (await c.query("select count(*)::int n from v_stock_lotes where empresa_id = $1", [E.A])).rows[0].n,
    ventas: (await c.query("select count(*)::int n from ventas where empresa_id = $1", [E.A])).rows[0].n,
  }));
  assert.deepEqual(r.emp, [E.B]);
  assert.equal(r.prod, 0); assert.equal(r.lotes, 0); assert.equal(r.ventas, 0);
});

test("un usuario sin empresa no ve nada", async () => {
  const n = await como(U.nadie, async (c) => (await c.query("select count(*)::int n from productos")).rows[0].n);
  assert.equal(n, 0);
});

test("el dueño de B no puede vender ni mover inventario en A", async () => {
  await assert.rejects(como(U.duenoB, (c) => c.query("select registrar_venta($1)", [venta([{ producto_id: prod.id, presentacion: "caja", cantidad: 1 }])])), /permiso/);
  await assert.rejects(como(U.duenoB, (c) => c.query("select registrar_entrada($1)", [{ empresa_id: E.A, sede_id: S.A, tipo: "compra", lineas: [{ producto_id: prod.id, lote: "X", unidades: 5 }] }])), /permiso/);
});

test("el dueño de B no puede modificar productos de A", async () => {
  const n = await como(U.duenoB, async (c) => (await c.query("update productos set precio_caja = 1 where empresa_id = $1", [E.A])).rowCount);
  assert.equal(n, 0);
});

test("la cajera no ve costos ni auditoría; el dueño sí", async () => {
  const caj = await como(U.cajera, async (c) => [(await c.query("select count(*)::int n from lote_costos")).rows[0].n, (await c.query("select count(*)::int n from auditoria")).rows[0].n]);
  const due = await como(U.carlos, async (c) => (await c.query("select count(*)::int n from lote_costos")).rows[0].n);
  assert.deepEqual(caj, [0, 0]);
  assert.ok(due > 0);
});

test("la cajera no puede cambiar precios ni escribir ventas directamente", async () => {
  const n = await como(U.cajera, async (c) => (await c.query("update productos set precio_caja = 1 where id = $1", [prod.id])).rowCount);
  assert.equal(n, 0);
  await assert.rejects(como(U.cajera, (c) => c.query("insert into ventas (empresa_id) values ($1)", [E.A])), /permission denied/);
  await assert.rejects(como(U.cajera, (c) => c.query("insert into movimientos (empresa_id) values ($1)", [E.A])), /permission denied/);
});

test("venta POS: descuenta del lote que vence antes, calcula IVA y numera", async () => {
  const r = await como(U.cajera, async (c) => {
    const antes = (await c.query("select lote_id, vence, unidades from v_stock_lotes where producto_id = $1 and unidades > 0 order by vence", [prod.id])).rows;
    const v = (await c.query("select registrar_venta($1) r", [venta([{ producto_id: prod.id, presentacion: "unidad", cantidad: 1 }], { pagos: [{ medio: "efectivo", valor: 100000 }] })])).rows[0].r;
    const despues = (await c.query("select lote_id, unidades from v_stock_lotes where lote_id = any($1) order by vence", [antes.map((l) => l.lote_id)])).rows;
    const doc = (await c.query("select estado, prefijo, numero from documentos_dian where venta_id = $1", [v.venta_id])).rows[0];
    return { antes, despues, v, doc };
  });
  assert.equal(r.despues[0].unidades, r.antes[0].unidades - 1, "sale del lote más próximo a vencer");
  assert.equal(r.despues[1].unidades, r.antes[1].unidades, "el otro lote no se toca");
  assert.equal(Number(r.v.total), Number(prod.precio_unidad));
  assert.equal(Number(r.v.cambio), 100000 - Number(prod.precio_unidad));
  assert.equal(r.doc.estado, "pendiente");
  assert.equal(r.doc.prefijo, "SETP");
});

test("una línea que no cabe en un lote se reparte en el siguiente", async () => {
  const r = await como(U.cajera, async (c) => {
    const lotes = (await c.query("select unidades from v_stock_lotes where producto_id = $1 and unidades > 0 order by vence", [prod.id])).rows;
    const pedir = lotes[0].unidades + 1;
    const v = (await c.query("select registrar_venta($1) r", [venta([{ producto_id: prod.id, presentacion: "unidad", cantidad: pedir }], { pagos: [{ medio: "tarjeta", valor: pedir * prod.precio_unidad }] })])).rows[0].r;
    return (await c.query("select unidades from venta_lineas where venta_id = $1 order by id", [v.venta_id])).rows.map((x) => x.unidades);
  });
  assert.equal(r.length, 2);
});

test("sin existencias suficientes, la venta no se registra", async () => {
  await assert.rejects(como(U.cajera, (c) => c.query("select registrar_venta($1)", [venta([{ producto_id: prod.id, presentacion: "caja", cantidad: 9999 }], { pagos: [{ medio: "efectivo", valor: 1e12 }] })])), /existencias/);
});

test("el pago debe cubrir el total y el cambio solo sale del efectivo", async () => {
  await assert.rejects(como(U.cajera, (c) => c.query("select registrar_venta($1)", [venta([{ producto_id: prod.id, presentacion: "caja", cantidad: 1 }], { pagos: [{ medio: "efectivo", valor: 1 }] })])), /no cubre/);
  await assert.rejects(como(U.cajera, (c) => c.query("select registrar_venta($1)", [venta([{ producto_id: prod.id, presentacion: "caja", cantidad: 1 }], { pagos: [{ medio: "tarjeta", valor: 1e9 }] })])), /cambio/);
});

test("reintentar la misma venta (misma clave) no la duplica", async () => {
  const k = crypto.randomUUID();
  const [a, b] = await como(U.cajera, async (c) => {
    const p = venta([{ producto_id: prod.id, presentacion: "unidad", cantidad: 1 }], { idem_key: k, pagos: [{ medio: "nequi", valor: prod.precio_unidad }] });
    return [(await c.query("select registrar_venta($1) r", [p])).rows[0].r, (await c.query("select registrar_venta($1) r", [p])).rows[0].r];
  });
  assert.equal(a.venta_id, b.venta_id);
  assert.equal(b.repetida, true);
});

test("ventas, líneas y movimientos son inmutables; solo se anulan", async () => {
  await como(U.carlos, async (c) => {
    const v = (await c.query("select registrar_venta($1) r", [venta([{ producto_id: prod.id, presentacion: "unidad", cantidad: 1 }], { pagos: [{ medio: "efectivo", valor: prod.precio_unidad }] })])).rows[0].r;
    await c.query("savepoint s");
    await assert.rejects(c.query("select registrar_venta($1)", [{}]));
    await c.query("rollback to s");
    const antes = (await c.query("select sum(unidades)::int n from v_stock_lotes where producto_id = $1", [prod.id])).rows[0].n;
    await c.query("select anular_venta($1, 'Error de digitación')", [v.venta_id]);
    const despues = (await c.query("select sum(unidades)::int n from v_stock_lotes where producto_id = $1", [prod.id])).rows[0].n;
    assert.equal(despues, antes + 1, "la anulación devuelve la unidad al lote");
    assert.equal((await c.query("select estado from ventas where id = $1", [v.venta_id])).rows[0].estado, "anulada");
  });
  // Ni siquiera con la conexión privilegiada del servidor se pueden tocar líneas, pagos o movimientos de una venta.
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U.carlos })]);
    const v = (await c.query("select registrar_venta($1) r", [venta([{ producto_id: prod.id, presentacion: "unidad", cantidad: 1 }], { pagos: [{ medio: "efectivo", valor: prod.precio_unidad }] })])).rows[0].r;
    for (const q of ["update movimientos set cantidad = 1 where ref_id = $1", "delete from venta_lineas where venta_id = $1", "delete from pagos where venta_id = $1", "update ventas set total = 1 where id = $1", "delete from ventas where id = $1"]) {
      await c.query("savepoint s");
      await assert.rejects(c.query(q, [v.venta_id]), /no se modifican|solo puede anularse|no se borran/, q);
      await c.query("rollback to s");
    }
  } finally { await c.query("rollback"); c.release(); }
});

test("la cajera no puede anular ventas", async () => {
  await assert.rejects(como(U.cajera, async (c) => {
    const v = (await c.query("select registrar_venta($1) r", [venta([{ producto_id: prod.id, presentacion: "unidad", cantidad: 1 }], { pagos: [{ medio: "efectivo", valor: prod.precio_unidad }] })])).rows[0].r;
    await c.query("select anular_venta($1, 'x')", [v.venta_id]);
  }), /anular/);
});

test("un cambio de precio queda en la auditoría", async () => {
  const n = await como(U.carlos, async (c) => {
    await c.query("update productos set precio_caja = precio_caja + 100 where id = $1", [prod.id]);
    return (await c.query("select count(*)::int n from auditoria where accion = 'cambio_precio' and entidad_id = $1", [prod.id])).rows[0].n;
  });
  assert.equal(n, 1);
});

test("un ajuste sin motivo se rechaza y no puede dejar un lote en negativo", async () => {
  await assert.rejects(como(U.bodega, (c) => c.query("select registrar_entrada($1)", [{ empresa_id: E.A, sede_id: S.A, tipo: "ajuste", lineas: [{ producto_id: prod.id, lote: "X1", unidades: -1 }] }])), /motivo/);
  await assert.rejects(como(U.bodega, async (c) => {
    const l = (await c.query("select lote, unidades from v_stock_lotes where producto_id = $1 and unidades > 0 limit 1", [prod.id])).rows[0];
    await c.query("select registrar_entrada($1)", [{ empresa_id: E.A, sede_id: S.A, tipo: "ajuste", motivo: "conteo", lineas: [{ producto_id: prod.id, lote: l.lote, unidades: -(l.unidades + 1) }] }]);
  }), /negativo/);
});

// ── Predicción
test("predicción: ritmo, riesgo de vencimiento FEFO y pedido sugerido con un caso controlado", async () => {
  const r = await como(U.carlos, async (c) => {
    const id = (await c.query(`insert into productos (empresa_id, nombre, iva, unidades_por_caja, precio_caja) values ($1, 'Prueba predicción', 0, 1, 1000) returning id`, [E.A])).rows[0].id;
    const dias = (n) => `(current_date + ${n})::text`;
    await c.query(`select registrar_entrada(jsonb_build_object('empresa_id', $1::uuid, 'sede_id', $2::uuid, 'tipo', 'compra', 'lineas', jsonb_build_array(
      jsonb_build_object('producto_id', $3::uuid, 'lote', 'X', 'vence', ${dias(10)}, 'unidades', 50, 'costo_unidad', 400),
      jsonb_build_object('producto_id', $3::uuid, 'lote', 'Y', 'vence', ${dias(100)}, 'unidades', 20, 'costo_unidad', 400))))`, [E.A, S.A, id]);
    await c.query(`select registrar_venta($1)`, [venta([{ producto_id: id, presentacion: "caja", cantidad: 28 }], { pagos: [{ medio: "efectivo", valor: 28000 }] })]);
    const p = (await c.query(`select existencias, venta_dia::float, sugerido_unidades from prediccion_productos($1) where producto_id = $2`, [E.A, id])).rows[0];
    const riesgo = (await c.query(`select lote, unidades_en_riesgo, valor_en_riesgo::float from riesgo_vencimiento($1) where producto_id = $2`, [E.A, id])).rows;
    const p2 = (await c.query(`select sugerido_unidades, sugerido_cajas from prediccion_productos($1, 3, 60) where producto_id = $2`, [E.A, id])).rows[0];
    return { p, riesgo, p2 };
  });
  // 28 unidades en los últimos 14 días → 0,6 × 28/14 = 1,2 und/día
  assert.equal(r.p.venta_dia, 1.2);
  assert.equal(r.p.existencias, 42);
  assert.equal(r.p.sugerido_unidades, 0, "42 unidades cubren 18 días a 1,2/día");
  // lote X: quedan 22 (la venta salió de X por FEFO), en 10 días se venden 12 → 10 en riesgo; lote Y alcanza
  assert.deepEqual(r.riesgo, [{ lote: "X", unidades_en_riesgo: 10, valor_en_riesgo: 4000 }]);
  // con 63 días de horizonte: 1,2 × 63 = 75,6 → faltan 34 unidades
  assert.equal(r.p2.sugerido_unidades, 34);
});

test("predicción: otra empresa no ve nada y la cajera no ve costos en riesgo", async () => {
  const b = await como(U.duenoB, async (c) => (await c.query(`select count(*)::int n from prediccion_productos($1)`, [E.A])).rows[0].n);
  assert.equal(b, 0);
  const caj = await como(U.cajera, async (c) => (await c.query(`select count(*)::int n, count(valor_en_riesgo)::int con_valor from riesgo_vencimiento($1)`, [E.A])).rows[0]);
  assert.ok(caj.n > 0, "la cajera ve los lotes en riesgo");
  assert.equal(caj.con_valor, 0, "pero sin el valor a costo");
});

test("nunca se vende un lote vencido, aunque sea el primero por FEFO", async () => {
  await assert.rejects(como(U.carlos, async (c) => {
    const id = (await c.query(`insert into productos (empresa_id, nombre, iva, unidades_por_caja, precio_caja) values ($1, 'Prueba vencido', 0, 1, 1000) returning id`, [E.A])).rows[0].id;
    await c.query(`select registrar_entrada(jsonb_build_object('empresa_id', $1::uuid, 'sede_id', $2::uuid, 'tipo', 'compra', 'lineas', jsonb_build_array(
      jsonb_build_object('producto_id', $3::uuid, 'lote', 'VIEJO', 'vence', (current_date - 1)::text, 'unidades', 5),
      jsonb_build_object('producto_id', $3::uuid, 'lote', 'NUEVO', 'vence', (current_date + 200)::text, 'unidades', 2))))`, [E.A, S.A, id]);
    const v = (await c.query(`select registrar_venta($1) r`, [venta([{ producto_id: id, presentacion: "caja", cantidad: 2 }], { pagos: [{ medio: "efectivo", valor: 2000 }] })])).rows[0].r;
    const lotes = (await c.query(`select l.lote from venta_lineas vl join lotes l on l.id = vl.lote_id where vl.venta_id = $1`, [v.venta_id])).rows.map((x) => x.lote);
    assert.deepEqual(lotes, ["NUEVO"], "sale del lote vigente");
    await c.query(`select registrar_venta($1)`, [venta([{ producto_id: id, presentacion: "caja", cantidad: 1 }], { pagos: [{ medio: "efectivo", valor: 1000 }] })]);
  }), /vencido y no se puede vender/);
});

test("alertas INVIMA: cruce por lote, registro y nombre; otra empresa no ve el cruce de A", async () => {
  const a = await como(U.carlos, async (c) => (await c.query(`select numero, producto, nivel, lote, unidades from alertas_empresa($1) where producto is not null order by nivel`, [E.A])).rows);
  const lote = a.find((x) => x.nivel === "lote");
  assert.ok(lote && lote.numero === "329-2026" && lote.lote === "F0537A" && lote.unidades > 0, "detecta el lote F0537A en existencias");
  assert.ok(a.some((x) => x.nivel === "nombre" && /compositum/i.test(x.producto)), "marca para revisar otros Buscapina Compositum por nombre");
  const b = await como(U.duenoB, async (c) => (await c.query(`select count(*)::int n from alertas_empresa($1) where producto_id is not null`, [E.A])).rows[0].n);
  assert.equal(b, 0);
  await assert.rejects(como(U.cajera, (c) => c.query(`insert into alertas_revision (empresa_id, alerta_id, resultado) select $1, id, 'no_aplica' from alertas_invima limit 1`, [E.A])), /row-level security|permission/);
});
