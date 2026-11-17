// Carga en entorno local (NUNCA contra producción): N cajas cobrando a la vez por HTTP, con la base y el servidor reales.
// Mide latencia (p50/p95/máx) y comprueba la integridad: N ventas, existencias que bajan exactamente N y cero negativos;
// además la búsqueda de productos de la caja bajo la misma concurrencia.
// Uso: BASE=http://localhost:4505 DATABASE_URL=… REGENTA_SESSION_SECRET=… node tests/carga/ventas.mjs 5 20 50 100
import pg from "pg";
import { SignJWT } from "jose";
const B = process.env.BASE ?? "http://localhost:4505";
if (!/localhost|127\.0\.0\.1/.test(B)) throw new Error("La prueba de carga solo corre contra un servidor local");
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const emp = (await pool.query(`select id from empresas where demo limit 1`)).rows[0].id;
const cookie = "regenta_sesion=" + await new SignJWT({ uid: "00000000-0000-4000-8000-000000000002", empresa: emp, nombre: "Laura", rol: "cajero", v: 0 })
  .setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h").sign(new TextEncoder().encode(process.env.REGENTA_SESSION_SECRET));
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return Math.round(s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]); };
const filas = [];
for (const n of process.argv.slice(2).map(Number)) {
  const prod = (await pool.query(`select p.id from productos p where p.empresa_id = $1 and p.activo and not p.requiere_formula and not p.control_especial and p.precio_unidad is not null
      and (select coalesce(sum(unidades), 0) from v_stock_vigente v where v.producto_id = p.id) >= $2 order by random() limit 1`, [emp, n + 5])).rows[0];
  const stock = async () => Number((await pool.query(`select coalesce(sum(unidades), 0) u from v_stock_lotes where producto_id = $1`, [prod.id])).rows[0].u);
  const antes = await stock(), t0 = Date.now(), lat = [];
  const r = await Promise.all(Array.from({ length: n }, async () => {
    const t = Date.now();
    const x = await fetch(B + "/api/ventas", { method: "POST", headers: { origin: B, cookie, "content-type": "application/json" },
      body: JSON.stringify({ idem_key: crypto.randomUUID(), tipo_doc: "pos", lineas: [{ producto_id: prod.id, presentacion: "unidad", cantidad: 1 }], pagos: [{ medio: "efectivo", valor: 1000000 }] }) });
    lat.push(Date.now() - t); return x.status;
  }));
  const total = Date.now() - t0, despues = await stock();
  const neg = Number((await pool.query(`select count(*) n from v_stock_lotes where producto_id = $1 and unidades < 0`, [prod.id])).rows[0].n);
  const lb = [];
  await Promise.all(Array.from({ length: n }, async () => { const t = Date.now(); await fetch(B + "/api/productos?q=acetaminofen", { headers: { cookie } }); lb.push(Date.now() - t); }));
  filas.push({ concurrentes: n, ok: r.filter((s) => s === 200 || s === 201).length, errores: r.filter((s) => s >= 400).length, p50_ms: pct(lat, 50), p95_ms: pct(lat, 95), max_ms: Math.max(...lat),
    total_ms: total, stock_baja: antes - despues, negativos: neg, busqueda_p50_ms: pct(lb, 50), busqueda_p95_ms: pct(lb, 95) });
}
console.table(filas);
console.log(JSON.stringify(filas));
await pool.end();
