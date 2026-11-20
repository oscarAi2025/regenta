// Modo «droguería interna (sin DIAN)» · migración 049 en la base: la consola lo activa, la droguería entrega (no vende),
// los lotes salen por vencimiento, las fórmulas se exigen como en la caja, la anulación devuelve y nada se borra.
// Todo dentro de transacciones que se deshacen.
// Uso: node scripts/db-reset.mjs && node --test tests/modo-interno-db.test.mjs
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import pg from "pg";

const url = process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/regenta?host=/tmp";
const pool = new pg.Pool({ connectionString: url });
const U = { carlos: "00000000-0000-4000-8000-000000000001", cajera: "00000000-0000-4000-8000-000000000002", duenoB: "00000000-0000-4000-8000-000000000004" };
const E = { A: "10000000-0000-4000-8000-00000000000a", B: "10000000-0000-4000-8000-00000000000b" };
after(() => pool.end());

const dia = (n) => new Date(Date.now() + n * 864e5).toISOString().slice(0, 10);
const hoy = () => new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });

/** La droguería B en modo interno, con la cajera de A también como auxiliar de B, y dos productos con existencias:
 *  Gasas (caja x 10) en tres lotes (uno vencido, uno que vence pronto y otro lejano) y un controlado (caja x 10). */
async function preparar(c, modo = "interno") {
  await c.query(`update empresas set modo = $2 where id = $1`, [E.B, modo]);
  await c.query(`insert into miembros (empresa_id, user_id, nombre, rol, activo) values ($1, $2, 'Auxiliar B', 'cajero', true) on conflict do nothing`, [E.B, U.cajera]);
  const sede = (await c.query(`select id from sedes where empresa_id = $1 limit 1`, [E.B])).rows[0].id;
  const prod = async (nombre, control) => (await c.query(`insert into productos (empresa_id, nombre, iva, unidades_por_caja, precio_caja, control_especial, requiere_formula)
    values ($1, $2, 0, 10, 10000, $3, $3) returning id`, [E.B, nombre, control])).rows[0].id;
  const gasas = await prod("Gasas estériles 049", false), control = await prod("Codeína prueba 049", true);
  const lote = async (p, l, vence, u) => {
    const id = (await c.query(`insert into lotes (empresa_id, sede_id, producto_id, lote, vence) values ($1, $2, $3, $4, $5) returning id`, [E.B, sede, p, l, vence])).rows[0].id;
    await c.query(`insert into movimientos (empresa_id, sede_id, producto_id, lote_id, cantidad, tipo) values ($1, $2, $3, $4, $5, 'inicial')`, [E.B, sede, p, id, u]);
    return id;
  };
  const vencido = await lote(gasas, "VENCIDO", dia(-5), 50), pronto = await lote(gasas, "PRONTO", dia(40), 15), lejos = await lote(gasas, "LEJOS", dia(400), 100);
  await lote(control, "C1", dia(300), 30);
  return { sede, gasas, control, vencido, pronto, lejos };
}

/** fn como el usuario indicado (rol authenticated + claims), con la preparación hecha como superusuario en la misma
 *  transacción; todo se deshace al final. */
async function como(uid, fn, modo) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    const d = await preparar(c, modo);
    const quien = async (u) => {
      await c.query("reset role");
      await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: u, role: "authenticated" })]);
      await c.query("set local role authenticated");
    };
    await quien(uid);
    return await fn(c, d, quien);
  } finally { await c.query("rollback").catch(() => {}); c.release(); }
}
const base = (d, extra = {}) => ({ empresa_id: E.B, sede_id: d.sede, destinatario_tipo: "servicio", destinatario: "Urgencias  adultos", servicio: "Urgencias",
  autoriza: "Jefe de enfermería", lineas: [{ producto_id: d.gasas, presentacion: "unidad", cantidad: 20 }], ...extra });
const entregar = async (c, p) => (await c.query(`select registrar_entrega($1) r`, [p])).rows[0].r;
const conSavepoint = async (c, fn) => { await c.query("savepoint s"); try { return await fn(); } catch (e) { await c.query("rollback to savepoint s"); throw e; } };

test("la migración 049 se puede aplicar otra vez sin error", async () => {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query(readFileSync(new URL("../db/migrations/049_modo_interno.sql", import.meta.url), "utf8"));
    assert.equal((await c.query(`select count(*)::int n from empresas where modo <> 'venta'`)).rows[0].n, 0, "nadie queda en modo interno por la migración");
  } finally { await c.query("rollback"); c.release(); }
});

test("en modo interno la base no deja crear ventas; lo histórico importado no lo frena el modo", async () => {
  await como(U.duenoB, async (c) => {
    await c.query("reset role");
    await assert.rejects(conSavepoint(c, () => c.query(`insert into ventas (empresa_id) values ($1)`, [E.B])), /modo interno \(sin DIAN\): no vende ni factura/);
    // Lo histórico importado (origen) no es una venta nueva: no lo frena el modo (falla después por otras columnas).
    await assert.rejects(conSavepoint(c, () => c.query(`insert into ventas (empresa_id, origen) values ($1, 'alegra')`, [E.B])), (e) => !/modo interno/.test(e.message));
  });
});

test("entrega: número consecutivo, lotes por vencimiento (nunca el vencido), movimientos y auditoría", async () => {
  const r = await como(U.cajera, async (c, d) => {
    const a = await entregar(c, base(d));
    const b = await entregar(c, base(d, { destinatario_tipo: "empleado", destinatario: "Ana Pérez", documento: "1.234.567", lineas: [{ producto_id: d.gasas, presentacion: "caja", cantidad: 1 }] }));
    const lineas = (await c.query(`select lo.lote, el.unidades, el.cantidad::float from entrega_lineas el join lotes lo on lo.id = el.lote_id where el.entrega_id = $1 order by el.id`, [a.entrega_id])).rows;
    const movs = (await c.query(`select tipo, sum(cantidad)::int u from movimientos where ref_id = $1 group by tipo`, [a.entrega_id])).rows;
    const vencido = (await c.query(`select unidades from v_stock_lotes where lote_id = $1`, [d.vencido])).rows[0].unidades;
    const ent = (await c.query(`select destinatario, documento, unidades from entregas where id = $1`, [b.entrega_id])).rows[0];
    await c.query("reset role"); // la auditoría la lee la gerencia; aquí se cuenta como superusuario
    const aud = (await c.query(`select count(*)::int n from auditoria where entidad = 'entregas' and accion = 'entrega_interna'`)).rows[0].n;
    return { a, b, lineas, movs, vencido, ent, aud };
  });
  assert.equal(r.a.numero, 1); assert.equal(r.b.numero, 2);
  assert.deepEqual(r.lineas, [{ lote: "PRONTO", unidades: 15, cantidad: 15 }, { lote: "LEJOS", unidades: 5, cantidad: 5 }]);
  assert.deepEqual(r.movs, [{ tipo: "entrega", u: -20 }]);
  assert.equal(r.vencido, 50, "el lote vencido no se toca");
  assert.deepEqual(r.ent, { destinatario: "Ana Pérez", documento: "1234567", unidades: 10 });
  assert.equal(r.aud, 2);
});

test("la misma entrega enviada dos veces se registra una sola vez", async () => {
  const r = await como(U.cajera, async (c, d) => {
    const p = base(d, { idem_key: "entrega-prueba-0001" });
    const a = await entregar(c, p), b = await entregar(c, p);
    return { a, b, n: (await c.query(`select count(*)::int n from entregas where empresa_id = $1`, [E.B])).rows[0].n };
  });
  assert.equal(r.a.entrega_id, r.b.entrega_id); assert.equal(r.b.repetida, true); assert.equal(r.n, 1);
});

test("sin existencias vigentes suficientes no entrega, y dice por qué", async () => {
  await como(U.cajera, async (c, d) => {
    await assert.rejects(conSavepoint(c, () => entregar(c, base(d, { lineas: [{ producto_id: d.gasas, presentacion: "unidad", cantidad: 116 }] }))), /vencido y no se entrega/);
    await assert.rejects(conSavepoint(c, () => entregar(c, base(d, { autoriza: "" }))), /quién autoriza/);
    await assert.rejects(conSavepoint(c, () => entregar(c, base(d, { lineas: [] }))), /al menos un producto/);
  });
});

test("en modo venta no hay entregas; otra droguería ni registra ni ve las entregas", async () => {
  await como(U.duenoB, async (c, d) => {
    await assert.rejects(conSavepoint(c, () => entregar(c, base(d))), /modo droguería interna/);
  }, "venta");
  await como(U.carlos, async (c, d, quien) => {
    await assert.rejects(conSavepoint(c, () => entregar(c, base(d))), /No tienes permiso/);
    await quien(U.duenoB);
    await entregar(c, base(d));
    await quien(U.carlos);
    assert.equal((await c.query(`select count(*)::int n from entregas`)).rows[0].n, 0);
    assert.equal((await c.query(`select count(*)::int n from entrega_lineas`)).rows[0].n, 0);
  });
});

test("controlado: sin fórmula completa no sale; con ella queda en el libro de control como dispensación", async () => {
  const r = await como(U.cajera, async (c, d) => {
    const linea = [{ producto_id: d.control, presentacion: "unidad", cantidad: 6 }];
    await assert.rejects(conSavepoint(c, () => entregar(c, base(d, { lineas: linea }))), /tipo de documento del paciente/);
    await assert.rejects(conSavepoint(c, () => entregar(c, base(d, { lineas: linea, formula: { paciente_tipo_doc: "CC", paciente_doc: "123456", paciente_nombre: "Paciente Prueba",
      medico_nombre: "Dra. Prueba", medico_registro: "RM-1", formula_numero: "R-1", formula_fecha: dia(-60) } }))), /ya no está vigente/);
    const e = await entregar(c, base(d, { lineas: linea, formula: { paciente_tipo_doc: "cc", paciente_doc: "123.456", paciente_nombre: "Paciente Prueba",
      medico_nombre: "Dra. Prueba", medico_registro: "rm-1", formula_numero: "r-77", formula_fecha: hoy() } }));
    const libro = (await c.query(`select tipo, salida, reintegro, prefijo, numero::int, entrega_id, venta_id, paciente_doc, formula_numero from v_libro_control where producto_id = $1`, [d.control])).rows;
    return { e, libro };
  });
  assert.deepEqual(r.libro, [{ tipo: "dispensacion", salida: 6, reintegro: 0, prefijo: "EI-", numero: r.e.numero, entrega_id: r.e.entrega_id, venta_id: null, paciente_doc: "123456", formula_numero: "R-77" }]);
});

test("anular: solo la gerencia, con motivo; devuelve al mismo lote, una sola vez; la entrega no se edita ni se borra", async () => {
  const r = await como(U.cajera, async (c, d, quien) => {
    const e = await entregar(c, base(d));
    await assert.rejects(conSavepoint(c, () => c.query(`select anular_entrega($1, 'error de digitación')`, [e.entrega_id])), /dueño o el administrador/);
    await quien(U.duenoB);
    await assert.rejects(conSavepoint(c, () => c.query(`select anular_entrega($1, 'no')`, [e.entrega_id])), /motivo/);
    const res = (await c.query(`select anular_entrega($1, 'Se registró en el servicio equivocado') r`, [e.entrega_id])).rows[0].r;
    await assert.rejects(conSavepoint(c, () => c.query(`select anular_entrega($1, 'otra vez')`, [e.entrega_id])), /ya estaba anulada/);
    const stock = (await c.query(`select lote, unidades from v_stock_lotes where lote_id in ($1, $2) order by lote desc`, [d.pronto, d.lejos])).rows;
    const ent = (await c.query(`select anulada is not null anulada, anulada_motivo from entregas where id = $1`, [e.entrega_id])).rows[0];
    await c.query("reset role");
    await assert.rejects(conSavepoint(c, () => c.query(`update entregas set destinatario = 'Otro' where id = $1`, [e.entrega_id])), /no se modifican/);
    await assert.rejects(conSavepoint(c, () => c.query(`delete from entregas where id = $1`, [e.entrega_id])), /no se borran/);
    await assert.rejects(conSavepoint(c, () => c.query(`update entrega_lineas set unidades = 1 where entrega_id = $1`, [e.entrega_id])), /no se modifican ni se borran/);
    return { res, stock, ent };
  });
  assert.equal(r.res.unidades, 20);
  assert.deepEqual(r.stock, [{ lote: "PRONTO", unidades: 15 }, { lote: "LEJOS", unidades: 100 }]);
  assert.deepEqual(r.ent, { anulada: true, anulada_motivo: "Se registró en el servicio equivocado" });
});

test("predicción de compras: cuenta el consumo de las entregas y no el de las anuladas", async () => {
  const r = await como(U.duenoB, async (c, d) => {
    // 7 ayer y 7 hoy: consumo en dos días distintos (un pedido puntual no es ritmo, 055).
    const ayer = await entregar(c, base(d, { lineas: [{ producto_id: d.gasas, presentacion: "unidad", cantidad: 7 }] }));
    await c.query("reset role"); await c.query("set local session_replication_role = replica"); await c.query(`update movimientos set creado = creado - interval '1 day' where tipo = 'entrega' and ref_id = $1`, [ayer.entrega_id]); await c.query("set local session_replication_role = origin"); await c.query("set local role authenticated");
    await entregar(c, base(d, { lineas: [{ producto_id: d.gasas, presentacion: "unidad", cantidad: 7 }] }));
    const anular = await entregar(c, base(d, { lineas: [{ producto_id: d.gasas, presentacion: "unidad", cantidad: 50 }] }));
    await c.query(`select anular_entrega($1, 'Prueba de anulación')`, [anular.entrega_id]);
    return (await c.query(`select venta_dia::float, ultima_venta::text from prediccion_productos($1) where producto_id = $2`, [E.B, d.gasas])).rows[0];
  });
  assert.equal(r.venta_dia, 0.6, "14 unidades en 14 días: 0,6 × 14/14");
  assert.equal(r.ultima_venta, hoy());
});

test("una droguería de prueba con entregas se puede eliminar desde la consola", async () => {
  const c = await pool.connect();
  try {
    await c.query("begin");
    const d = await preparar(c);
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: U.duenoB, role: "authenticated" })]);
    await c.query("set local role authenticated");
    await entregar(c, base(d));
    await c.query("reset role");
    await c.query(`update empresas set estado = 'suspendida' where id = $1`, [E.B]);
    await c.query(`select eliminar_empresa_prueba($1)`, [E.B]);
    assert.equal((await c.query(`select count(*)::int n from entregas where empresa_id = $1`, [E.B])).rows[0].n, 0);
  } finally { await c.query("rollback"); c.release(); }
});
