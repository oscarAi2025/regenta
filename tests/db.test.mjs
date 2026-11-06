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
    // Un lote que se venció en la estantería (se registra como ajuste: una compra vencida ya no se puede recibir).
    await c.query(`select registrar_entrada(jsonb_build_object('empresa_id', $1::uuid, 'sede_id', $2::uuid, 'tipo', 'ajuste', 'motivo', 'Conteo físico', 'lineas', jsonb_build_array(
      jsonb_build_object('producto_id', $3::uuid, 'lote', 'VIEJO', 'vence', (current_date - 1)::text, 'unidades', 5))))`, [E.A, S.A, id]);
    await c.query(`select registrar_entrada(jsonb_build_object('empresa_id', $1::uuid, 'sede_id', $2::uuid, 'tipo', 'compra', 'lineas', jsonb_build_array(
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

// ── Correcciones de la revisión de código (1/11/2026)
test("el dueño de otra empresa NO puede anular ventas ajenas", async () => {
  const id = (await pool.query(`select id from ventas where empresa_id = $1 and estado = 'cerrada' limit 1`, [E.A])).rows[0].id;
  await assert.rejects(como(U.duenoB, (c) => c.query(`select anular_venta($1, 'prueba')`, [id])), /Solo el dueño/);
  await assert.rejects(como(U.nadie, (c) => c.query(`select anular_venta($1, 'prueba')`, [id])), /Solo el dueño/);
});

test("el dueño no puede cambiarse el plan, el estado ni el NIT", async () => {
  await assert.rejects(como(U.duenoB, (c) => c.query(`update empresas set estado = 'activa', plan = 'distribuidor' where id = $1`, [E.B])), /permission denied/);
  await assert.rejects(como(U.duenoB, (c) => c.query(`update empresas set nit = '1' where id = $1`, [E.B])), /permission denied/);
  const n = await como(U.duenoB, async (c) => (await c.query(`update empresas set telefono = '3000000000' where id = $1`, [E.B])).rowCount);
  assert.equal(n, 1, "sí puede cambiar su teléfono");
});

test("en la demo nadie puede tocar usuarios ni datos de la empresa", async () => {
  await assert.rejects(como(U.carlos, (c) => c.query(`update miembros set activo = false where empresa_id = $1`, [E.A])), /demostración|permission denied/);
  await assert.rejects(como(U.carlos, (c) => c.query(`update empresas set telefono = '1' where id = $1`, [E.A])), /demostración/);
});

test("anular: un documento sin emitir no se envía; uno aceptado genera nota crédito", async () => {
  const r = await como(U.carlos, async (c) => {
    const pend = (await c.query(`select registrar_venta($1) r`, [venta([{ producto_id: prod.id, presentacion: "unidad", cantidad: 1 }], { pagos: [{ medio: "efectivo", valor: 100000 }] })])).rows[0].r.venta_id;
    await c.query(`select anular_venta($1, 'cliente devolvió')`, [pend]);
    const e1 = (await c.query(`select estado from documentos_dian where venta_id = $1`, [pend])).rows.map((x) => x.estado);
    const acep = (await c.query(`select d.venta_id from documentos_dian d join ventas v on v.id = d.venta_id where d.empresa_id = $1 and d.estado = 'aceptado' and v.estado = 'cerrada' limit 1`, [E.A])).rows[0].venta_id;
    await c.query(`select anular_venta($1, 'error de digitación')`, [acep]);
    const e2 = (await c.query(`select tipo, estado, prefijo from documentos_dian where venta_id = $1 order by creado`, [acep])).rows;
    return { e1, e2 };
  });
  assert.deepEqual(r.e1, ["anulado"]);
  assert.ok(r.e2.some((d) => d.tipo === "nota_credito" && d.estado === "pendiente" && d.prefijo === "NCSE"), JSON.stringify(r.e2));
});

test("entrada de inventario idempotente y el costo solo lo registra la gerencia", async () => {
  const r = await como(U.bodega, async (c) => {
    const id = (await c.query(`select id from productos where empresa_id = $1 limit 1`, [E.A])).rows[0].id;
    const e = { empresa_id: E.A, sede_id: S.A, tipo: "compra", idem_key: "prueba-idem-1", lineas: [{ producto_id: id, lote: "IDEM1", vence: "2030-01-01", unidades: 10, costo_unidad: 1 }] };
    const a = (await c.query(`select registrar_entrada($1) r`, [e])).rows[0].r;
    const b = (await c.query(`select registrar_entrada($1) r`, [e])).rows[0].r;
    const stock = (await c.query(`select unidades from v_stock_lotes where producto_id = $1 and lote = 'IDEM1'`, [id])).rows[0].unidades;
    const costo = (await pool.query(`select count(*)::int n from lote_costos lc join lotes l on l.id = lc.lote_id where l.lote = 'IDEM1'`)).rows[0].n;
    return { a, b, stock, costo };
  });
  assert.equal(r.b.repetida, true);
  assert.equal(r.stock, 10, "la segunda vez no suma");
  assert.equal(r.costo, 0, "el costo enviado por bodega se ignora");
});

test("el registro sanitario se guarda normalizado", async () => {
  const v = await como(U.carlos, async (c) => {
    const id = (await c.query(`insert into productos (empresa_id, nombre, iva, unidades_por_caja, precio_caja, registro_sanitario) values ($1, 'Prueba registro', 0, 1, 1000, ' invima2020m- 003171 -r4 ') returning id`, [E.A])).rows[0].id;
    return (await c.query(`select registro_sanitario from productos where id = $1`, [id])).rows[0].registro_sanitario;
  });
  assert.equal(v, "INVIMA 2020M-003171-R4");
});

test("las ventas anuladas no cuentan en el ritmo de venta", async () => {
  const r = await como(U.carlos, async (c) => {
    const id = (await c.query(`insert into productos (empresa_id, nombre, iva, unidades_por_caja, precio_caja) values ($1, 'Prueba anulada', 0, 1, 1000) returning id`, [E.A])).rows[0].id;
    await c.query(`select registrar_entrada(jsonb_build_object('empresa_id', $1::uuid, 'sede_id', $2::uuid, 'tipo', 'compra', 'lineas', jsonb_build_array(jsonb_build_object('producto_id', $3::uuid, 'lote', 'A', 'vence', '2030-01-01', 'unidades', 50))))`, [E.A, S.A, id]);
    const v = (await c.query(`select registrar_venta($1) r`, [venta([{ producto_id: id, presentacion: "caja", cantidad: 14 }], { pagos: [{ medio: "efectivo", valor: 14000 }] })])).rows[0].r.venta_id;
    const antes = (await c.query(`select venta_dia::float from prediccion_productos($1) where producto_id = $2`, [E.A, id])).rows[0].venta_dia;
    await c.query(`select anular_venta($1, 'prueba')`, [v]);
    const despues = (await c.query(`select venta_dia::float from prediccion_productos($1) where producto_id = $2`, [E.A, id])).rows[0].venta_dia;
    return { antes, despues };
  });
  assert.equal(r.antes, 0.6);
  assert.equal(r.despues, 0);
});

test("una revisión de alerta no puede citar un producto de otra empresa", async () => {
  const ajeno = (await pool.query(`select id from productos where empresa_id = $1 limit 1`, [E.A])).rows[0].id;
  await assert.rejects(como(U.duenoB, (c) => c.query(`insert into alertas_revision (empresa_id, alerta_id, producto_id, resultado) select $1, id, $2, 'no_aplica' from alertas_invima limit 1`, [E.B, ajeno])), /row-level security/);
});

test("venta a crédito: factura, cliente y plazo; la cajera no puede fiar", async () => {
  const cli = (await pool.query(`select id from clientes where empresa_id = $1 and tipo_doc = 'NIT' limit 1`, [E.A])).rows[0].id;
  const credito = (extra) => venta([{ producto_id: prod.id, presentacion: "unidad", cantidad: 1 }], { tipo_doc: "factura", cliente_id: cli, condicion: "credito", plazo_dias: 30, pagos: [], ...extra });
  await assert.rejects(como(U.cajera, (c) => c.query("select registrar_venta($1)", [credito()])), /dueño o el administrador/);
  await assert.rejects(como(U.carlos, (c) => c.query("select registrar_venta($1)", [credito({ tipo_doc: "pos" })])), /factura electrónica/);
  await assert.rejects(como(U.carlos, (c) => c.query("select registrar_venta($1)", [credito({ plazo_dias: 0 })])), /plazo/);
  await assert.rejects(como(U.carlos, (c) => c.query("select registrar_venta($1)", [credito({ cliente_id: null })])), /cliente/);
  const r = await como(U.carlos, async (c) => {
    const v = (await c.query("select registrar_venta($1) r", [credito()])).rows[0].r;
    const cart = (await c.query("select saldo::float, dias_mora from v_cartera where venta_id = $1", [v.venta_id])).rows[0];
    const fila = (await c.query("select vence_pago::text, recibido::float from ventas where id = $1", [v.venta_id])).rows[0];
    return { v, cart, fila };
  });
  assert.equal(r.v.credito, true);
  assert.equal(r.cart.saldo, Number(r.v.total));
  assert.equal(r.cart.dias_mora, 0);
  assert.equal(r.fila.recibido, 0);
});

test("abonos: no superan el saldo, solo gerencia, y bloquean la anulación", async () => {
  const cli = (await pool.query(`select id from clientes where empresa_id = $1 and tipo_doc = 'NIT' limit 1`, [E.A])).rows[0].id;
  const r = await como(U.carlos, async (c) => {
    const v = (await c.query("select registrar_venta($1) r", [venta([{ producto_id: prod.id, presentacion: "unidad", cantidad: 2 }], { tipo_doc: "factura", cliente_id: cli, condicion: "credito", plazo_dias: 15, pagos: [] })])).rows[0].r;
    const total = Number(v.total);
    const a = (await c.query("select registrar_abono($1, 'nequi', $2) r", [v.venta_id, Math.floor(total / 2)])).rows[0].r;
    let excede = null, anula = null;
    try { await c.query("savepoint s"); await c.query("select registrar_abono($1, 'nequi', $2)", [v.venta_id, total]); } catch (e) { excede = e.message; await c.query("rollback to savepoint s"); }
    try { await c.query("savepoint t"); await c.query("select anular_venta($1, 'prueba')", [v.venta_id]); } catch (e) { anula = e.message; await c.query("rollback to savepoint t"); }
    const cart = (await c.query("select saldo::float from v_cartera where venta_id = $1", [v.venta_id])).rows[0];
    return { total, a, excede, anula, cart };
  });
  assert.equal(r.cart.saldo, r.total - Math.floor(r.total / 2));
  assert.match(r.excede, /supera el saldo/);
  assert.match(r.anula, /abonos/);
  const id = (await pool.query(`select id from ventas where empresa_id = $1 and condicion = 'credito' limit 1`, [E.A])).rows[0].id;
  await assert.rejects(como(U.cajera, (c) => c.query("select registrar_abono($1, 'efectivo', 1000)", [id])), /dueño o el administrador/);
  await assert.rejects(como(U.duenoB, (c) => c.query("select registrar_abono($1, 'efectivo', 1000)", [id])), /dueño o el administrador/);
  const vista = await como(U.cajera, (c) => c.query("select count(*)::int n from v_cartera"));
  assert.equal(vista.rows[0].n, 0, "la cajera no ve la cartera");
});

test("una caja repartida en tres lotes cobra el precio exacto (sin centavos sueltos)", async () => {
  const r = await como(U.carlos, async (c) => {
    const id = (await c.query(`insert into productos (empresa_id, nombre, iva, unidades_por_caja, precio_caja) values ($1, 'Prueba redondeo', 0, 3, 20000) returning id`, [E.A])).rows[0].id;
    for (const [l, v] of [["R1", "2030-01-01"], ["R2", "2030-02-01"], ["R3", "2030-03-01"]])
      await c.query(`select registrar_entrada(jsonb_build_object('empresa_id', $1::uuid, 'sede_id', $2::uuid, 'tipo', 'compra', 'lineas', jsonb_build_array(jsonb_build_object('producto_id', $3::uuid, 'lote', $4::text, 'vence', $5::text, 'unidades', 1))))`, [E.A, S.A, id, l, v]);
    const v = (await c.query("select registrar_venta($1) r", [venta([{ producto_id: id, presentacion: "caja", cantidad: 1 }], { pagos: [{ medio: "efectivo", valor: 20000 }] })])).rows[0].r;
    const lineas = (await c.query("select count(*)::int n, sum(total)::float t from venta_lineas where venta_id = $1", [v.venta_id])).rows[0];
    return { total: Number(v.total), cambio: Number(v.cambio), lineas };
  });
  assert.equal(r.lineas.n, 3);
  assert.equal(r.total, 20000);
  assert.equal(r.lineas.t, 20000);
  assert.equal(r.cambio, 0);
});

test("«Separé el producto» en una alerta bloquea el lote: no se vende ni cuenta como existencia", async () => {
  const r = await como(U.carlos, async (c) => {
    const id = (await c.query(`insert into productos (empresa_id, nombre, iva, unidades_por_caja, precio_caja) values ($1, 'Prueba alerta', 0, 1, 1000) returning id`, [E.A])).rows[0].id;
    await c.query(`select registrar_entrada(jsonb_build_object('empresa_id', $1::uuid, 'sede_id', $2::uuid, 'tipo', 'compra', 'lineas', jsonb_build_array(jsonb_build_object('producto_id', $3::uuid, 'lote', 'F0537A', 'vence', '2030-01-01', 'unidades', 5))))`, [E.A, S.A, id]);
    const alerta = (await c.query(`select id from alertas_invima where 'F0537A' = any(lotes) limit 1`)).rows[0].id;
    await c.query(`insert into alertas_revision (empresa_id, alerta_id, producto_id, resultado) values ($1, $2, $3, 'separado')`, [E.A, alerta, id]);
    const vigente = (await c.query(`select coalesce(sum(unidades), 0)::int u from v_stock_vigente where producto_id = $1`, [id])).rows[0].u;
    let error = null;
    try { await c.query("savepoint s"); await c.query("select registrar_venta($1)", [venta([{ producto_id: id, presentacion: "caja", cantidad: 1 }], { pagos: [{ medio: "efectivo", valor: 1000 }] })]); } catch (e) { error = e.message; await c.query("rollback to savepoint s"); }
    return { vigente, error };
  });
  assert.equal(r.vigente, 0);
  assert.match(r.error, /alerta del INVIMA/);
});

test("abonos: se anulan con motivo, liberan el saldo y desbloquean la anulación; crédito guarda cambio 0", async () => {
  const cli = (await pool.query(`select id from clientes where empresa_id = $1 and tipo_doc = 'NIT' limit 1`, [E.A])).rows[0].id;
  const r = await como(U.carlos, async (c) => {
    const v = (await c.query("select registrar_venta($1) r", [venta([{ producto_id: prod.id, presentacion: "unidad", cantidad: 1 }], { tipo_doc: "factura", cliente_id: cli, condicion: "credito", plazo_dias: 30, pagos: [] })])).rows[0].r;
    await c.query("select registrar_abono($1, 'nequi', 100)", [v.venta_id]);
    const abono = (await c.query("select id from abonos where venta_id = $1", [v.venta_id])).rows[0].id;
    await c.query("select anular_abono($1, 'Se registró dos veces')", [abono]);
    const saldo = (await c.query("select saldo::float from v_cartera where venta_id = $1", [v.venta_id])).rows[0].saldo;
    const cambio = (await c.query("select cambio::float from ventas where id = $1", [v.venta_id])).rows[0].cambio;
    await c.query("select anular_venta($1, 'prueba')", [v.venta_id]);
    return { saldo, total: Number(v.total), cambio, abono };
  });
  assert.equal(r.saldo, r.total);
  assert.equal(r.cambio, 0);
});

test("recibir: un lote existente no cambia de fecha y no se recibe mercancía vencida", async () => {
  const entrada = (c, id, lote, vence) => c.query(`select registrar_entrada(jsonb_build_object('empresa_id', $1::uuid, 'sede_id', $2::uuid, 'tipo', 'compra', 'lineas',
    jsonb_build_array(jsonb_build_object('producto_id', $3::uuid, 'lote', $4::text, 'vence', $5::text, 'unidades', 1, 'costo_unidad', 100))))`, [E.A, S.A, id, lote, vence]);
  const nuevo = (c) => c.query(`insert into productos (empresa_id, nombre, iva, unidades_por_caja, precio_caja) values ($1, 'Prueba lote fijo', 0, 1, 1000) returning id`, [E.A]).then((r) => r.rows[0].id);
  await assert.rejects(como(U.carlos, async (c) => { const id = await nuevo(c); await entrada(c, id, "FIJO", "2030-01-01"); await entrada(c, id, "FIJO", "2031-01-01"); }), /ya existe con vencimiento 01\/01\/2030/);
  await assert.rejects(como(U.carlos, async (c) => { await entrada(c, await nuevo(c), "VENCIDO", "2020-01-01"); }), /ya está vencido/);
  const n = await como(U.carlos, async (c) => { const id = await nuevo(c); await entrada(c, id, "MISMA", "2030-01-01"); await entrada(c, id, "MISMA", "2030-01-01");
    return (await c.query(`select unidades from v_stock_lotes where producto_id = $1`, [id])).rows[0].unidades; });
  assert.equal(Number(n), 2, "el mismo lote con la misma fecha suma");
});

test("anular una venta ya emitida en producción exige numeración de notas crédito en producción", async () => {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query(`update resoluciones_dian set pruebas = false, numero_resolucion = '18760000000001' where empresa_id = $1 and tipo = 'pos' and activa`, [E.A]);
    await c.query(`update resoluciones_dian set pruebas = true where empresa_id = $1 and tipo = 'nota_credito' and activa`, [E.A]);
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U.carlos, role: "authenticated" })]);
    await c.query("set local role authenticated");
    const v = (await c.query("select registrar_venta($1) r", [venta([{ producto_id: prod.id, presentacion: "unidad", cantidad: 1 }], { pagos: [{ medio: "efectivo", valor: 100000 }] })])).rows[0].r;
    await c.query("reset role");
    await c.query(`update documentos_dian set estado = 'aceptado', cufe = 'x' where venta_id = $1`, [v.venta_id]);
    await c.query("set local role authenticated");
    await c.query("savepoint a");
    await assert.rejects(c.query("select anular_venta($1, 'Prueba de guardia')", [v.venta_id]), /notas crédito sigue en pruebas/);
    await c.query("rollback to savepoint a");
    // con la numeración de notas crédito en producción, sí
    await c.query("reset role");
    await c.query(`update resoluciones_dian set pruebas = false, numero_resolucion = '18760000000002' where empresa_id = $1 and tipo = 'nota_credito' and activa`, [E.A]);
    await c.query("set local role authenticated");
    await c.query("select anular_venta($1, 'Prueba de guardia')", [v.venta_id]);
    const nc = (await c.query(`select count(*)::int n from documentos_dian where venta_id = $1 and tipo = 'nota_credito'`, [v.venta_id])).rows[0].n;
    assert.equal(nc, 1);
  } finally { await c.query("rollback").catch(() => {}); c.release(); }
});

test("anular una venta cuyo envío quedó en duda (ya se intentó) genera nota crédito; si nunca salió, no", async () => {
  await como(U.carlos, async (c) => {
    const v1 = (await c.query("select registrar_venta($1) r", [venta([{ producto_id: prod.id, presentacion: "unidad", cantidad: 1 }], { pagos: [{ medio: "efectivo", valor: 100000 }] })])).rows[0].r;
    await c.query("select anular_venta($1, 'Nunca salió')", [v1.venta_id]);
    const a = (await c.query(`select estado from documentos_dian where venta_id = $1 and tipo <> 'nota_credito'`, [v1.venta_id])).rows[0].estado;
    assert.equal(a, "anulado");
    const v2 = (await c.query("select registrar_venta($1) r", [venta([{ producto_id: prod.id, presentacion: "unidad", cantidad: 1 }], { pagos: [{ medio: "efectivo", valor: 100000 }] })])).rows[0].r;
    await c.query("reset role");
    await c.query(`update documentos_dian set estado = 'pendiente', intentos = 1 where venta_id = $1`, [v2.venta_id]);
    await c.query("set local role authenticated");
    await c.query("select anular_venta($1, 'Envío en duda')", [v2.venta_id]);
    const docs = (await c.query(`select tipo, estado from documentos_dian where venta_id = $1 order by tipo`, [v2.venta_id])).rows;
    assert.deepEqual(docs.map((d) => [d.tipo, d.estado]), [["nota_credito", "pendiente"], ["pos", "pendiente"]]);
  });
});

test("los usuarios no escriben la tabla de miembros directamente", async () => {
  await assert.rejects(como(U.carlos, (c) => c.query(`insert into miembros (empresa_id, user_id, nombre, rol) values ($1, $2, 'x', 'dueno')`, [E.A, U.duenoB])), /permission denied/);
});

// ── Control de inventario (migración 028): ajustes y bajas, conteo físico, kardex
const lotesDe = async (c, producto) => (await c.query(`select lote_id, lote, unidades from v_stock_lotes where producto_id = $1 and unidades > 0 order by lote_id`, [producto])).rows;
/** Dentro de una transacción: la consulta debe fallar con ese mensaje y la transacción sigue utilizable. */
const falla = async (c, sql, params, re) => { await c.query("savepoint f"); await assert.rejects(c.query(sql, params), re); await c.query("rollback to savepoint f"); };
const existencias = async (c, producto) => Number((await c.query(`select coalesce(sum(unidades), 0) u from v_stock_lotes where producto_id = $1`, [producto])).rows[0].u);

test("baja por vencido: resta del lote, numera el acta, guarda lo que había y queda inmutable", async () => {
  await como(U.bodega, async (c) => {
    const [l] = await lotesDe(c, prod.id);
    const r = (await c.query("select registrar_ajuste($1) r", [{ empresa_id: E.A, motivo: "vencido", lineas: [{ lote_id: l.lote_id, unidades: -2 }] }])).rows[0].r;
    assert.ok(r.numero >= 1 && !r.repetida);
    assert.equal((await c.query(`select unidades from v_stock_lotes where lote_id = $1`, [l.lote_id])).rows[0].unidades, l.unidades - 2);
    const a = (await c.query(`select a.motivo, al.unidades, al.antes from ajustes a join ajuste_lineas al on al.ajuste_id = a.id where a.id = $1`, [r.id])).rows;
    assert.deepEqual(a, [{ motivo: "vencido", unidades: -2, antes: l.unidades }]);
    const m = (await c.query(`select tipo, motivo, cantidad from movimientos where ref_id = $1`, [r.id])).rows;
    assert.deepEqual(m, [{ tipo: "ajuste", motivo: "Vencido", cantidad: -2 }]);
    await falla(c, `update ajustes set motivo = 'otro' where id = $1`, [r.id], /permission denied/);
    await c.query("reset role"); // ni la conexión del servidor puede cambiarlo
    await falla(c, `update ajuste_lineas set unidades = -1 where ajuste_id = $1`, [r.id], /no se modifican/);
    await falla(c, `delete from ajustes where id = $1`, [r.id], /no se modifican/);
  });
});

test("ajustes: motivo de la lista, «Otro» con detalle, las bajas no suman, sin negativos, la cajera y otra empresa no", async () => {
  const [l] = await como(U.carlos, (c) => lotesDe(c, prod.id));
  const aj = (motivo, unidades, extra = {}) => ({ empresa_id: E.A, motivo, lineas: [{ lote_id: l.lote_id, unidades }], ...extra });
  await assert.rejects(como(U.carlos, (c) => c.query("select registrar_ajuste($1)", [aj("porque si", -1)])), /motivo/);
  await assert.rejects(como(U.carlos, (c) => c.query("select registrar_ajuste($1)", [aj("otro", -1)])), /detalle/);
  await assert.rejects(como(U.carlos, (c) => c.query("select registrar_ajuste($1)", [aj("perdida", 3)])), /resta unidades/);
  await assert.rejects(como(U.carlos, (c) => c.query("select registrar_ajuste($1)", [aj("conteo", -(l.unidades + 1))])), /negativo/);
  await assert.rejects(como(U.cajera, (c) => c.query("select registrar_ajuste($1)", [aj("perdida", -1)])), /permiso|ajustan/);
  await assert.rejects(como(U.duenoB, (c) => c.query("select registrar_ajuste($1)", [{ ...aj("perdida", -1), empresa_id: E.B }])), /Lote no válido/);
  await como(U.carlos, async (c) => {
    const r = (await c.query("select registrar_ajuste($1) r", [aj("otro", -1, { detalle: "Muestra para el médico", idem_key: "aj-prueba-1" })])).rows[0].r;
    const otra = (await c.query("select registrar_ajuste($1) r", [aj("otro", -1, { detalle: "Muestra para el médico", idem_key: "aj-prueba-1" })])).rows[0].r;
    assert.equal(otra.id, r.id); assert.equal(otra.repetida, true);
    const suma = (await c.query("select registrar_ajuste($1) r", [aj("conteo", 4)])).rows[0].r;
    assert.equal(suma.numero, r.numero + 1);
    assert.equal((await c.query(`select unidades from v_stock_lotes where lote_id = $1`, [l.lote_id])).rows[0].unidades, l.unidades - 1 + 4);
  });
});

test("kardex: saldo acumulado que cuadra con las existencias tras venta, devolución, anulación y ajuste", async () => {
  await como(U.carlos, async (c) => {
    const v = (await c.query("select registrar_venta($1) r", [venta([{ producto_id: prod.id, presentacion: "unidad", cantidad: 3 }], { pagos: [{ medio: "efectivo", valor: 100000 }] })])).rows[0].r;
    await c.query("select devolver_venta($1)", [{ venta_id: v.venta_id, motivo: "Prueba kardex", lineas: [{ producto_id: prod.id, presentacion: "unidad", cantidad: 1 }] }]);
    const v2 = (await c.query("select registrar_venta($1) r", [venta([{ producto_id: prod.id, presentacion: "unidad", cantidad: 1 }], { pagos: [{ medio: "efectivo", valor: 100000 }] })])).rows[0].r;
    await c.query("select anular_venta($1, 'Prueba kardex')", [v2.venta_id]);
    const [l] = await lotesDe(c, prod.id);
    await c.query("select registrar_ajuste($1)", [{ empresa_id: E.A, motivo: "averia", lineas: [{ lote_id: l.lote_id, unidades: -1 }] }]);
    const k = (await c.query("select * from kardex($1)", [prod.id])).rows;
    assert.equal(k.at(-1).saldo, await existencias(c, prod.id), "el saldo final es igual a las existencias");
    let saldo = 0; for (const f of k) { saldo += f.entrada - f.salida; assert.equal(f.saldo, saldo); }
    const tipos = new Set(k.map((f) => f.tipo));
    for (const t of ["inicial", "venta", "devolucion", "anulacion", "ajuste"]) assert.ok(tipos.has(t), `kardex con ${t}`);
    assert.ok(k.some((f) => f.tipo === "venta" && f.documento === v.prefijo + v.numero), "la venta muestra su prefijo y número");
    assert.ok(k.some((f) => f.tipo === "ajuste" && /Ajuste N\.º \d+ · Avería o rotura/.test(f.documento)), "el ajuste muestra número y motivo");
    // Por lote y por rango: el saldo sigue siendo el de toda la historia
    const kl = (await c.query("select * from kardex($1, null, null, $2)", [prod.id, l.lote_id])).rows;
    assert.equal(kl.at(-1).saldo, (await c.query(`select unidades from v_stock_lotes where lote_id = $1`, [l.lote_id])).rows[0].unidades);
    const hoy = (await c.query("select * from kardex($1, current_date, current_date)", [prod.id])).rows;
    assert.ok(hoy.length >= 5 && hoy.at(-1).saldo === k.at(-1).saldo, `${hoy.length} movimientos hoy`);
  });
  assert.equal((await como(U.duenoB, (c) => c.query("select * from kardex($1)", [prod.id]))).rows.length, 0, "otra empresa no ve el kardex");
});

test("conteo físico: diferencias, lote nuevo, cierre en un ajuste que deja existencias = contadas, y cerrado inmodificable", async () => {
  await como(U.bodega, async (c) => {
    const lab = (await c.query(`select laboratorio from productos where id = $1`, [prod.id])).rows[0].laboratorio;
    const k = (await c.query("select iniciar_conteo($1) r", [{ empresa_id: E.A, sede_id: S.A, alcance: "laboratorio", filtro: lab }])).rows[0].r;
    assert.ok(k.lotes >= 2);
    await falla(c, "select iniciar_conteo($1)", [{ empresa_id: E.A, sede_id: S.A }], /Ya hay un conteo abierto/);
    const [l1, l2] = await lotesDe(c, prod.id);
    await c.query("select contar_conteo($1)", [{ conteo_id: k.id, lote_id: l1.lote_id, modo: "sumar", cantidad: 1 }]);
    const s2 = (await c.query("select contar_conteo($1) r", [{ conteo_id: k.id, lote_id: l1.lote_id, modo: "sumar", cantidad: 1 }])).rows[0].r;
    assert.equal(s2.contado, 2);
    await c.query("select contar_conteo($1)", [{ conteo_id: k.id, lote_id: l2.lote_id, modo: "fijar", cantidad: l2.unidades + 3 }]);
    const nuevo = (await c.query("select contar_conteo($1) r", [{ conteo_id: k.id, producto_id: prod.id, lote: "nuevo-cx1", vence: "2030-01-31", modo: "fijar", cantidad: 5 }])).rows[0].r;
    assert.equal(nuevo.lote, "NUEVO-CX1"); assert.equal(nuevo.sistema, 0);
    await falla(c, "select contar_conteo($1)", [{ conteo_id: k.id, producto_id: prod.id, lote: "SINFECHA", modo: "fijar", cantidad: 1 }], /vencimiento/);
    // Una venta entre el conteo y el cierre: el cierre compara con las existencias de ese momento
    await c.query("reset role"); await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: U.carlos, role: "authenticated" })]); await c.query("set local role authenticated");
    await c.query("select registrar_venta($1)", [venta([{ producto_id: prod.id, presentacion: "unidad", cantidad: 1 }], { pagos: [{ medio: "efectivo", valor: 100000 }] })]);
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: U.bodega, role: "authenticated" })]);
    const sinContarAntes = (await c.query(`select lote_id, (select unidades from v_stock_lotes s where s.lote_id = cl.lote_id) u from conteo_lineas cl where conteo_id = $1 and contado is null`, [k.id])).rows;
    const r = (await c.query("select cerrar_conteo($1) r", [k.id])).rows[0].r;
    assert.ok(r.ajuste_numero >= 1 && r.con_diferencia >= 2);
    const lineas = (await c.query(`select cl.lote_id, cl.contado, cl.sistema, s.unidades from conteo_lineas cl join v_stock_lotes s on s.lote_id = cl.lote_id where cl.conteo_id = $1 and cl.contado is not null`, [k.id])).rows;
    for (const x of lineas) assert.equal(x.unidades, x.contado, "existencias = contado");
    for (const x of sinContarAntes) assert.equal((await c.query(`select unidades from v_stock_lotes where lote_id = $1`, [x.lote_id])).rows[0].unidades, x.u, "lo no contado no se toca");
    assert.equal((await c.query(`select motivo, conteo_id from ajustes where id = $1`, [r.ajuste_id])).rows[0].motivo, "conteo");
    assert.equal(Number((await c.query(`select count(distinct ref_id) n from movimientos where ref_id = $1`, [r.ajuste_id])).rows[0].n), 1, "un solo ajuste");
    await falla(c, "select contar_conteo($1)", [{ conteo_id: k.id, lote_id: l1.lote_id, modo: "sumar", cantidad: 1 }], /cerrado/);
    await falla(c, "select cerrar_conteo($1)", [k.id], /ya está cerrado/);
  });
  // Ni siquiera la conexión del servidor puede cambiar un conteo cerrado
  // (se guarda de verdad: un lote contado igual al sistema, así no cambia ninguna existencia de la demo)
  const id = await como(U.bodega, async (c) => {
    const lab = (await c.query(`select laboratorio from productos where id = $1`, [prod.id])).rows[0].laboratorio;
    const k = (await c.query("select iniciar_conteo($1) r", [{ empresa_id: E.A, sede_id: S.A, alcance: "laboratorio", filtro: lab }])).rows[0].r;
    const [l] = await lotesDe(c, prod.id);
    await c.query("select contar_conteo($1)", [{ conteo_id: k.id, lote_id: l.lote_id, modo: "fijar", cantidad: l.unidades }]);
    const r = (await c.query("select cerrar_conteo($1) r", [k.id])).rows[0].r;
    assert.equal(r.con_diferencia, 0); assert.equal(r.ajuste_id, null);
    return k.id;
  }, { commit: true });
  await assert.rejects(pool.query(`update conteos set observaciones = 'x' where id = $1`, [id]), /cerrado no se modifica/);
  await assert.rejects(pool.query(`update conteo_lineas set contado = 1 where conteo_id = $1`, [id]), /cerrado no se modifica/);
  await assert.rejects(pool.query(`delete from conteos where id = $1`, [id]), /no se borran/);
});

test("conteo: la cajera no cuenta y otra empresa no ve los conteos", async () => {
  await assert.rejects(como(U.cajera, (c) => c.query("select iniciar_conteo($1)", [{ empresa_id: E.A, sede_id: S.A }])), /permiso|conteos/);
  assert.equal((await como(U.duenoB, (c) => c.query("select * from conteos where empresa_id = $1", [E.A]))).rows.length, 0);
  assert.equal((await como(U.duenoB, (c) => c.query("select * from ajustes where empresa_id = $1", [E.A]))).rows.length, 0);
});

test("temperatura: bodega registra, fuera de rango exige acción, una jornada por área y la corrección no borra", async () => {
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
  const reg = (extra) => ({ empresa_id: E.A, sede_id: S.A, fecha: hoy, jornada: "manana", area: "general", temperatura: 22.5, humedad: 55, ...extra });
  await como(U.bodega, async (c) => {
    const r = (await c.query("select registrar_temperatura($1) r", [reg({})])).rows[0].r;
    assert.equal(r.fuera_rango, false);
    await assert.rejects(c.query("savepoint s1").then(() => c.query("select registrar_temperatura($1)", [reg({ temperatura: 23 })])), /ya está registrada/);
    await c.query("rollback to savepoint s1");
    await assert.rejects(c.query("savepoint s2").then(() => c.query("select registrar_temperatura($1)", [reg({ area: "frio", temperatura: 12, humedad: null })])), /acción correctiva/);
    await c.query("rollback to savepoint s2");
    const f = (await c.query("select registrar_temperatura($1) r", [reg({ area: "frio", temperatura: 12, humedad: null, accion: "Se movieron los productos a la otra nevera" })])).rows[0].r;
    assert.equal(f.fuera_rango, true);
    const k = (await c.query("select registrar_temperatura($1) r", [{ empresa_id: E.A, anula_id: r.id, temperatura: 23, humedad: 54, motivo: "Se anotó mal" }])).rows[0].r;
    const filas = (await c.query("select id, anula_id, temperatura::float t from temperatura_registros where empresa_id = $1 and fecha = $2 and area = 'general' order by creado", [E.A, hoy])).rows;
    assert.deepEqual(filas.map((x) => x.t), [22.5, 23]);
    assert.equal(filas[1].id, k.id); assert.equal(filas[1].anula_id, r.id);
    await assert.rejects(c.query("savepoint s3").then(() => c.query("update temperatura_registros set temperatura = 1 where id = $1", [r.id])), /permission denied|no se modifican/);
    await c.query("rollback to savepoint s3");
    await assert.rejects(c.query("savepoint s4").then(() => c.query("delete from temperatura_registros where id = $1", [r.id])), /permission denied|no se modifican/);
  });
});

test("temperatura: la cajera no registra, el dueño de B no ve la planilla de A y la bodega no cambia rangos", async () => {
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
  await assert.rejects(como(U.cajera, (c) => c.query("select registrar_temperatura($1)", [{ empresa_id: E.A, sede_id: S.A, fecha: hoy, jornada: "tarde", area: "general", temperatura: 20, humedad: 50 }])), /permiso/);
  await assert.rejects(como(U.bodega, (c) => c.query("select configurar_rango_temperatura($1, 'general', 15, 28, 30, 70)", [E.A])), /dueño o el administrador/);
  await como(U.carlos, async (c) => {
    await c.query("select configurar_rango_temperatura($1, 'general', 15, 28, 30, 70)", [E.A]);
    const g = (await c.query("select temp_max::float, personalizado from rangos_temperatura($1) where area = 'general'", [E.A])).rows[0];
    assert.deepEqual(g, { temp_max: 28, personalizado: true });
    await c.query("select registrar_temperatura($1)", [{ empresa_id: E.A, sede_id: S.A, fecha: hoy, jornada: "tarde", area: "general", temperatura: 20, humedad: 50 }]);
  }, { commit: false });
  const visto = await como(U.duenoB, async (c) => (await c.query("select count(*)::int n from temperatura_registros where empresa_id = $1", [E.A])).rows[0].n);
  assert.equal(visto, 0);
  const cajera = await como(U.cajera, async (c) => (await c.query("select count(*)::int n from temperatura_rangos")).rows[0].n);
  assert.equal(cajera, 0);
});
