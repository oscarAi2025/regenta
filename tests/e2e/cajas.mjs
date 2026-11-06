// Varias cajas en la misma droguería: cada computadora elige su caja; la venta y el turno quedan en esa caja, y una
// caja ajena o desactivada no se puede usar. Uso: servidor en :4500 (REGENTA_DEMO=1) con la base sembrada.
import pg from "pg";
import { chromium } from "playwright-core";

const B = process.env.BASE ?? "http://localhost:4500";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/regenta?host=/tmp" });
let fallos = 0;
const ok = (c, m, x = "") => { console.log(`${c ? "PASS" : "FAIL"} ${m}${x ? " — " + x : ""}`); if (!c) fallos++; };
const E = "10000000-0000-4000-8000-00000000000a";

// La demo trae una caja: se le agrega otra para la prueba (la consola de la demo no deja crearlas).
const sede = (await pool.query(`select sede_id from cajas where empresa_id = $1 limit 1`, [E])).rows[0].sede_id;
const c2 = (await pool.query(`insert into cajas (empresa_id, sede_id, nombre) values ($1, $2, 'Caja Fondo') returning id`, [E, sede])).rows[0].id;
const ajena = (await pool.query(`select id from cajas where empresa_id <> $1 limit 1`, [E])).rows[0]?.id;

const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium" });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => { try { sessionStorage.setItem("regenta_demo_v1", JSON.stringify({ hechos: [], ofertas: ["prueba", "prueba"], cerrada: true, inicio: Date.now() })); } catch {} });
const p = await ctx.newPage();
await p.goto(B + "/entrar"); await p.getByRole("button", { name: /Carlos/ }).click(); await p.waitForURL(/inicio/);
await p.goto(B + "/caja"); await p.waitForLoadState("networkidle");
const sel = p.getByLabel("Caja de esta computadora");
ok(await sel.count() === 1, "con dos cajas, la caja pregunta cuál es esta computadora");
await sel.selectOption(c2); await p.waitForLoadState("networkidle");
ok(await p.getByLabel("Caja de esta computadora").inputValue() === c2, "queda elegida «Caja Fondo» en este navegador");

const prod = (await (await p.request.get(B + "/api/productos?q=acetaminofen")).json()).productos.find((x) => x.unidades > 5);
const venta = async () => (await (await p.request.post(B + "/api/ventas", { headers: { origin: B }, data: { idem_key: crypto.randomUUID(), tipo_doc: "pos", lineas: [{ producto_id: prod.id, presentacion: "unidad", cantidad: 1 }], pagos: [{ medio: "efectivo", valor: 50000 }] } })).json()).venta;
const v1 = await venta();
ok((await pool.query(`select caja_id from ventas where id = $1`, [v1.venta_id])).rows[0].caja_id === c2, "la venta queda en la caja elegida");
const t = await p.request.post(B + "/api/turnos", { headers: { origin: B }, data: { accion: "abrir", base: 100000 } });
const tj = await t.json();
ok(t.ok() && (await pool.query(`select caja_id from turnos where id = $1`, [tj.turno])).rows[0]?.caja_id === c2, "el turno se abre en la caja elegida", JSON.stringify(tj).slice(0, 120));
await p.goto(B + "/turno"); await p.waitForLoadState("networkidle");
ok(await p.getByLabel("Caja de esta computadora").inputValue() === c2, "Turno muestra la misma caja");

// Una caja de otra droguería o una desactivada no se puede usar: se vuelve a la primera caja activa
if (ajena) {
  await ctx.addCookies([{ name: "regenta_caja", value: ajena, url: B }]);
  const v2 = await venta();
  ok((await pool.query(`select caja_id from ventas where id = $1`, [v2.venta_id])).rows[0].caja_id !== ajena, "una caja de otra droguería no se usa");
}
// La cajera solo toca el turno de la caja donde trabaja (revisión de seguridad 06/11): desde otra caja no registra salidas
// ni cierra el turno ajeno; un turno de otra droguería ni existe para ella.
{
  const cj = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const q = await cj.newPage();
  await q.request.post(B + "/demo", { form: { rol: "cajero" } });
  const c1 = (await pool.query(`select id from cajas where empresa_id = $1 and id <> $2 and activa order by nombre, id limit 1`, [E, c2])).rows[0].id;
  await cj.addCookies([{ name: "regenta_caja", value: c1, url: B }]);
  const mov = (turno) => q.request.post(B + "/api/turnos", { headers: { origin: B }, data: { accion: "movimiento", turno, tipo: "egreso", valor: 1000, concepto: "Prueba otra caja" } });
  const r1 = await mov(tj.turno);
  ok(r1.status() === 403 && /otra caja/.test((await r1.json()).error ?? ""), "la cajera de otra caja no registra salidas en este turno", String(r1.status()));
  const r2 = await q.request.post(B + "/api/turnos", { headers: { origin: B }, data: { accion: "cerrar", turno: tj.turno, contado: 1 } });
  ok(r2.status() === 403, "ni lo cierra", String(r2.status()));
  const otraEmp = (await pool.query(`select t.id from turnos t where t.empresa_id <> $1 limit 1`, [E])).rows[0]?.id;
  if (otraEmp) { const r3 = await mov(otraEmp); ok(r3.status() === 400, "un turno de otra droguería no existe para ella", String(r3.status())); }
  await cj.addCookies([{ name: "regenta_caja", value: c2, url: B }]);
  const r4 = await mov(tj.turno);
  ok(r4.ok(), "desde su caja sí registra la salida", String(r4.status()));
  await cj.close();
}
const cierre = await p.request.post(B + "/api/turnos", { headers: { origin: B }, data: { accion: "cerrar", turno: tj.turno, contado: 100000 } });
ok(cierre.ok(), "el turno de esa caja se cierra", String(cierre.status()));
await pool.query(`update cajas set activa = false where id = $1`, [c2]);
await ctx.addCookies([{ name: "regenta_caja", value: c2, url: B }]);
const v3 = await venta();
ok((await pool.query(`select caja_id from ventas where id = $1`, [v3.venta_id])).rows[0].caja_id !== c2, "una caja desactivada no se usa");
await p.goto(B + "/caja"); await p.waitForLoadState("networkidle");
ok(await p.getByLabel("Caja de esta computadora").count() === 0, "con una sola caja activa no se pregunta nada");

await b.close(); await pool.end();
console.log(`\n${fallos} fallos`);
process.exit(fallos ? 1 : 0);
