// Auditoría de seguridad (09/11/2026): cerrar sesión la invalida; un doble clic (dos peticiones a la vez con la misma
// clave) no duplica recibos, abonos, devoluciones ni movimientos de caja; un ZIP «bomba» se rechaza sin inflarse; la
// API no deja respuestas en caché; la bodega no lee por SQL el archivo con precios de la factura de compra.
// Uso: servidor con la base sembrada → BASE=http://localhost:4540 DATABASE_URL=… node tests/e2e/seguridad.mjs
import pg from "pg";
import { deflateRawSync } from "node:zlib";

const B = process.env.BASE ?? "http://localhost:4500";
const DB = process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/regenta?host=/tmp";
const pool = new pg.Pool({ connectionString: DB });
let fallos = 0;
const ok = (c, m, x = "") => { if (c) console.log(`PASS ${m}`); else { console.log(`FAIL ${m}${x ? " — " + x : ""}`); fallos++; } };
const q1 = async (s, v = []) => (await pool.query(s, v)).rows[0];

async function sesion(rol) {
  const r = await fetch(B + "/demo", { method: "POST", headers: { origin: B, "content-type": "application/x-www-form-urlencoded" }, body: `rol=${rol}`, redirect: "manual" });
  return r.headers.getSetCookie().map((c) => c.split(";")[0]).join("; ");
}
const api = async (cookie, ruta, metodo = "GET", cuerpo) => {
  const r = await fetch(B + ruta, { method: metodo, headers: { cookie, origin: B, ...(cuerpo ? { "content-type": "application/json" } : {}) }, body: cuerpo ? JSON.stringify(cuerpo) : undefined });
  const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch {}
  return { s: r.status, j, h: r.headers };
};

const D = await sesion("dueno");
const EMP = await q1(`select id from empresas where demo limit 1`);

// ── Cerrar sesión invalida la cookie (una copia ya no sirve)
{
  const s = await sesion("dueno");
  ok((await api(s, "/api/productos?q=a")).s === 200, "sesión: con la cookie se trabaja");
  ok((await api(s, "/api/sesion", "DELETE")).s === 200, "sesión: salir");
  ok((await api(s, "/api/productos?q=a")).s === 401, "sesión: la copia de la cookie ya no sirve después de salir");
}

// ── La API no deja datos en cachés
{
  const r = await api(D, "/api/recibos?q=a"); // lectura con sesión (conSesion)
  ok(/no-store/.test(r.h.get("cache-control") ?? ""), "API: Cache-Control no-store", r.h.get("cache-control") ?? "(sin cabecera)");
}

// ── Turno abierto en la caja del dueño (para movimientos y ventas)
const caja = (await q1(`select id from cajas where empresa_id = $1 and activa order by nombre, id limit 1`, [EMP.id])).id;
for (const t of (await pool.query(`select id from turnos where caja_id = $1 and estado = 'abierto'`, [caja])).rows) await api(D, "/api/turnos", "POST", { accion: "cerrar", turno: t.id, contado: 0 });
const turno = (await api(D, "/api/turnos", "POST", { accion: "abrir", base: 50000 })).j.turno;
ok(!!turno, "turno abierto para la prueba");

// ── Doble clic: dos peticiones a la vez con la misma clave
{
  const k = crypto.randomUUID();
  const mov = { accion: "movimiento", turno, tipo: "egreso", valor: 1234, concepto: "Doble clic prueba", idem_key: k };
  const [a, b] = await Promise.all([api(D, "/api/turnos", "POST", mov), api(D, "/api/turnos", "POST", mov)]);
  const n = (await q1(`select count(*)::int n from movimientos_caja where turno_id = $1 and concepto = 'Doble clic prueba'`, [turno])).n;
  ok(a.s === 200 && b.s === 200 && a.j.id === b.j.id && n === 1, "movimiento de caja: doble clic registra una sola salida", `${a.s}/${b.s} filas=${n}`);
}
// Cliente con una factura a crédito
const P = await q1(`select p.id, p.precio_unidad::float pu from productos p where p.empresa_id = $1 and p.activo and p.precio_unidad between 500 and 5000 and not p.requiere_formula and not p.control_especial
  and (select coalesce(sum(s.unidades), 0) from v_stock_vigente s where s.producto_id = p.id) >= 20 order by p.precio_unidad desc limit 1`, [EMP.id]);
const suf = Date.now().toString().slice(-7);
const cli = (await api(D, "/api/clientes", "POST", { tipo_doc: "CC", numero_doc: `55${suf}`, nombre: `Cliente Seguridad ${suf}`, email: `seg${suf}@prueba.example`, telefono: "3001234567", autoriza_datos: true, cupo: 1000000 })).j;
const cliId = cli.cliente?.id ?? cli.id;
ok(!!cliId, "cliente de prueba creado", JSON.stringify(cli).slice(0, 120));
await pool.query(`update clientes set cupo_credito = 1000000 where id = $1`, [cliId]).catch(() => {});
const venta = await api(D, "/api/ventas", "POST", { idem_key: crypto.randomUUID(), tipo_doc: "factura", cliente_id: cliId, condicion: "credito", plazo_dias: 30, pagos: [],
  lineas: [{ producto_id: P.id, presentacion: "unidad", cantidad: 10 }] });
const ventaId = venta.j.venta?.venta_id ?? venta.j.venta_id ?? venta.j.id;
ok([200, 201].includes(venta.s) && !!ventaId, "venta a crédito para la prueba", `${venta.s} ${JSON.stringify(venta.j).slice(0, 160)}`);
{
  const k = crypto.randomUUID();
  const c = { cliente_id: cliId, medio: "efectivo", valor: 1000, idem_key: k };
  const [a, b] = await Promise.all([api(D, "/api/recibos", "POST", c), api(D, "/api/recibos", "POST", c)]);
  const n = (await q1(`select count(*)::int n from recibos_caja where cliente_id = $1`, [cliId])).n;
  ok(a.s === 201 && b.s === 201 && a.j.recibo?.id === b.j.recibo?.id && n === 1, "recibo de cartera: doble clic registra uno solo", `${a.s}/${b.s} recibos=${n}`);
  const otro = await api(D, "/api/recibos", "POST", { ...c, idem_key: crypto.randomUUID() });
  ok(otro.s === 201 && (await q1(`select count(*)::int n from recibos_caja where cliente_id = $1`, [cliId])).n === 2, "con otra clave sí es otro recibo");
}
{
  const k = crypto.randomUUID();
  const c = { venta_id: ventaId, medio: "transferencia", valor: 500, idem_key: k };
  const [a, b] = await Promise.all([api(D, "/api/cartera", "POST", c), api(D, "/api/cartera", "POST", c)]);
  const n = (await q1(`select count(*)::int n from abonos where venta_id = $1 and valor = 500`, [ventaId])).n;
  ok(a.s === 201 && b.s === 201 && n === 1 && JSON.stringify(a.j) === JSON.stringify(b.j), "abono: doble clic registra uno solo", `${a.s}/${b.s} abonos=${n}`);
}
{
  const k = crypto.randomUUID();
  const c = { idem_key: k, motivo: "Doble clic prueba", medio: "efectivo", destino: "vendible", lineas: [{ producto_id: P.id, presentacion: "unidad", cantidad: 1 }] };
  const [a, b] = await Promise.all([api(D, `/api/ventas/${ventaId}/devolucion`, "POST", c), api(D, `/api/ventas/${ventaId}/devolucion`, "POST", c)]);
  const n = (await q1(`select count(*)::int n from devoluciones where venta_id = $1`, [ventaId])).n;
  ok(a.s === 200 && b.s === 200 && a.j.devolucion?.id === b.j.devolucion?.id && n === 1, "devolución: doble clic hace una sola (y una sola nota crédito)", `${a.s}/${b.s} devoluciones=${n}`);
}

// ── ZIP «bomba» subido como factura: se rechaza rápido, sin tumbar el servidor
{
  const plano = Buffer.alloc(14 * 1024 * 1024, 0x61); plano.write("<Invoice>", 0);
  const comp = deflateRawSync(plano, { level: 9 }), nombre = Buffer.from("f.xml");
  const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(comp.length, 18); local.writeUInt32LE(plano.length, 22); local.writeUInt16LE(nombre.length, 26);
  const cuerpo = Buffer.concat([local, nombre, comp]); const cds = [];
  for (let k = 0; k < 40; k++) { const cd = Buffer.alloc(46); cd.writeUInt32LE(0x02014b50, 0); cd.writeUInt16LE(8, 10); cd.writeUInt32LE(comp.length, 20); cd.writeUInt32LE(plano.length, 24); cd.writeUInt16LE(nombre.length, 28); cds.push(cd, nombre); }
  const dir = Buffer.concat(cds); const fin = Buffer.alloc(22); fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(40, 8); fin.writeUInt16LE(40, 10); fin.writeUInt32LE(dir.length, 12); fin.writeUInt32LE(cuerpo.length, 16);
  const fd = new FormData(); fd.append("archivo", new Blob([Buffer.concat([cuerpo, dir, fin])]), "factura.zip");
  const t = Date.now();
  const r = await fetch(B + "/api/compras/leer-factura", { method: "POST", headers: { cookie: D, origin: B }, body: fd });
  ok(r.status === 422 && Date.now() - t < 5000, "ZIP bomba: rechazado en segundos", `${r.status} ${Date.now() - t} ms`);
  ok((await fetch(B + "/")).status === 200, "el servidor sigue respondiendo");
}

// ── La bodega no lee por SQL el archivo de la factura (trae precios)
{
  const bodega = await q1(`select m.user_id from miembros m where m.empresa_id = $1 and m.rol = 'bodeguero' and m.activo limit 1`, [EMP.id]);
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query(`insert into compra_archivos (empresa_id, nombre, tipo, tamano, sha256, datos, documento) values ($1, 'prueba.xml', 'application/xml', 3, md5(random()::text) || md5(random()::text), '\\x616263', '{"totales":{"total":1234567}}'::jsonb)`, [EMP.id]);
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: bodega.user_id, role: "authenticated" })]);
    await c.query(`set local role authenticated`);
    const n = (await c.query(`select count(*)::int n from compra_archivos`)).rows[0].n;
    ok(n === 0, "bodega: no lee el archivo de la factura con precios", `filas=${n}`);
  } finally { await c.query("rollback"); c.release(); }
}

await api(D, "/api/turnos", "POST", { accion: "cerrar", turno, contado: 0 });
await pool.end();
console.log(fallos ? `\n${fallos} fallo(s)` : "\n0 fallos");
process.exit(fallos ? 1 : 0);
