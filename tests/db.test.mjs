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
    where p.empresa_id = $1 and p.unidades_por_caja > 1 and p.precio_unidad is not null and not p.requiere_formula
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
    // Un lote vencido con existencias (la demo no los tiene: se crea dentro de esta transacción, que se deshace).
    await c.query("reset role");
    const lv = (await c.query(`insert into lotes (empresa_id, sede_id, producto_id, lote, vence) values ($1, $2, $3, 'VENCIDO-T', current_date - 10) returning id`, [E.A, S.A, prod.id])).rows[0].id;
    await c.query(`insert into movimientos (empresa_id, sede_id, producto_id, lote_id, cantidad, tipo, motivo) values ($1, $2, $3, $4, 6, 'inicial', 'Prueba')`, [E.A, S.A, prod.id, lv]);
    await c.query("set local role authenticated");
    const l = { lote_id: lv, unidades: 6 };
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
    // Lo vendido después de contar cada lote (existencias al contar − existencias al cerrar) no vuelve al inventario.
    const antesCierre = (await c.query(`select cl.lote_id, cl.contado, cl.sistema_al_contar, coalesce((select unidades from v_stock_lotes s where s.lote_id = cl.lote_id), 0) u
      from conteo_lineas cl where cl.conteo_id = $1 and cl.contado is not null`, [k.id])).rows;
    const r = (await c.query("select cerrar_conteo($1) r", [k.id])).rows[0].r;
    assert.ok(r.ajuste_numero >= 1 && r.con_diferencia >= 2);
    for (const x of antesCierre) {
      const ahora = Number((await c.query(`select coalesce((select unidades from v_stock_lotes where lote_id = $1), 0) u`, [x.lote_id])).rows[0].u);
      assert.equal(ahora, x.contado - (x.sistema_al_contar - x.u), "existencias = contado − lo vendido después de contar");
    }
    for (const x of sinContarAntes) assert.equal((await c.query(`select unidades from v_stock_lotes where lote_id = $1`, [x.lote_id])).rows[0].unidades, x.u, "lo no contado no se toca");
    assert.equal((await c.query(`select motivo, conteo_id from ajustes where id = $1`, [r.ajuste_id])).rows[0].motivo, "conteo");
    assert.equal(Number((await c.query(`select count(distinct ref_id) n from movimientos where ref_id = $1`, [r.ajuste_id])).rows[0].n), 1, "un solo ajuste");
    await falla(c, "select contar_conteo($1)", [{ conteo_id: k.id, lote_id: l1.lote_id, modo: "sumar", cantidad: 1 }], /ya está (cerrado|anulado)/);
    await falla(c, "select cerrar_conteo($1)", [k.id], /ya está (cerrado|anulado)/);
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

// ── Control especial y venta con fórmula (migración 030)
const FORMULA = { verificada: true, paciente_tipo_doc: "CC", paciente_doc: "1012345678", paciente_nombre: "Paciente de Prueba", medico_nombre: "Médica de Prueba", medico_registro: "RM 12345", formula_numero: "F-1" };
const hace = (n) => new Date(Date.now() - n * 864e5).toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
const comoEn = (c, uid) => c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })]);
async function productoControlado(c, control = true) {
  const id = (await c.query(`insert into productos (empresa_id, nombre, iva, unidades_por_caja, precio_caja, control_especial) values ($1, 'Prueba controlado', 0, 1, 1000, $2) returning id`, [E.A, control])).rows[0].id;
  if (!control) await c.query(`update productos set requiere_formula = true where id = $1`, [id]);
  await c.query(`select registrar_entrada(jsonb_build_object('empresa_id', $1::uuid, 'sede_id', $2::uuid, 'tipo', 'compra', 'lineas', jsonb_build_array(
    jsonb_build_object('producto_id', $3::uuid, 'lote', 'CE1', 'vence', (current_date + 300)::text, 'unidades', 10))))`, [E.A, S.A, id]);
  return id;
}

test("control especial implica fórmula y el cambio de marca queda en la auditoría", async () => {
  await como(U.carlos, async (c) => {
    const id = (await c.query(`insert into productos (empresa_id, nombre, iva, unidades_por_caja, precio_caja, control_especial) values ($1, 'Prueba marca', 0, 1, 1000, true) returning id`, [E.A])).rows[0].id;
    assert.equal((await c.query(`select requiere_formula from productos where id = $1`, [id])).rows[0].requiere_formula, true);
    await c.query(`update productos set control_especial = false, requiere_formula = false where id = $1`, [id]);
    const a = (await c.query(`select datos from auditoria where entidad_id = $1 and accion = 'cambio_formula'`, [id])).rows;
    assert.equal(a.length, 1);
    assert.deepEqual(a[0].datos.despues, { formula: false, control: false });
  });
});

test("control especial: sin fórmula la venta no se confirma (aunque se llame directo a la base)", async () => {
  await assert.rejects(como(U.carlos, async (c) => {
    const id = await productoControlado(c);
    await c.query("select registrar_venta($1)", [venta([{ producto_id: id, presentacion: "caja", cantidad: 1 }], { pagos: [{ medio: "efectivo", valor: 1000 }] })]);
    await c.query("set constraints all immediate"); // lo que pasaría al confirmar la transacción
  }), /fórmula médica/);
});

test("control especial: datos obligatorios, fecha no futura y vigencia de la droguería", async () => {
  const intento = (datos) => como(U.carlos, async (c) => {
    const id = await productoControlado(c);
    const v = (await c.query("select registrar_venta($1) r", [venta([{ producto_id: id, presentacion: "caja", cantidad: 1 }], { pagos: [{ medio: "efectivo", valor: 1000 }] })])).rows[0].r;
    return (await c.query("select registrar_formulas_venta($1, $2) n", [v.venta_id, datos])).rows[0].n;
  });
  await assert.rejects(intento({ ...FORMULA, paciente_nombre: "" }), /nombre completo del paciente/);
  await assert.rejects(intento({ ...FORMULA, medico_registro: "", formula_fecha: hace(1) }), /registro profesional/);
  await assert.rejects(intento({ ...FORMULA, formula_fecha: hace(-1) }), /posterior a hoy/);
  await assert.rejects(intento({ ...FORMULA, formula_fecha: hace(31) }), /ya no está vigente: tiene más de 30 días/);
  assert.equal(await intento({ ...FORMULA, formula_fecha: hace(30) }), 1);
});

test("control especial: el libro tiene la dispensación con su lote; la anulación es un reintegro y nada se borra", async () => {
  await como(U.carlos, async (c) => {
    const id = await productoControlado(c);
    await comoEn(c, U.cajera);
    const v = (await c.query("select registrar_venta($1) r", [venta([{ producto_id: id, presentacion: "caja", cantidad: 3 }], { pagos: [{ medio: "efectivo", valor: 3000 }] })])).rows[0].r;
    assert.equal((await c.query("select registrar_formulas_venta($1, $2) n", [v.venta_id, { ...FORMULA, formula_fecha: hace(2) }])).rows[0].n, 1);
    assert.equal((await c.query("select registrar_formulas_venta($1, $2) n", [v.venta_id, { ...FORMULA, formula_fecha: hace(2) }])).rows[0].n, 0, "un reintento no duplica");
    await c.query("set constraints all immediate");
    assert.equal((await c.query("select count(*)::int n from venta_formulas")).rows[0].n, 0, "la cajera no lee los datos de pacientes");
    assert.equal((await c.query("select count(*)::int n from v_libro_control")).rows[0].n, 0, "ni el libro");
    await comoEn(c, U.carlos);
    const d = (await c.query(`select l.tipo, l.salida, lo.lote, l.paciente_doc, l.prefijo || l.numero venta from v_libro_control l join lotes lo on lo.id = l.lote_id where l.venta_id = $1`, [v.venta_id])).rows;
    assert.deepEqual(d, [{ tipo: "dispensacion", salida: 3, lote: "CE1", paciente_doc: "1012345678", venta: v.prefijo + v.numero }]);
    await c.query("select anular_venta($1, 'Error de digitación')", [v.venta_id]);
    const l = (await c.query(`select tipo, salida, reintegro, motivo from v_libro_control where venta_id = $1 order by tipo`, [v.venta_id])).rows;
    assert.deepEqual(l.map((x) => [x.tipo, x.salida, x.reintegro]), [["dispensacion", 3, 0], ["reintegro", 0, 3]]);
    assert.match(l[1].motivo, /Anulación de la venta: Error de digitación/);
    await c.query("reset role");
    await assert.rejects(c.query(`update venta_formulas set paciente_nombre = 'Otro' where venta_id = $1`, [v.venta_id]), /no se modifican ni se borran/);
  });
});

test("control especial: la fórmula no se agrega después de la venta, ni la registra otro usuario ni otra empresa", async () => {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await comoEn(c, U.carlos); await c.query("set local role authenticated");
    const id = await productoControlado(c, false); // venta con fórmula sin control: basta confirmar
    const v = (await c.query("select registrar_venta($1) r", [venta([{ producto_id: id, presentacion: "caja", cantidad: 1 }], { pagos: [{ medio: "efectivo", valor: 1000 }] })])).rows[0].r;
    await c.query("savepoint s");
    await comoEn(c, U.duenoB);
    await assert.rejects(c.query("select registrar_formulas_venta($1, $2)", [v.venta_id, { verificada: true }]), /permiso/);
    await c.query("rollback to savepoint s");
    await c.query("savepoint s");
    await comoEn(c, U.carlos);
    await assert.rejects(c.query("select registrar_formulas_venta($1, $2)", [v.venta_id, { verificada: false }]), /confirma que la verificaste/);
    await c.query("rollback to savepoint s");
    assert.equal((await c.query("select registrar_formulas_venta($1, $2) n", [v.venta_id, { verificada: true }])).rows[0].n, 1);
    const f = (await c.query("select control, verificada, paciente_doc from venta_formulas where venta_id = $1", [v.venta_id])).rows[0];
    assert.deepEqual(f, { control: false, verificada: true, paciente_doc: null });
    // Una venta vieja (otra transacción) no recibe fórmula a posteriori.
    const vieja = (await c.query(`select id from ventas where empresa_id = $1 and creado < now() - interval '1 day' limit 1`, [E.A])).rows[0].id;
    await assert.rejects(c.query("select registrar_formulas_venta($1, $2)", [vieja, FORMULA]), /momento de la venta/);
  } finally { await c.query("rollback").catch(() => {}); c.release(); }
});

test("vigencia configurable solo por dueño o administrador, nunca en la demo", async () => {
  await assert.rejects(como(U.cajera, (c) => c.query("select configurar_formulas($1, 15, false)", [E.A])), /dueño o el administrador/);
  await assert.rejects(como(U.carlos, (c) => c.query("select configurar_formulas($1, 15, false)", [E.A])), /demostración/);
  await assert.rejects(como(U.duenoB, (c) => c.query("select configurar_formulas($1, 0, false)", [E.B])), /entre 1 y 365/);
  const r = await como(U.duenoB, async (c) => { await c.query("select configurar_formulas($1, 15, true)", [E.B]); return (await c.query("select formula_vigencia_dias, formula_exige_datos from empresas where id = $1", [E.B])).rows[0]; });
  assert.deepEqual(r, { formula_vigencia_dias: 15, formula_exige_datos: true });
});

// ── Correcciones del Bloque 1 (migración 030a)
test("conteo: una venta hecha tras contar un lote no se devuelve al inventario al cerrar", async () => {
  await como(U.carlos, async (c) => {
    const lab = (await c.query(`select laboratorio from productos where id = $1`, [prod.id])).rows[0].laboratorio;
    const k = (await c.query("select iniciar_conteo($1) r", [{ empresa_id: E.A, sede_id: S.A, alcance: "laboratorio", filtro: lab }])).rows[0].r;
    const lotes = await lotesDe(c, prod.id);
    for (const l of lotes) await c.query("select contar_conteo($1)", [{ conteo_id: k.id, lote_id: l.lote_id, modo: "fijar", cantidad: l.unidades }]);
    const antes = await existencias(c, prod.id);
    await c.query("select registrar_venta($1)", [venta([{ producto_id: prod.id, presentacion: "unidad", cantidad: 3 }], { pagos: [{ medio: "efectivo", valor: 100000 }] })]);
    const r = (await c.query("select cerrar_conteo($1) r", [k.id])).rows[0].r;
    assert.equal(await existencias(c, prod.id), antes - 3, "las 3 vendidas siguen descontadas");
    assert.equal(r.con_diferencia, 0, "contado igual a lo que había al contar: sin diferencia");
  });
});

test("conteo: se anula (solo gerencia, con motivo), no toca existencias, libera la sede y queda inmodificable", async () => {
  const id = await como(U.carlos, async (c) => {
    const k = (await c.query("select iniciar_conteo($1) r", [{ empresa_id: E.A, sede_id: S.A }])).rows[0].r;
    const [l] = await lotesDe(c, prod.id);
    await c.query("select contar_conteo($1)", [{ conteo_id: k.id, lote_id: l.lote_id, modo: "fijar", cantidad: l.unidades + 50 }]);
    const antes = await existencias(c, prod.id);
    await falla(c, "select anular_conteo($1, $2)", [k.id, "no"], /motivo/);
    const r = (await c.query("select anular_conteo($1, $2) r", [k.id, "Se empezó con el filtro equivocado"])).rows[0].r;
    assert.equal(r.estado, "anulado");
    assert.equal(await existencias(c, prod.id), antes, "anular no cambia existencias");
    await falla(c, "select contar_conteo($1)", [{ conteo_id: k.id, lote_id: l.lote_id, modo: "sumar", cantidad: 1 }], /ya está (cerrado|anulado)/);
    await falla(c, "select cerrar_conteo($1)", [k.id], /ya está (cerrado|anulado)/);
    const otro = (await c.query("select iniciar_conteo($1) r", [{ empresa_id: E.A, sede_id: S.A }])).rows[0].r;
    assert.ok(otro.id, "la sede queda libre para otro conteo");
    await c.query("select anular_conteo($1, $2)", [otro.id, "Prueba de anulación"]);
    return k.id;
  }, { commit: true });
  await assert.rejects(pool.query(`update conteos set motivo_anulacion = 'x' where id = $1`, [id]), /no se modifica/);
  await como(U.bodega, async (c) => {
    const k = (await c.query("select iniciar_conteo($1) r", [{ empresa_id: E.A, sede_id: S.A }])).rows[0].r;
    await falla(c, "select anular_conteo($1, $2)", [k.id, "La bodega no anula"], /dueño o el administrador/);
  });
  await assert.rejects(como(U.duenoB, (c) => c.query("select anular_conteo($1, $2)", [id, "Otra empresa"])), /dueño o el administrador/);
});

test("conteo: el cierre no tiene tope de lotes; la pantalla de ajustes sí (2.000)", async () => {
  await como(U.carlos, async (c) => {
    const [l] = await lotesDe(c, prod.id);
    const muchas = Array.from({ length: 2001 }, () => ({ lote_id: l.lote_id, unidades: -1 }));
    await falla(c, "select registrar_ajuste($1)", [{ empresa_id: E.A, motivo: "perdida", lineas: muchas }], /Máximo 2\.000 lotes/);
  });
  const def = (await pool.query(`select pg_get_functiondef('cerrar_conteo'::regproc) d`)).rows[0].d;
  assert.match(def, /aplicar_ajuste\([^)]*, null, null\)/, "cerrar_conteo llama a aplicar_ajuste sin tope");
});

test("baja «Vencido» solo para lotes vencidos", async () => {
  await como(U.carlos, async (c) => {
    const l = (await c.query(`select s.lote_id, l.lote from v_stock_lotes s join lotes l on l.id = s.lote_id where s.producto_id = $1 and s.unidades > 0 and l.vence >= current_date + 1 limit 1`, [prod.id])).rows[0];
    await falla(c, "select registrar_ajuste($1)", [{ empresa_id: E.A, motivo: "vencido", lineas: [{ lote_id: l.lote_id, unidades: -1 }] }], /todavía no está vencido/);
  });
});

test("la consola elimina una droguería de prueba con ajustes, conteos y planilla de temperatura", async () => {
  await como(U.duenoB, async (c) => {
    await c.query("reset role");
    const sede = (await c.query(`select id from sedes where empresa_id = $1 limit 1`, [E.B])).rows[0].id;
    const p = (await c.query(`insert into productos (empresa_id, nombre, precio_caja) values ($1, 'Producto de prueba B', 1000) returning id`, [E.B])).rows[0].id;
    await c.query("set local role authenticated");
    await c.query("select registrar_entrada($1)", [{ empresa_id: E.B, sede_id: sede, tipo: "compra", motivo: "Compra de prueba", lineas: [{ producto_id: p, lote: "LB1", vence: "2030-12-31", unidades: 10 }] }]);
    const l = (await c.query(`select lote_id from v_stock_lotes where producto_id = $1`, [p])).rows[0].lote_id;
    await c.query("select registrar_ajuste($1)", [{ empresa_id: E.B, motivo: "averia", lineas: [{ lote_id: l, unidades: -1 }] }]);
    const k = (await c.query("select iniciar_conteo($1) r", [{ empresa_id: E.B, sede_id: sede }])).rows[0].r;
    await c.query("select contar_conteo($1)", [{ conteo_id: k.id, lote_id: l, modo: "fijar", cantidad: 7 }]);
    await c.query("select cerrar_conteo($1)", [k.id]);
    await c.query("select registrar_temperatura($1)", [{ empresa_id: E.B, sede_id: sede, jornada: "manana", area: "general", temperatura: 20, humedad: 50, fecha: (await c.query("select (now() at time zone 'America/Bogota')::date::text d")).rows[0].d }]);
    await c.query("reset role");
    await c.query(`update empresas set estado = 'suspendida' where id = $1`, [E.B]);
    await c.query("select eliminar_empresa_prueba($1)", [E.B]);
    assert.equal((await c.query(`select count(*)::int n from empresas where id = $1`, [E.B])).rows[0].n, 0);
    assert.equal((await c.query(`select count(*)::int n from ajustes where empresa_id = $1`, [E.B])).rows[0].n, 0);
  });
});

test("el kardex filtra por la empresa del producto (no recorre el índice de todas las droguerías)", async () => {
  const def = (await pool.query(`select pg_get_functiondef('kardex'::regproc) d`)).rows[0].d;
  assert.match(def, /m\.empresa_id = \(select pr\.empresa_id from productos pr where pr\.id = p_producto\)/);
});

// ───────────── Compras, proveedores y cuentas por pagar (031)
const proveedorDe = async (c, emp, nombre) => (await c.query(`insert into proveedores (empresa_id, nombre, plazo_dias) values ($1, $2, 30)
  on conflict (empresa_id, lower(trim(nombre))) do update set nombre = excluded.nombre returning id`, [emp, nombre])).rows[0].id;
const compra = (prov, lineas, extra = {}) => ({ empresa_id: E.A, sede_id: S.A, proveedor_id: prov, numero_factura: "FV-" + crypto.randomUUID().slice(0, 8),
  fecha_factura: new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" }), condicion: "credito", lineas, ...extra });
const vence = "2031-06-30";

test("compra: totales al centavo, costo del lote sin IVA, bonificadas prorratean, promedio ponderado al repetir lote", async () => {
  await como(U.carlos, async (c) => {
    const prov = await proveedorDe(c, E.A, "Proveedor prueba BD");
    const upc = prod.unidades_por_caja, s0 = await existencias(c, prod.id);
    const r = (await c.query("select registrar_compra($1) r", [compra(prov, [
      { producto_id: prod.id, lote: "CMP-A", vence, unidades: 2 * upc, costo: 10000.5, costo_por: "caja", iva_pct: 0 },
      { producto_id: prod.id, lote: "CMP-B", vence, unidades: 10, costo: 1234.56, costo_por: "unidad", descuento_pct: 5, iva_pct: 19 },
      { producto_id: prod.id, lote: "CMP-C", vence, unidades: 5, bonificadas: 1, costo: 3000, costo_por: "unidad", iva_pct: 0 },
    ], { total_papel: 48957.7 })])).rows[0].r;
    assert.equal(r.estado, "registrada");
    const k = (await c.query(`select subtotal::float, descuento::float, iva::float, total::float, diferencia::float from compras where id = $1`, [r.id])).rows[0];
    assert.deepEqual(k, { subtotal: 47346.6, descuento: 617.28, iva: 2228.38, total: 48957.7, diferencia: 0 });
    assert.equal(await existencias(c, prod.id), s0 + 2 * upc + 10 + 6);
    const costo = async (lote) => Number((await c.query(`select lc.costo_unidad from lote_costos lc join lotes l on l.id = lc.lote_id where l.producto_id = $1 and l.lote = $2`, [prod.id, lote])).rows[0].costo_unidad);
    assert.equal(await costo("CMP-A"), Math.round(10000.5 / upc * 10000) / 10000);
    assert.equal(await costo("CMP-B"), 1172.832, "sin IVA y con descuento");
    assert.equal(await costo("CMP-C"), 2500, "las bonificadas prorratean el costo");
    const m = (await c.query(`select tipo, motivo from movimientos where ref_id = $1`, [r.id])).rows;
    assert.equal(m.length, 3); assert.ok(m.every((x) => x.tipo === "compra" && /Compra N\.º \d+ · Proveedor prueba BD · factura FV-/.test(x.motivo)));
    // El mismo lote vuelve a llegar: promedio ponderado (6 × 2.500 + 4 × 3.500) / 10 = 2.900
    await c.query("select registrar_compra($1)", [compra(prov, [{ producto_id: prod.id, lote: "cmp-c", vence, unidades: 4, costo: 3500, costo_por: "unidad", iva_pct: 0 }])]);
    assert.equal(await costo("CMP-C"), 2900);
    assert.equal((await c.query(`select heredado from lote_costos lc join lotes l on l.id = lc.lote_id where l.lote = 'CMP-C'`)).rows[0].heredado, false);
    // Factura repetida del mismo proveedor
    const f = (await c.query(`select numero_factura from compras where id = $1`, [r.id])).rows[0].numero_factura;
    await falla(c, "select registrar_compra($1)", [compra(prov, [{ producto_id: prod.id, lote: "X1", vence, unidades: 1, costo: 1, costo_por: "unidad" }], { numero_factura: f.toLowerCase() })], /ya está registrada/);
    await falla(c, "select registrar_compra($1)", [compra(prov, [{ producto_id: prod.id, lote: "X1", vence, unidades: 1, costo: 1, costo_por: "unidad" }, { producto_id: prod.id, lote: "X2", vence, unidades: 1 }])], /Falta el costo/);
    // Inmutable
    await falla(c, `update compras set total = 1 where id = $1`, [r.id], /permission denied/);
    await c.query("set constraints all immediate");
    await c.query("reset role");
    await falla(c, `update compras set total = 1, subtotal = 1 where id = $1`, [r.id], /no se cambian/);
    await falla(c, `delete from compra_lineas where compra_id = $1`, [r.id], /no se borran/);
  });
});

test("compra: la bodega registra sin costos (por costear, sin ver dinero) y el dueño completa; la cajera y otra empresa no", async () => {
  const prov = await como(U.carlos, (c) => proveedorDe(c, E.A, "Proveedor bodega BD"), { commit: true });
  const r = await como(U.bodega, async (c) => {
    const r = (await c.query("select registrar_compra($1) r", [compra(prov, [{ producto_id: prod.id, lote: "BOD-1", vence, unidades: 8, costo: 999, costo_por: "unidad" }], { condicion: "contado" })])).rows[0].r;
    assert.equal(r.estado, "por_costear");
    assert.equal((await c.query(`select count(*)::int n from compras`)).rows[0].n, 0, "la bodega no lee la tabla con dinero");
    const v = (await c.query(`select estado, lineas, unidades from v_recepciones where id = $1`, [r.id])).rows[0];
    assert.deepEqual(v, { estado: "por_costear", lineas: 1, unidades: 8 });
    assert.equal((await c.query(`select count(*)::int n from v_cuentas_por_pagar`)).rows[0].n, 0);
    await falla(c, "select completar_costos_compra($1, '{}')", [r.id], /dueño o el administrador/);
    return r;
  }, { commit: true });
  await assert.rejects(como(U.cajera, (c) => c.query("select registrar_compra($1)", [compra(prov, [{ producto_id: prod.id, lote: "Z", vence, unidades: 1 }])])), /registran compras/);
  assert.equal(await como(U.cajera, async (c) => (await c.query(`select count(*)::int n from v_recepciones`)).rows[0].n), 0);
  assert.equal(await como(U.duenoB, async (c) => (await c.query(`select (select count(*) from compras) + (select count(*) from v_recepciones) + (select count(*) from v_cuentas_por_pagar) n`)).rows[0].n), "0");
  await assert.rejects(como(U.duenoB, (c) => c.query("select registrar_compra($1)", [{ ...compra(prov, [{ producto_id: prod.id, lote: "Z", vence, unidades: 1 }]), empresa_id: E.B, sede_id: S.A }])), /Sede no válida|proveedor/);
  await assert.rejects(como(U.duenoB, (c) => c.query("select completar_costos_compra($1, '{}')", [r.id])), /dueño o el administrador/);
  await como(U.carlos, async (c) => {
    const l = (await c.query(`select id from compra_lineas where compra_id = $1`, [r.id])).rows[0];
    const k = (await c.query("select completar_costos_compra($1, $2) r", [r.id, { condicion: "credito", vence_pago: vence.replace("2031", "2027"), lineas: [{ linea_id: l.id, costo: 1500, costo_por: "unidad", iva_pct: 19 }] }])).rows[0].r;
    assert.equal(Number(k.total), 14280);
    const cp = (await c.query(`select saldo::float, condicion from v_cuentas_por_pagar where compra_id = $1`, [r.id])).rows[0];
    assert.deepEqual(cp, { saldo: 14280, condicion: "credito" });
    assert.equal(Number((await c.query(`select lc.costo_unidad from lote_costos lc join lotes l on l.id = lc.lote_id where l.lote = 'BOD-1'`)).rows[0].costo_unidad), 1500);
    await falla(c, "select completar_costos_compra($1, $2)", [r.id, { lineas: [] }], /ya tiene sus costos/);
    // Limpieza: se anula (sin pagos, el stock alcanza)
    await c.query("select anular_compra($1, 'Limpieza de la prueba')", [r.id]);
  }, { commit: true });
});

test("pagos a proveedores: parcial y total (saldo 0), del más antiguo al más nuevo, efectivo exige turno, anular con motivo", async () => {
  await como(U.carlos, async (c) => {
    const prov = await proveedorDe(c, E.A, "Proveedor pagos BD");
    const nueva = async (costo, dias) => (await c.query("select registrar_compra($1) r", [compra(prov, [{ producto_id: prod.id, lote: "PAG-" + costo, vence, unidades: 1, costo, costo_por: "unidad", iva_pct: 0 }],
      { fecha_factura: new Date(Date.now() - dias * 864e5).toLocaleDateString("en-CA", { timeZone: "America/Bogota" }) })])).rows[0].r.id;
    const vieja = await nueva(1000, 20), reciente = await nueva(3000, 2);
    const saldo = async (id) => Number((await c.query(`select saldo from v_cuentas_por_pagar where compra_id = $1`, [id])).rows[0].saldo);
    const p1 = (await c.query("select registrar_pago_proveedor($1) r", [{ empresa_id: E.A, proveedor_id: prov, medio: "transferencia", valor: 1500 }])).rows[0].r;
    assert.equal(await saldo(vieja), 0, "primero la más antigua"); assert.equal(await saldo(reciente), 2500);
    await falla(c, "select registrar_pago_proveedor($1)", [{ empresa_id: E.A, proveedor_id: prov, medio: "transferencia", valor: 2600 }], /supera/);
    await falla(c, "select registrar_pago_proveedor($1)", [{ empresa_id: E.A, proveedor_id: prov, medio: "efectivo", valor: 100, caja_id: C.A }], /abre primero el turno/);
    await falla(c, "select anular_compra($1, 'No se puede')", [vieja], /tiene pagos/);
    const t = (await c.query(`select id from turnos where caja_id = $1 and estado = 'abierto'`, [C.A])).rows[0]?.id ?? (await c.query(`select abrir_turno($1, 0) id`, [C.A])).rows[0].id;
    const antes = Number((await c.query("select resumen_turno($1) r", [t])).rows[0].r.egresos);
    await c.query("select registrar_pago_proveedor($1)", [{ empresa_id: E.A, proveedor_id: prov, medio: "efectivo", valor: 2500, caja_id: C.A, compras: [reciente] }]);
    assert.equal(await saldo(reciente), 0);
    assert.equal(Number((await c.query("select resumen_turno($1) r", [t])).rows[0].r.egresos), antes + 2500, "el egreso sale en el turno");
    await falla(c, "select anular_pago_proveedor($1, '')", [p1.id], /motivo/);
    await c.query("select anular_pago_proveedor($1, 'Transferencia rechazada')", [p1.id]);
    assert.equal(await saldo(vieja), 1000);
    await c.query("set constraints all immediate");
  });
  await assert.rejects(como(U.bodega, (c) => c.query("select registrar_pago_proveedor($1)", [{ empresa_id: E.A, proveedor_id: prod.id, medio: "transferencia", valor: 1 }])), /dueño o el administrador/);
});

test("devolución al proveedor: el stock baja ya, el saldo baja con la nota crédito; anular revierte el stock", async () => {
  await como(U.carlos, async (c) => {
    const prov = await proveedorDe(c, E.A, "Proveedor devoluciones BD");
    const r = (await c.query("select registrar_compra($1) r", [compra(prov, [{ producto_id: prod.id, lote: "DEV-1", vence, unidades: 10, costo: 1000, costo_por: "unidad", iva_pct: 19 }])])).rows[0].r;
    const l = (await c.query(`select id, lote_id from compra_lineas where compra_id = $1`, [r.id])).rows[0];
    const stock = async () => (await c.query(`select unidades from v_stock_lotes where lote_id = $1`, [l.lote_id])).rows[0].unidades;
    const d = (await c.query("select registrar_devolucion_proveedor($1) r", [{ empresa_id: E.A, compra_id: r.id, motivo: "Empaque roto", lineas: [{ compra_linea_id: l.id, unidades: 3 }] }])).rows[0].r;
    assert.equal(Number(d.valor), 3570); assert.equal(await stock(), 7);
    const saldo = async () => Number((await c.query(`select saldo from v_cuentas_por_pagar where compra_id = $1`, [r.id])).rows[0].saldo);
    assert.equal(await saldo(), 11900, "sin nota crédito el saldo no cambia");
    await falla(c, "select registrar_devolucion_proveedor($1)", [{ empresa_id: E.A, compra_id: r.id, motivo: "Otra vez", lineas: [{ compra_linea_id: l.id, unidades: 8 }] }], /ya se devolvieron 3/);
    await c.query("select aplicar_nc_proveedor($1, 'nc-77')", [d.id]);
    assert.equal(await saldo(), 8330);
    await falla(c, "select aplicar_nc_proveedor($1, 'nc-78')", [d.id], /ya tiene su nota/);
    await falla(c, "select anular_compra($1, 'Con devolución')", [r.id], /devoluciones/);
    // Anular una compra sin pagos ni devoluciones revierte el stock; si ya se vendió parte, no deja.
    const r2 = (await c.query("select registrar_compra($1) r", [compra(prov, [{ producto_id: prod.id, lote: "ANU-1", vence, unidades: 4, costo: 100, costo_por: "unidad" }])])).rows[0].r;
    const s0 = await existencias(c, prod.id);
    await c.query("select anular_compra($1, 'Factura equivocada')", [r2.id]);
    assert.equal(await existencias(c, prod.id), s0 - 4);
    assert.equal((await c.query(`select estado from compras where id = $1`, [r2.id])).rows[0].estado, "anulada");
    assert.ok((await c.query(`select 1 from auditoria where entidad_id = $1 and accion = 'anular_compra'`, [r2.id])).rowCount === 1);
    await c.query("set constraints all immediate");
  });
});

// ───────────── 033 · Clientes con cuenta (fiado controlado), recibos de caja y abonos por turno
/** Una sola transacción (que se deshace) en la que se cambia de usuario: `quien(uid)` pasa a ese usuario y `raiz()` vuelve
 *  a la conexión del servidor para preparar datos (cajas, turnos). */
async function escena(fn) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    const quien = async (uid) => { await c.query("reset role"); await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })]); await c.query("set local role authenticated"); };
    const raiz = async () => { await c.query("reset role"); await c.query("select set_config('request.jwt.claims', '', true)"); };
    const falla = async (sql, params) => { await c.query("savepoint f"); try { await c.query(sql, params); await c.query("release savepoint f"); return null; } catch (e) { await c.query("rollback to savepoint f"); return e; } };
    return await fn(c, { quien, raiz, falla });
  } finally { await c.query("rollback").catch(() => {}); c.release(); }
}
const unidadesPara = (valor) => Math.max(1, Math.round(valor / Number(prod.precio_unidad)));
const fiado = (cli, cantidad, extra = {}) => venta([{ producto_id: prod.id, presentacion: "unidad", cantidad }], { tipo_doc: "factura", cliente_id: cli, condicion: "credito", pagos: [], ...extra });

test("cupo: la cajera fía dentro del cupo; pasarse lo bloquea; el dueño lo autoriza con motivo y queda en la auditoría", async () => {
  await escena(async (c, { quien, falla }) => {
    await quien(U.carlos);
    const cli = (await c.query(`insert into clientes (empresa_id, tipo_doc, numero_doc, nombre, email) values ($1, 'CC', '99000111', 'Cliente cupo prueba', 'cupo@prueba.example') returning id`, [E.A])).rows[0].id;
    const u1 = unidadesPara(30000), precio = Number(prod.precio_unidad);
    const cupo = Math.ceil((u1 * precio + precio) / 1000) * 1000; // cabe la primera venta, no una segunda igual
    await c.query("select configurar_credito_cliente($1, $2, 15, false, 'Paga los viernes')", [cli, cupo]);
    await quien(U.cajera);
    const v1 = (await c.query("select registrar_venta($1) r", [fiado(cli, u1)])).rows[0].r;
    assert.equal(v1.credito, true); assert.equal(v1.autorizado, false);
    assert.equal((await c.query("select plazo_dias from ventas where id = $1", [v1.venta_id])).rows[0].plazo_dias, 15, "toma el plazo por defecto del cliente");
    const est = (await c.query("select estado_credito($1, $2) e", [cli, u1 * precio])).rows[0].e;
    assert.equal(est.puede_fiar, false); assert.match(est.motivo, /supera el cupo disponible/); assert.equal(Number(est.cupo_disponible), cupo - Number(v1.total));
    const e1 = await falla("select registrar_venta($1)", [fiado(cli, u1)]);
    assert.match(e1?.message ?? "", /supera el cupo disponible.*solo el dueño o el administrador/);
    assert.equal(e1.code, "P0001");
    await quien(U.carlos);
    const e2 = await falla("select registrar_venta($1)", [fiado(cli, u1)]);
    assert.match(e2?.message ?? "", /escribe el motivo/);
    const v2 = (await c.query("select registrar_venta($1) r", [fiado(cli, u1, { motivo_credito: "Cliente de años, paga el lunes" })])).rows[0].r;
    assert.equal(v2.autorizado, true);
    const aud = (await c.query(`select datos from auditoria where accion = 'credito_autorizado' and entidad_id = $1`, [v2.venta_id])).rows[0];
    assert.equal(aud?.datos.motivo, "Cliente de años, paga el lunes");
    assert.match(aud.datos.razon, /supera el cupo/);
    // Bloqueado: ni la cajera ni el dueño sin motivo.
    await c.query("select configurar_credito_cliente($1, $2, 15, true, null)", [cli, cupo * 10]);
    await quien(U.cajera);
    assert.match((await falla("select registrar_venta($1)", [fiado(cli, 1)]))?.message ?? "", /bloqueado/);
    assert.equal((await c.query("select estado_credito($1) e", [cli])).rows[0].e.motivo, "El crédito de este cliente está bloqueado");
  });
});

test("mora mayor al límite bloquea el fiado; sin cupo la cajera no fía y la gerencia sí (como antes)", async () => {
  await escena(async (c, { quien, raiz, falla }) => {
    await quien(U.carlos);
    const cli = (await c.query(`insert into clientes (empresa_id, tipo_doc, numero_doc, nombre, email) values ($1, 'CC', '99000222', 'Cliente mora prueba', 'mora@prueba.example') returning id`, [E.A])).rows[0].id;
    const v = (await c.query("select registrar_venta($1) r", [fiado(cli, 1, { plazo_dias: 1 })])).rows[0].r; // sin cupo: la gerencia fía
    assert.equal(v.autorizado, false);
    await quien(U.cajera);
    const sin = await falla("select registrar_venta($1)", [fiado(cli, 1, { plazo_dias: 30 })]);
    assert.match(sin?.message ?? "", /Sin cupo de crédito asignado.*dueño o el administrador/);
    await raiz();
    await c.query("set constraints all immediate");
    await c.query("alter table ventas disable trigger ventas_inmutables");
    await c.query("update ventas set vence_pago = current_date - 40 where id = $1", [v.venta_id]);
    await c.query("alter table ventas enable trigger ventas_inmutables");
    await c.query("set constraints all deferred");
    await c.query("update empresas set dias_mora_bloqueo = 30 where id = $1", [E.A]);
    await quien(U.carlos);
    await c.query("select configurar_credito_cliente($1, 10000000, 30, false, null)", [cli]);
    const est = (await c.query("select estado_credito($1, 1000) e", [cli])).rows[0].e;
    assert.equal(est.puede_fiar, false); assert.equal(est.requiere_motivo, true); assert.match(est.motivo, /Mora de 40 días/);
    assert.match((await falla("select registrar_venta($1)", [fiado(cli, 1)]))?.message ?? "", /Mora de 40 días/);
    await quien(U.cajera);
    assert.match((await falla("select registrar_venta($1)", [fiado(cli, 1)]))?.message ?? "", /Mora de 40 días/);
    assert.equal((await c.query("select estado_credito($1) e", [cli])).rows[0].e.requiere_motivo, false, "la cajera no puede autorizar");
  });
});

test("recibo de caja: reparte a la factura que vence antes, no recibe más que el saldo, y anularlo restituye", async () => {
  await escena(async (c, { quien, raiz, falla }) => {
    await quien(U.carlos);
    const cli = (await c.query(`insert into clientes (empresa_id, tipo_doc, numero_doc, nombre, email) values ($1, 'CC', '99000333', 'Cliente recibo prueba', 'rc@prueba.example') returning id`, [E.A])).rows[0].id;
    const nueva = (await c.query("select registrar_venta($1) r", [fiado(cli, 3, { plazo_dias: 60 })])).rows[0].r;
    const vieja = (await c.query("select registrar_venta($1) r", [fiado(cli, 2, { plazo_dias: 10 })])).rows[0].r;
    const deuda = Number(nueva.total) + Number(vieja.total);
    const pago = Number(vieja.total) + 100;
    assert.match((await falla("select registrar_recibo($1, 'efectivo', $2, null, $3)", [cli, deuda + 1, C.A]))?.message ?? "", /supera lo que debe/);
    const r = (await c.query("select registrar_recibo($1, 'nequi', $2, 'ref 77', $3) r", [cli, pago, C.A])).rows[0].r;
    assert.deepEqual(r.aplicado.map((a) => [a.venta_id, Number(a.valor)]), [[vieja.venta_id, Number(vieja.total)], [nueva.venta_id, 100]]);
    const saldos = async () => Object.fromEntries((await c.query("select venta_id, saldo::float s from v_cartera where cliente_id = $1", [cli])).rows.map((x) => [x.venta_id, x.s]));
    assert.deepEqual(await saldos(), { [vieja.venta_id]: 0, [nueva.venta_id]: Number(nueva.total) - 100 });
    assert.equal(Number(r.saldo), deuda - pago);
    // Un abono del recibo no se anula suelto; el recibo, sí, y los saldos vuelven.
    const ab = (await c.query("select id from abonos where recibo_id = $1 limit 1", [r.id])).rows[0].id;
    assert.match((await falla("select anular_abono($1, 'prueba')", [ab]))?.message ?? "", /anula el recibo completo/);
    await quien(U.cajera);
    assert.match((await falla("select anular_recibo($1, 'prueba de cajera')", [r.id]))?.message ?? "", /dueño o el administrador/);
    await quien(U.carlos);
    await c.query("select anular_recibo($1, 'Pago devuelto por el banco')", [r.id]);
    assert.deepEqual(await saldos(), { [vieja.venta_id]: Number(vieja.total), [nueva.venta_id]: Number(nueva.total) });
    assert.match((await falla("update recibos_caja set valor = 1 where id = $1", [r.id]))?.message ?? "", /permission denied/);
    await raiz();
    assert.match((await falla("update recibos_caja set valor = 1 where id = $1", [r.id]))?.message ?? "", /solo puede anularse/);
    assert.match((await falla("delete from recibos_caja where id = $1", [r.id]))?.message ?? "", /no se borran/);
  });
});

test("abonos por turno: con dos cajas, el efectivo de la caja 2 cuenta solo en su turno; la cajera sin turno no recibe", async () => {
  await escena(async (c, { quien, raiz, falla }) => {
    await raiz();
    const c2 = (await c.query(`insert into cajas (empresa_id, sede_id, nombre) values ($1, $2, 'Caja prueba 2') returning id`, [E.A, S.A])).rows[0].id;
    await quien(U.carlos);
    const cli = (await c.query(`insert into clientes (empresa_id, tipo_doc, numero_doc, nombre, email) values ($1, 'CC', '99000444', 'Cliente turno prueba', 't@prueba.example') returning id`, [E.A])).rows[0].id;
    await c.query("select registrar_venta($1) r", [fiado(cli, 4, { plazo_dias: 30 })]);
    await quien(U.cajera);
    assert.match((await falla("select registrar_recibo($1, 'efectivo', 1000, null, $2)", [cli, c2]))?.message ?? "", /Abre el turno/);
    assert.match((await falla("select registrar_recibo($1, 'efectivo', 1000, null, null)", [cli]))?.message ?? "", /Abre el turno/);
    const t1 = (await c.query("select abrir_turno($1, 0) t", [C.A])).rows[0].t;
    const t2 = (await c.query("select abrir_turno($1, 0) t", [c2])).rows[0].t;
    const r = (await c.query("select registrar_recibo($1, 'efectivo', 1000, null, $2) r", [cli, c2])).rows[0].r;
    assert.equal(r.turno_id, t2);
    const res = async (t) => (await c.query("select resumen_turno($1) r", [t])).rows[0].r;
    assert.equal(Number((await res(t2)).abonos_efectivo), 1000);
    assert.equal(Number((await res(t2)).n_recibos), 1);
    assert.equal(Number((await res(t1)).abonos_efectivo), 0, "no se duplica en la caja 1");
    // Abono suelto de la cajera a una factura, en su caja con turno.
    const vid = (await c.query("select id from ventas where cliente_id = $1", [cli])).rows[0].id;
    await c.query("select registrar_abono($1, 'nequi', 500, null, $2)", [vid, C.A]);
    assert.equal(Number((await res(t1)).abonos_medios.nequi), 500);
    assert.equal(Number((await res(t1)).abonos_efectivo), 0);
  });
});

test("cuentas de clientes: aislamiento entre empresas y permisos por rol", async () => {
  const cli = (await pool.query(`select id from clientes where empresa_id = $1 limit 1`, [E.A])).rows[0].id;
  await assert.rejects(como(U.duenoB, (c) => c.query("select estado_credito($1)", [cli])), /permiso/);
  await assert.rejects(como(U.duenoB, (c) => c.query("select registrar_recibo($1, 'efectivo', 1000)", [cli])), /permiso/);
  await assert.rejects(como(U.duenoB, (c) => c.query("select configurar_credito_cliente($1, 1000, 30, false, null)", [cli])), /dueño o el administrador/);
  await assert.rejects(como(U.duenoB, (c) => c.query("select * from deudores($1)", [E.A])), /permiso/);
  await assert.rejects(como(U.bodega, (c) => c.query("select estado_credito($1)", [cli])), /permiso/);
  await assert.rejects(como(U.cajera, (c) => c.query("select configurar_credito_cliente($1, 1000, 30, false, null)", [cli])), /dueño o el administrador/);
  await assert.rejects(como(U.cajera, (c) => c.query("update clientes set cupo_credito = 99999999 where id = $1", [cli])), /permission denied/);
  await assert.rejects(como(U.cajera, (c) => c.query("insert into clientes (empresa_id, tipo_doc, numero_doc, nombre, cupo_credito) values ($1, 'CC', '1234567', 'X', 5000000)", [E.A])), /permission denied/);
  await assert.rejects(como(U.carlos, (c) => c.query("select configurar_mora($1, 30)", [E.A])), /demostración/);
  const vistos = await como(U.duenoB, async (c) => (await c.query("select count(*)::int n from recibos_caja")).rows[0].n);
  assert.equal(vistos, 0);
  // El estado de cuenta cuadra: la suma de saldos de v_cartera = cargos − devuelto a saldo − abonos vigentes.
  const r = await como(U.carlos, async (c) => (await c.query(`select
      (select coalesce(sum(saldo), 0) from v_cartera where empresa_id = $1)::float vista,
      (select coalesce(sum(v.total), 0) from ventas v where v.empresa_id = $1 and v.condicion = 'credito' and v.estado = 'cerrada')::float
      - (select coalesce(sum(d.a_saldo), 0) from devoluciones d join ventas v on v.id = d.venta_id where v.empresa_id = $1 and v.condicion = 'credito' and v.estado = 'cerrada')::float
      - (select coalesce(sum(a.valor), 0) from abonos a join ventas v on v.id = a.venta_id where v.empresa_id = $1 and v.estado = 'cerrada' and not a.anulado)::float libro`, [E.A])).rows[0]);
  assert.equal(r.vista, r.libro);
});

// ── Mostrador: ventas en espera, domicilios y cotizaciones (migración 032)
const VENDEDOR = "00000000-0000-4000-8000-0000000000a7";
const pedido = (lineas, extra = {}) => ({ empresa_id: E.A, sede_id: S.A, caja_id: C.A, tipo: "espera", lineas, ...extra });
/** Transacción (que se deshace) con un vendedor de prueba en A; fn recibe la conexión y cambia de usuario con comoEn. */
async function conVendedor(fn) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query(`insert into miembros (empresa_id, user_id, nombre, rol) values ($1, $2, 'Vendedor de prueba', 'vendedor')`, [E.A, VENDEDOR]);
    await c.query("set local role authenticated");
    return await fn(c);
  } finally { await c.query("rollback").catch(() => {}); c.release(); }
}

test("pedidos: la cajera y el vendedor los arman con consecutivo por tipo y precio de la base; la bodega no", async () => {
  await conVendedor(async (c) => {
    await comoEn(c, U.cajera);
    const a = (await c.query("select guardar_pedido($1) r", [pedido([{ producto_id: prod.id, presentacion: "caja", cantidad: 2 }])])).rows[0].r;
    const b = (await c.query("select guardar_pedido($1) r", [pedido([{ producto_id: prod.id, presentacion: "unidad", cantidad: 3 }])])).rows[0].r;
    assert.equal(b.numero, a.numero + 1, "consecutivo de las esperas");
    await comoEn(c, U.carlos);
    const cot = (await c.query("select guardar_pedido($1) r", [pedido([{ producto_id: prod.id, presentacion: "caja", cantidad: 1 }], { tipo: "cotizacion" })])).rows[0].r;
    const ya = (await c.query(`select coalesce(max(numero), 0)::int n from pedidos_mostrador where empresa_id = $1 and tipo = 'cotizacion' and id <> $2`, [E.A, cot.id])).rows[0].n;
    assert.equal(cot.numero, ya + 1, "las cotizaciones llevan su propio consecutivo");
    const l = (await c.query(`select precio_mostrado::float p, presentacion from pedido_lineas where pedido_id = $1 order by id`, [b.id])).rows[0];
    assert.deepEqual(l, { p: Number(prod.precio_unidad), presentacion: "unidad" }, "el precio lo pone la base, no el navegador");
    assert.equal((await c.query(`select vence - current_date d from pedidos_mostrador where id = $1`, [cot.id])).rows[0].d, 8, "validez por defecto de la cotización");
    await comoEn(c, VENDEDOR);
    const v = (await c.query("select guardar_pedido($1) r", [pedido([{ producto_id: prod.id, presentacion: "caja", cantidad: 1 }], { tipo: "cotizacion", contacto: "Clínica" })])).rows[0].r;
    assert.ok(v.id, "el vendedor arma cotizaciones");
    await c.query("savepoint s");
    await assert.rejects(c.query("select guardar_pedido($1)", [pedido([{ producto_id: prod.id, presentacion: "caja", cantidad: 1, descuento_pct: 50 }])]), /supera el máximo/);
    await c.query("rollback to savepoint s");
    await comoEn(c, U.bodega);
    await assert.rejects(c.query("select guardar_pedido($1)", [pedido([{ producto_id: prod.id, presentacion: "caja", cantidad: 1 }])]), /permiso/);
  });
});

test("pedidos: domicilio exige entrega, cotización con validez de hasta 90 días y no se escriben las tablas directo", async () => {
  await assert.rejects(como(U.cajera, (c) => c.query("select guardar_pedido($1)", [pedido([{ producto_id: prod.id, presentacion: "caja", cantidad: 1 }], { tipo: "domicilio", contacto: "Ana" })])), /teléfono/);
  await assert.rejects(como(U.cajera, (c) => c.query("select guardar_pedido($1)", [pedido([{ producto_id: prod.id, presentacion: "caja", cantidad: 1 }], { tipo: "domicilio", contacto: "Ana", telefono: "3001234567" })])), /dirección/);
  await assert.rejects(como(U.cajera, (c) => c.query("select guardar_pedido($1)", [pedido([{ producto_id: prod.id, presentacion: "caja", cantidad: 1 }], { tipo: "cotizacion", vence: hace(-120) })])), /90 días/);
  await assert.rejects(como(U.cajera, (c) => c.query("select guardar_pedido($1)", [pedido([{ producto_id: prod.id, presentacion: "caja", cantidad: 0 }])])), /Cantidad no válida/);
  await assert.rejects(como(U.cajera, (c) => c.query("select guardar_pedido($1)", [pedido([])])), /no tiene productos/);
  await assert.rejects(como(U.carlos, (c) => c.query(`insert into pedidos_mostrador (empresa_id, sede_id, tipo, numero, creado_por) values ($1, $2, 'espera', 999, $3)`, [E.A, S.A, U.carlos])), /permission denied/);
  await assert.rejects(como(U.carlos, async (c) => {
    const p = (await c.query("select guardar_pedido($1) r", [pedido([{ producto_id: prod.id, presentacion: "caja", cantidad: 1 }])])).rows[0].r;
    await c.query(`update pedidos_mostrador set estado = 'cobrado' where id = $1`, [p.id]);
  }), /permission denied/);
});

test("pedidos: otra empresa no los ve, no los cambia ni los cobra", async () => {
  await como(U.carlos, async (c) => {
    const p = (await c.query("select guardar_pedido($1) r", [pedido([{ producto_id: prod.id, presentacion: "caja", cantidad: 1 }])])).rows[0].r;
    await comoEn(c, U.duenoB);
    assert.equal((await c.query(`select count(*)::int n from pedidos_mostrador where empresa_id = $1`, [E.A])).rows[0].n, 0);
    assert.equal((await c.query(`select count(*)::int n from pedido_lineas where empresa_id = $1`, [E.A])).rows[0].n, 0);
    await c.query("savepoint s");
    await assert.rejects(c.query("select cambiar_estado_pedido($1, 'cancelado', 'Intento ajeno')", [p.id]), /no encontrado/);
    await c.query("rollback to savepoint s");
    await assert.rejects(c.query("select guardar_pedido($1)", [pedido([{ producto_id: prod.id, presentacion: "caja", cantidad: 1 }])]), /permiso/);
  });
});

test("cobrar_pedido: en la misma transacción de la venta, una sola vez, nunca con una venta vieja ni si está cancelado", async () => {
  await conVendedor(async (c) => {
    await comoEn(c, U.cajera);
    const p = (await c.query("select guardar_pedido($1) r", [pedido([{ producto_id: prod.id, presentacion: "caja", cantidad: 1 }], { tipo: "domicilio", contacto: "Ana", telefono: "3001234567", direccion: "Cra 1 # 2-3" })])).rows[0].r;
    const antes = Number((await c.query(`select coalesce(sum(cantidad), 0) u from movimientos where producto_id = $1`, [prod.id])).rows[0].u);
    await c.query("select cambiar_estado_pedido($1, 'en_camino')", [p.id]);
    assert.equal(antes, Number((await c.query(`select coalesce(sum(cantidad), 0) u from movimientos where producto_id = $1`, [prod.id])).rows[0].u), "en camino no mueve existencias");
    const idem = crypto.randomUUID();
    const v = (await c.query("select registrar_venta($1) r", [venta([{ producto_id: prod.id, presentacion: "caja", cantidad: 1 }], { idem_key: idem, pagos: [{ medio: "efectivo", valor: 1000000 }] })])).rows[0].r;
    assert.equal((await c.query("select cobrar_pedido($1, $2) r", [p.id, v.venta_id])).rows[0].r.estado, "cobrado");
    const ped = (await c.query(`select estado, venta_id from pedidos_mostrador where id = $1`, [p.id])).rows[0];
    assert.deepEqual(ped, { estado: "cobrado", venta_id: v.venta_id });
    assert.equal((await c.query("select cobrar_pedido($1, $2) r", [p.id, v.venta_id])).rows[0].r.repetido, true, "reintento de la misma venta");
    const v2 = (await c.query("select registrar_venta($1) r", [venta([{ producto_id: prod.id, presentacion: "unidad", cantidad: 1 }], { pagos: [{ medio: "efectivo", valor: 1000000 }] })])).rows[0].r;
    await c.query("savepoint s");
    await assert.rejects(c.query("select cobrar_pedido($1, $2)", [p.id, v2.venta_id]), /ya se cobró/);
    await c.query("rollback to savepoint s");
    // Una venta vieja no cobra un pedido; uno cancelado no se cobra; el vendedor no cobra.
    const q = (await c.query("select guardar_pedido($1) r", [pedido([{ producto_id: prod.id, presentacion: "caja", cantidad: 1 }])])).rows[0].r;
    const vieja = (await c.query(`select id from ventas where empresa_id = $1 and creado < now() - interval '1 day' limit 1`, [E.A])).rows[0].id;
    await c.query("savepoint s");
    await assert.rejects(c.query("select cobrar_pedido($1, $2)", [q.id, vieja]), /su propia venta/);
    await c.query("rollback to savepoint s");
    await comoEn(c, VENDEDOR);
    await c.query("savepoint s");
    await assert.rejects(c.query("select cobrar_pedido($1, $2)", [q.id, v2.venta_id]), /no puede cobrar/);
    await c.query("rollback to savepoint s");
    await assert.rejects(c.query("select registrar_venta($1)", [venta([{ producto_id: prod.id, presentacion: "caja", cantidad: 1 }], { pagos: [{ medio: "efectivo", valor: 1000000 }] })]), /permiso/);
  });
});

test("cancelar un pedido exige motivo, no mueve existencias y queda en la auditoría", async () => {
  await como(U.cajera, async (c) => {
    const p = (await c.query("select guardar_pedido($1) r", [pedido([{ producto_id: prod.id, presentacion: "caja", cantidad: 1 }], { tipo: "domicilio", contacto: "Ana", telefono: "3001234567", direccion: "Cra 1 # 2-3" })])).rows[0].r;
    const stock = async () => Number((await c.query(`select coalesce(sum(unidades), 0) u from v_stock_lotes where producto_id = $1`, [prod.id])).rows[0].u);
    const antes = await stock();
    await c.query("select cambiar_estado_pedido($1, 'en_camino')", [p.id]);
    await c.query("savepoint s");
    await assert.rejects(c.query("select cambiar_estado_pedido($1, 'cancelado', ' ')", [p.id]), /motivo/);
    await c.query("rollback to savepoint s");
    await c.query("select cambiar_estado_pedido($1, 'cancelado', 'No lo recibió')", [p.id]);
    assert.equal(await stock(), antes);
    assert.deepEqual((await c.query(`select estado, motivo from pedidos_mostrador where id = $1`, [p.id])).rows[0], { estado: "cancelado", motivo: "No lo recibió" });
    await assert.rejects(c.query("select guardar_pedido($1)", [{ ...pedido([{ producto_id: prod.id, presentacion: "caja", cantidad: 1 }], { tipo: "domicilio", contacto: "Ana", telefono: "3001234567", direccion: "Cra 1" }), id: p.id }]), /ya no se puede cambiar/);
  });
});

test("cotizaciones vencidas: quedan «vencidas» y se pueden cobrar al precio de hoy", async () => {
  await como(U.carlos, async (c) => {
    const p = (await c.query("select guardar_pedido($1) r", [pedido([{ producto_id: prod.id, presentacion: "caja", cantidad: 1 }], { tipo: "cotizacion" })])).rows[0].r;
    await c.query("reset role");
    await c.query(`update pedidos_mostrador set vence = current_date - 1 where id = $1`, [p.id]);
    await c.query("set local role authenticated");
    assert.ok((await c.query("select vencer_cotizaciones($1) n", [E.A])).rows[0].n >= 1);
    assert.equal((await c.query(`select estado from pedidos_mostrador where id = $1`, [p.id])).rows[0].estado, "vencido");
    const v = (await c.query("select registrar_venta($1) r", [venta([{ producto_id: prod.id, presentacion: "caja", cantidad: 1 }], { pagos: [{ medio: "efectivo", valor: 1000000 }] })])).rows[0].r;
    assert.equal((await c.query("select cobrar_pedido($1, $2) r", [p.id, v.venta_id])).rows[0].r.estado, "cobrado");
  });
});

// ───────────── Integración del Bloque 2 (033a): la consola elimina una droguería de prueba con compras, pedidos y recibos
test("la consola elimina una droguería de prueba con compras, pagos y devoluciones a proveedores, pedidos y recibos de caja", async () => {
  await como(U.duenoB, async (c) => {
    const raiz = async () => { await c.query("reset role"); };
    const dueno = async () => { await c.query("set local role authenticated"); };
    await raiz();
    const sede = (await c.query(`select id from sedes where empresa_id = $1 limit 1`, [E.B])).rows[0].id;
    const caja = (await c.query(`select id from cajas where empresa_id = $1 and activa limit 1`, [E.B])).rows[0].id;
    const p = (await c.query(`insert into productos (empresa_id, nombre, precio_caja) values ($1, 'Producto bloque 2 B', 1000) returning id`, [E.B])).rows[0].id;
    // B vende solo con numeración de producción; antes de eliminarla se vuelve a «pruebas» (la consola no borra lo fiscal real).
    await c.query(`insert into resoluciones_dian (empresa_id, tipo, prefijo, desde, hasta, actual, vigente_hasta, pruebas) values ($1, 'factura', 'FB', 1, 1000, 0, '2027-12-31', true)`, [E.B]);
    await c.query(`update resoluciones_dian set pruebas = false, numero_resolucion = '18760000000001' where empresa_id = $1`, [E.B]);
    await dueno();
    const turno = (await c.query("select abrir_turno($1, 0) t", [caja])).rows[0].t;
    // Compras: compra a crédito, pago por transferencia, pago en efectivo desde la caja (egreso del turno) y devolución.
    const prov = (await c.query(`insert into proveedores (empresa_id, nombre, plazo_dias) values ($1, 'Proveedor B bloque 2', 30) returning id`, [E.B])).rows[0].id;
    const compraB = (await c.query("select registrar_compra($1) r", [{ empresa_id: E.B, sede_id: sede, proveedor_id: prov, numero_factura: "FB-1", condicion: "credito",
      fecha_factura: new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" }),
      lineas: [{ producto_id: p, lote: "LB2", vence: "2031-06-30", unidades: 40, costo: 500, costo_por: "unidad", iva_pct: 0 }] }])).rows[0].r;
    await c.query("select registrar_pago_proveedor($1)", [{ empresa_id: E.B, proveedor_id: prov, medio: "transferencia", valor: 1000, compras: [compraB.id] }]);
    await c.query("select registrar_pago_proveedor($1)", [{ empresa_id: E.B, proveedor_id: prov, medio: "efectivo", valor: 500, caja_id: caja, compras: [compraB.id] }]);
    const linea = (await c.query(`select id from compra_lineas where compra_id = $1`, [compraB.id])).rows[0].id;
    await c.query("select registrar_devolucion_proveedor($1)", [{ empresa_id: E.B, compra_id: compraB.id, motivo: "Empaque roto", lineas: [{ compra_linea_id: linea, unidades: 2 }] }]);
    // Mostrador: una espera cobrada (enlazada a su venta) y una cotización abierta.
    const ped = (await c.query("select guardar_pedido($1) r", [{ empresa_id: E.B, sede_id: sede, caja_id: caja, tipo: "espera", lineas: [{ producto_id: p, presentacion: "caja", cantidad: 1 }] }])).rows[0].r;
    await c.query("select guardar_pedido($1)", [{ empresa_id: E.B, sede_id: sede, caja_id: caja, tipo: "cotizacion", lineas: [{ producto_id: p, presentacion: "caja", cantidad: 3 }] }]);
    const vp = (await c.query("select registrar_venta($1) r", [{ empresa_id: E.B, sede_id: sede, caja_id: caja, idem_key: crypto.randomUUID(), tipo_doc: "pos",
      lineas: [{ producto_id: p, presentacion: "caja", cantidad: 1 }], pagos: [{ medio: "efectivo", valor: 1000 }] }])).rows[0].r;
    await c.query("select cobrar_pedido($1, $2)", [ped.id, vp.venta_id]);
    // Cuentas de clientes: cupo, venta a crédito y recibo de caja en el turno.
    const cli = (await c.query(`insert into clientes (empresa_id, tipo_doc, numero_doc, nombre, email) values ($1, 'CC', '55500011', 'Cliente B bloque 2', 'b2@prueba.example') returning id`, [E.B])).rows[0].id;
    await c.query("select configurar_credito_cliente($1, 100000, 30, false, null)", [cli]);
    await c.query("select registrar_venta($1)", [{ empresa_id: E.B, sede_id: sede, caja_id: caja, idem_key: crypto.randomUUID(), tipo_doc: "factura", cliente_id: cli,
      condicion: "credito", pagos: [], lineas: [{ producto_id: p, presentacion: "caja", cantidad: 2 }] }]);
    const rc = (await c.query("select registrar_recibo($1, 'efectivo', 1500, null, $2) r", [cli, caja])).rows[0].r;
    const TABLAS = ["compras", "compra_lineas", "pagos_proveedor", "pago_aplicaciones", "devoluciones_proveedor", "devolucion_proveedor_lineas",
      "pedidos_mostrador", "pedido_lineas", "recibos_caja", "abonos", "proveedores"];
    const cuenta = async () => (await c.query(`select ${TABLAS.map((t) => `(select count(*)::int from ${t} where empresa_id = $1) ${t}`).join(", ")}`, [E.B])).rows[0];
    await raiz();
    const antes = await cuenta();
    assert.ok(TABLAS.every((t) => antes[t] > 0), "hay datos de los tres frentes en B: " + JSON.stringify(antes));
    assert.ok((await c.query(`select turno_id from recibos_caja where id = $1`, [rc.id])).rows[0].turno_id === turno, "el recibo quedó en el turno");
    // Un usuario de la app no borra recibos, ni siquiera con la marca de la consola puesta.
    await c.query("savepoint s");
    await dueno();
    await c.query("select set_config('regenta.eliminar_empresa', $1, true)", [E.B]);
    await assert.rejects(c.query(`delete from recibos_caja where id = $1`, [rc.id]), /permission denied|no se borran/);
    await c.query("rollback to savepoint s");
    await raiz();
    await assert.rejects(c.query(`delete from recibos_caja where id = $1`, [rc.id]), /no se borran/);
    await c.query("rollback to savepoint s");
    await raiz();
    await c.query(`update empresas set estado = 'suspendida' where id = $1`, [E.B]);
    await assert.rejects(c.query("select eliminar_empresa_prueba($1)", [E.B]), /se conservan por ley/);
    await c.query("rollback to savepoint s");
    await raiz();
    await c.query(`update resoluciones_dian set pruebas = true where empresa_id = $1`, [E.B]);
    await c.query(`update empresas set estado = 'suspendida' where id = $1`, [E.B]);
    await c.query("select eliminar_empresa_prueba($1)", [E.B]);
    assert.equal((await c.query(`select count(*)::int n from empresas where id = $1`, [E.B])).rows[0].n, 0);
    assert.deepEqual(await cuenta(), Object.fromEntries(TABLAS.map((t) => [t, 0])), "no queda nada de compras, pedidos ni recibos");
  });
});

// ───────────── DIAN complementaria (035): documento soporte, nota de ajuste, nota débito
const hoyBogota = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
/** Numeraciones de prueba de los tipos nuevos (la demo emite en simulado). Se insertan como superusuario. */
async function numeracionesComplementarias(c, emp, pruebas = true) {
  await c.query("reset role");
  for (const [tipo, prefijo] of [["soporte", "DSE"], ["ajuste_soporte", "NAE"], ["nota_debito", "NDE"]])
    if (!(await c.query(`select 1 from resoluciones_dian where empresa_id = $1 and tipo = $2 and activa`, [emp, tipo])).rowCount)
      await c.query(`insert into resoluciones_dian (empresa_id, tipo, prefijo, desde, hasta, actual, vigente_hasta, pruebas, numero_resolucion) values ($1, $2, $3, 1, 100000, 0, '2027-12-31', $4, $5)`,
        [emp, tipo, prefijo, pruebas, pruebas ? null : "18760000000099"]);
  await c.query("set local role authenticated");
}
const compraDe = async (c, prov, costo, extra = {}) => (await c.query("select registrar_compra($1) r", [compra(prov, [{ producto_id: prod.id, lote: "DS-" + crypto.randomUUID().slice(0, 6), vence, unidades: 10, costo, costo_por: "unidad", iva_pct: 0 }], { condicion: "contado", ...extra })])).rows[0].r;

test("documento soporte: por operación y semanal, una compra nunca en dos, proveedor obligado no, nota de ajuste que anula y libera", async () => {
  await como(U.carlos, async (c) => {
    await numeracionesComplementarias(c, E.A);
    const prov = (await c.query(`insert into proveedores (empresa_id, nombre, nit, dv, obligado_facturar) values ($1, 'Campesino prueba BD', '1110456789', '3', false) returning id`, [E.A])).rows[0].id;
    const [k1, k2, k3] = [await compraDe(c, prov, 1000), await compraDe(c, prov, 2000), await compraDe(c, prov, 3000)];
    const idem = crypto.randomUUID();
    const d1 = (await c.query("select generar_soporte($1) r", [{ empresa_id: E.A, compras: [k1.id], idem_key: idem }])).rows[0].r;
    assert.match(d1.numero, /^DSE\d+$/);
    const doc = (await c.query(`select tipo, compra_id, proveedor_id, total::float, base::float, iva::float, venta_id, estado from documentos_dian where id = $1`, [d1.id])).rows[0];
    assert.deepEqual(doc, { tipo: "soporte", compra_id: k1.id, proveedor_id: prov, total: 10000, base: 10000, iva: 0, venta_id: null, estado: "pendiente" });
    assert.equal((await c.query(`select sum(total)::float t from documento_lineas where documento_id = $1`, [d1.id])).rows[0].t, 10000, "las líneas cuadran con el total");
    // Idempotencia: el mismo envío no gasta otro número.
    const rep = (await c.query("select generar_soporte($1) r", [{ empresa_id: E.A, compras: [k1.id], idem_key: idem }])).rows[0].r;
    assert.deepEqual([rep.id, rep.repetido], [d1.id, true]);
    // Una compra no se incluye dos veces (ni por operación ni en el semanal).
    await falla(c, "select generar_soporte($1)", [{ empresa_id: E.A, compras: [k1.id] }], /ya está en el documento soporte/);
    await falla(c, "select generar_soporte($1)", [{ empresa_id: E.A, compras: [k1.id, k2.id, k3.id], semanal: true }], /ya está en el documento soporte/);
    await falla(c, "select generar_soporte($1)", [{ empresa_id: E.A, compras: [k2.id, k3.id] }], /una sola compra/);
    const sem = (await c.query("select generar_soporte($1) r", [{ empresa_id: E.A, compras: [k2.id, k3.id], semanal: true }])).rows[0].r;
    const ds = (await c.query(`select compra_id, total::float, periodo_desde::text, periodo_hasta::text, extract(isodow from periodo_desde)::int dia from documentos_dian where id = $1`, [sem.id])).rows[0];
    assert.equal(ds.compra_id, null); assert.equal(ds.total, 50000); assert.equal(ds.dia, 1, "el periodo empieza el lunes");
    assert.equal((await c.query(`select ($1::date - $2::date)::int n`, [ds.periodo_hasta, ds.periodo_desde])).rows[0].n, 6);
    assert.equal((await c.query(`select count(*)::int n from soporte_compras where documento_id = $1`, [sem.id])).rows[0].n, 2);
    // Proveedor obligado a facturar: no lleva documento soporte.
    const obligado = await proveedorDe(c, E.A, "Proveedor obligado BD");
    const k4 = await compraDe(c, obligado, 500);
    await falla(c, "select generar_soporte($1)", [{ empresa_id: E.A, compras: [k4.id] }], /obligado a facturar/);
    // Compras de semanas distintas no van en un mismo semanal.
    const k5 = await compraDe(c, prov, 100, { fecha_factura: (await c.query(`select (current_date - 7)::text d`)).rows[0].d });
    await falla(c, "select generar_soporte($1)", [{ empresa_id: E.A, compras: [k5.id, (await compraDe(c, prov, 100)).id], semanal: true }], /misma semana/);
    // Nota de ajuste: corrección por tarifa (no más de lo que hay), luego anulación del saldo, que libera la compra.
    await falla(c, "select ajustar_soporte($1)", [{ documento_id: d1.id, concepto: "correccion", motivo: "Precio mal liquidado", descripcion: "Precio", valor: 100, iva_pct: 19 }], /IVA del 19/);
    await falla(c, "select ajustar_soporte($1)", [{ documento_id: d1.id, concepto: "correccion", motivo: "Precio mal liquidado", descripcion: "Precio", valor: 20000, iva_pct: 0 }], /no puede ser mayor|supera/);
    const cor = (await c.query("select ajustar_soporte($1) r", [{ documento_id: d1.id, concepto: "correccion", motivo: "Precio mal liquidado", descripcion: "Precio", valor: 1500, iva_pct: 0 }])).rows[0].r;
    assert.equal(cor.total, 1500);
    const an = (await c.query("select ajustar_soporte($1) r", [{ documento_id: d1.id, concepto: "anulacion", motivo: "La compra se registró dos veces" }])).rows[0].r;
    assert.equal(Number(an.total), 8500, "la anulación es por el saldo");
    assert.equal((await c.query(`select origen_id, tipo, concepto from documentos_dian where id = $1`, [an.id])).rows[0].origen_id, d1.id);
    await falla(c, "select ajustar_soporte($1)", [{ documento_id: d1.id, concepto: "anulacion", motivo: "Otra vez" }], /ya está anulado/);
    const d2 = (await c.query("select generar_soporte($1) r", [{ empresa_id: E.A, compras: [k1.id] }])).rows[0].r;
    assert.notEqual(d2.id, d1.id, "la compra liberada se puede volver a soportar");
    // Inmutable: líneas y compras soportadas no se borran ni se cambian (ni siquiera como superusuario).
    await c.query("reset role");
    await falla(c, `delete from documento_lineas where documento_id = $1`, [d1.id], /no se modifican/);
    await falla(c, `update soporte_compras set compra_id = $2 where documento_id = $1`, [sem.id, k1.id], /no se modifican/);
    await c.query("set local role authenticated");
    await falla(c, `insert into documento_lineas (empresa_id, documento_id, descripcion, cantidad, precio, iva_pct, base, iva, total) values ($1, $2, 'x', 1, 1, 0, 1, 0, 1)`, [E.A, d1.id], /permission denied/);
  });
});

test("documento soporte y notas: la cajera, la bodega y el dueño de otra droguería no pueden; sin numeración o en pruebas, mensaje claro", async () => {
  const ids = await como(U.carlos, async (c) => {
    await numeracionesComplementarias(c, E.A);
    const prov = (await c.query(`insert into proveedores (empresa_id, nombre, nit, obligado_facturar) values ($1, 'Campesino permisos ' || $2, '1110456700', false) returning id`, [E.A, crypto.randomUUID().slice(0, 8)])).rows[0].id;
    const k = await compraDe(c, prov, 1000);
    const d = (await c.query("select generar_soporte($1) r", [{ empresa_id: E.A, compras: [k.id] }])).rows[0].r;
    const f = (await c.query(`select d.id from documentos_dian d join ventas v on v.id = d.venta_id where d.empresa_id = $1 and d.tipo = 'factura' and v.estado = 'cerrada' and d.estado <> 'rechazado' limit 1`, [E.A])).rows[0];
    return { compra: k.id, doc: d.id, factura: f?.id };
  }, { commit: true });
  assert.ok(ids.factura, "la demo tiene una factura para la nota débito");
  for (const u of [U.cajera, U.bodega, U.duenoB]) {
    await assert.rejects(como(u, (c) => c.query("select generar_soporte($1)", [{ empresa_id: E.A, compras: [ids.compra], semanal: true }])), /Solo el dueño o el administrador/);
    await assert.rejects(como(u, (c) => c.query("select ajustar_soporte($1)", [{ documento_id: ids.doc, concepto: "anulacion", motivo: "Intento ajeno" }])), /Solo el dueño o el administrador/);
    await assert.rejects(como(u, (c) => c.query("select nota_debito($1)", [{ documento_id: ids.factura, motivo: "Intento ajeno", lineas: [{ descripcion: "Flete", valor: 1000 }] }])), /Solo el dueño o el administrador/);
  }
  // Nadie de otra droguería lee sus líneas ni sus compras soportadas.
  const ajenas = await como(U.duenoB, async (c) => (await c.query(`select (select count(*) from documento_lineas)::int l, (select count(*) from soporte_compras)::int s`)).rows[0]);
  assert.deepEqual(ajenas, { l: 0, s: 0 });
  const cajera = await como(U.cajera, async (c) => (await c.query(`select count(*)::int n from documento_lineas`)).rows[0].n);
  assert.equal(cajera, 0, "la cajera no ve las líneas (son de la gerencia)");
  // Se deja la demo como estaba: el documento de prueba se anula con su nota de ajuste (libera la compra).
  await como(U.carlos, (c) => c.query("select ajustar_soporte($1)", [{ documento_id: ids.doc, concepto: "anulacion", motivo: "Limpieza de la prueba" }]), { commit: true });
  // B (no demo) sin numeración, y con numeración de pruebas: mensajes claros.
  await como(U.duenoB, async (c) => {
    const sede = (await c.query(`select id from sedes where empresa_id = $1 limit 1`, [E.B])).rows[0].id;
    const p = (await c.query(`select id from productos where empresa_id = $1 limit 1`, [E.B])).rows[0]?.id
      ?? (await (async () => { await c.query("reset role"); const x = (await c.query(`insert into productos (empresa_id, nombre, precio_caja) values ($1, 'Producto soporte B', 1000) returning id`, [E.B])).rows[0].id; await c.query("set local role authenticated"); return x; })());
    const prov = (await c.query(`insert into proveedores (empresa_id, nombre, nit, obligado_facturar) values ($1, 'Campesino B', '1110456701', false) returning id`, [E.B])).rows[0].id;
    const k = (await c.query("select registrar_compra($1) r", [{ empresa_id: E.B, sede_id: sede, proveedor_id: prov, numero_factura: "B-DS-1", fecha_factura: hoyBogota(), condicion: "contado",
      lineas: [{ producto_id: p, lote: "BDS1", vence, unidades: 5, costo: 100, costo_por: "unidad", iva_pct: 0 }] }])).rows[0].r;
    await falla(c, "select generar_soporte($1)", [{ empresa_id: E.B, compras: [k.id] }], /aún no tiene numeración de documento soporte/);
    await numeracionesComplementarias(c, E.B, true);
    await falla(c, "select generar_soporte($1)", [{ empresa_id: E.B, compras: [k.id] }], /es de pruebas/);
    // Un id de A no pasa por la empresa de B.
    await falla(c, "select generar_soporte($1)", [{ empresa_id: E.B, compras: [ids.compra] }], /no es de tu droguería/);
  });
});

test("nota débito: mayor valor con líneas e IVA al centavo, no sobre facturas de ventas anuladas, hereda el modo", async () => {
  await como(U.carlos, async (c) => {
    await numeracionesComplementarias(c, E.A);
    const f = (await c.query(`select d.id, d.venta_id from documentos_dian d join ventas v on v.id = d.venta_id where d.empresa_id = $1 and d.tipo = 'factura' and v.estado = 'cerrada' and d.estado <> 'rechazado' limit 1`, [E.A])).rows[0];
    const nd = (await c.query("select nota_debito($1) r", [{ documento_id: f.id, motivo: "Intereses de mora", lineas: [{ descripcion: "Intereses", cantidad: 1, valor: 1000.01, iva_pct: 19 }, { descripcion: "Flete", cantidad: 3, valor: 333.33, iva_pct: 0 }] }])).rows[0].r;
    const d = (await c.query(`select tipo, origen_id, venta_id, concepto, base::float, iva::float, total::float from documentos_dian where id = $1`, [nd.id])).rows[0];
    assert.deepEqual(d, { tipo: "nota_debito", origen_id: f.id, venta_id: null, concepto: "mayor_valor", base: 2000, iva: 190, total: 2190 });
    await falla(c, "select nota_debito($1)", [{ documento_id: f.id, motivo: "Sin líneas", lineas: [] }], /al menos un concepto/);
    await falla(c, "select nota_debito($1)", [{ documento_id: f.id, motivo: "IVA raro", lineas: [{ descripcion: "Xx", valor: 10, iva_pct: 7 }] }], /0, 5 o 19/);
    // Un tiquete POS no es una factura: no admite nota débito por esta vía.
    const pos = (await c.query(`select id from documentos_dian where empresa_id = $1 and tipo = 'pos' limit 1`, [E.A])).rows[0].id;
    await falla(c, "select nota_debito($1)", [{ documento_id: pos, motivo: "No es factura", lineas: [{ descripcion: "Xx", valor: 10 }] }], /Solo el dueño o el administrador/);
    // Si la factura está en producción, la nota no puede salir con numeración de pruebas.
    await c.query("reset role");
    await c.query(`update resoluciones_dian set pruebas = false, numero_resolucion = '18760000000001' where empresa_id = $1 and tipo = 'factura'`, [E.A]);
    await c.query("set local role authenticated");
    await falla(c, "select nota_debito($1)", [{ documento_id: f.id, motivo: "Modo heredado", lineas: [{ descripcion: "Xx", valor: 10 }] }], /sigue en pruebas/);
  });
});

test("la consola elimina una droguería de prueba con documentos soporte, notas de ajuste y notas débito", async () => {
  await como(U.duenoB, async (c) => {
    const sede = (await c.query(`select id from sedes where empresa_id = $1 limit 1`, [E.B])).rows[0].id;
    const caja = (await c.query(`select id from cajas where empresa_id = $1 and activa limit 1`, [E.B])).rows[0].id;
    await c.query("reset role");
    const p = (await c.query(`insert into productos (empresa_id, nombre, precio_caja) values ($1, 'Producto DIAN B', 1000) returning id`, [E.B])).rows[0].id;
    await c.query(`insert into resoluciones_dian (empresa_id, tipo, prefijo, desde, hasta, actual, vigente_hasta, pruebas) values ($1, 'factura', 'FB', 1, 1000, 0, '2027-12-31', true)`, [E.B]);
    await numeracionesComplementarias(c, E.B, false);
    await c.query("reset role");
    await c.query(`update resoluciones_dian set pruebas = false, numero_resolucion = '18760000000001' where empresa_id = $1`, [E.B]);
    await c.query("set local role authenticated");
    const prov = (await c.query(`insert into proveedores (empresa_id, nombre, nit, obligado_facturar) values ($1, 'Campesino eliminar B', '1110456702', false) returning id`, [E.B])).rows[0].id;
    const k = (await c.query("select registrar_compra($1) r", [{ empresa_id: E.B, sede_id: sede, proveedor_id: prov, numero_factura: "B-DS-2", fecha_factura: hoyBogota(), condicion: "contado",
      lineas: [{ producto_id: p, lote: "BDS2", vence, unidades: 40, costo: 100, costo_por: "unidad", iva_pct: 0 }] }])).rows[0].r;
    const ds = (await c.query("select generar_soporte($1) r", [{ empresa_id: E.B, compras: [k.id] }])).rows[0].r;
    await c.query("select ajustar_soporte($1)", [{ documento_id: ds.id, concepto: "anulacion", motivo: "Prueba de eliminación" }]);
    const cli = (await c.query(`insert into clientes (empresa_id, tipo_doc, numero_doc, nombre, email) values ($1, 'NIT', '900777888', 'Cliente ND B', 'nd.b@prueba.example') returning id`, [E.B])).rows[0].id;
    const v = (await c.query("select registrar_venta($1) r", [{ empresa_id: E.B, sede_id: sede, caja_id: caja, idem_key: crypto.randomUUID(), tipo_doc: "factura", cliente_id: cli,
      lineas: [{ producto_id: p, presentacion: "caja", cantidad: 1 }], pagos: [{ medio: "efectivo", valor: 1000 }] }])).rows[0].r;
    await c.query("reset role");
    await c.query(`update documentos_dian set estado = 'aceptado', cufe = 'x' where id = $1`, [v.documento_id]);
    await c.query("set local role authenticated");
    await c.query("select nota_debito($1)", [{ documento_id: v.documento_id, motivo: "Flete", lineas: [{ descripcion: "Flete", valor: 500 }] }]);
    await c.query("reset role");
    const TABLAS = ["documento_lineas", "soporte_compras"];
    const cuenta = async () => (await c.query(`select ${TABLAS.map((t) => `(select count(*)::int from ${t} where empresa_id = $1) ${t}`).join(", ")},
      (select count(*)::int from documentos_dian where empresa_id = $1 and tipo in ('soporte', 'ajuste_soporte', 'nota_debito')) docs`, [E.B])).rows[0];
    const antes = await cuenta();
    assert.ok(antes.documento_lineas >= 3 && antes.soporte_compras === 1 && antes.docs === 3, JSON.stringify(antes));
    await c.query(`update resoluciones_dian set pruebas = true where empresa_id = $1`, [E.B]);
    await c.query(`update empresas set estado = 'suspendida' where id = $1`, [E.B]);
    await c.query("select eliminar_empresa_prueba($1)", [E.B]);
    assert.deepEqual(await cuenta(), { documento_lineas: 0, soporte_compras: 0, docs: 0 });
  });
});
