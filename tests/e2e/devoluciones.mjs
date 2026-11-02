// Devolución parcial: desde el detalle de la venta, las unidades vuelven al lote, se genera la nota crédito por lo
// devuelto, no se devuelve más de lo vendido, la última devolución cuadra al peso, la venta con devoluciones ya no se
// anula entera, la cajera no devuelve, la venta a crédito baja el saldo y el comprobante se imprime.
// Uso: servidor en :4500 (REGENTA_DEMO=1) con la base sembrada → node tests/e2e/devoluciones.mjs
import { chromium } from "playwright-core";
import pg from "pg";

const B = process.env.BASE ?? "http://localhost:4500";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/regenta?host=/tmp" });
let fallos = 0;
const ok = (c, m, x = "") => { console.log(`${c ? "PASS" : "FAIL"} ${m}${x ? " — " + x : ""}`); if (!c) fallos++; };
const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium" });
{ const nc = b.newContext.bind(b); b.newContext = async (o) => { const c = await nc(o); await c.addInitScript(() => { try { sessionStorage.setItem("regenta_demo_v1", JSON.stringify({ hechos: [], ofertas: ["prueba", "prueba"], cerrada: true, inicio: Date.now() })); } catch {} }); return c; }; }

async function entrar(quien) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(B + "/entrar"); await p.getByRole("button", { name: new RegExp(quien) }).click(); await p.waitForURL(/\/(caja|inicio)/);
  return { ctx, p, errs };
}
const api = (p, url, metodo, cuerpo) => p.evaluate(async ([u, m, c]) => { const r = await fetch(u, { method: m, headers: { "content-type": "application/json" }, body: JSON.stringify(c) }); return { status: r.status, j: await r.json().catch(() => ({})) }; }, [url, metodo, cuerpo]);
const stock = async (lote) => Number((await pool.query(`select coalesce(sum(cantidad), 0) u from movimientos where lote_id = $1`, [lote])).rows[0].u);

const { ctx, p, errs } = await entrar("Carlos");
// Venta de 3 unidades sueltas en efectivo
const prod = await p.evaluate(async () => (await (await fetch("/api/productos?q=acetaminofen forte")).json()).productos[0]);
const v = await api(p, "/api/ventas", "POST", { idem_key: crypto.randomUUID(), tipo_doc: "pos", lineas: [{ producto_id: prod.id, presentacion: "unidad", cantidad: 3 }], pagos: [{ medio: "efectivo", valor: 50000 }] });
ok(v.status === 200, "venta de 3 unidades", String(v.status));
const venta = v.j.venta.venta_id, totalVenta = Number(v.j.venta.total);
const lote = (await pool.query(`select lote_id from venta_lineas where venta_id = $1 order by id limit 1`, [venta])).rows[0].lote_id;
const antes = await stock(lote);

// Devolver 1 desde la pantalla
await p.goto(B + `/ventas/${venta}`);
await p.getByRole("button", { name: "Devolver productos" }).click();
await p.getByLabel(/Cantidad a devolver de/).first().fill("1");
await p.fill("#dev-motivo", "No lo necesitó");
await p.getByRole("button", { name: "Registrar devolución" }).click();
await p.getByRole("heading", { name: "Devoluciones" }).waitFor({ timeout: 15000 }).catch(async (e) => { await p.screenshot({ path: "/tmp/claude-0/capturas/dev-fallo.png", fullPage: true }); console.log("ALERTA", await p.getByRole("alert").allInnerTexts()); throw e; });
const dev = (await pool.query(`select * from devoluciones where venta_id = $1`, [venta])).rows;
ok(dev.length === 1 && Number(dev[0].total) === Math.round(totalVenta / 3), "registra la devolución de 1 de 3", `${dev[0]?.total} de ${totalVenta}`);
ok(await stock(lote) === antes + 1, "la unidad vuelve a su lote");
const nc = (await pool.query(`select tipo, estado from documentos_dian where devolucion_id = $1`, [dev[0].id])).rows[0];
ok(nc?.tipo === "nota_credito", "genera la nota crédito por lo devuelto", nc ? `${nc.tipo} ${nc.estado}` : "sin nota");
ok(await p.getByText(/Devuelto: 1 und/).count() === 1, "la tirilla marca lo devuelto");
ok(await p.getByRole("button", { name: "Anular venta" }).count() === 0, "con devoluciones ya no se ofrece anular la venta entera");

// No más de lo vendido
const mas = await api(p, `/api/ventas/${venta}/devolucion`, "POST", { motivo: "prueba de tope", lineas: [{ producto_id: prod.id, presentacion: "unidad", cantidad: 5 }] });
ok(mas.status === 422 && /más de lo que queda/.test(mas.j.error), "no deja devolver más de lo que queda", `${mas.status} ${mas.j.error}`);
const anula = await api(p, `/api/ventas/${venta}`, "DELETE", { motivo: "intento de anular" });
ok(anula.status === 422 && /devoluciones/.test(anula.j.error), "la venta con devoluciones no se anula entera", `${anula.status}`);

// Devolver lo que queda: cuadra al peso
const resto = await api(p, `/api/ventas/${venta}/devolucion`, "POST", { motivo: "Devuelve el resto", medio: "nequi", lineas: [{ producto_id: prod.id, presentacion: "unidad", cantidad: 2 }] });
ok(resto.status === 200, "devuelve lo que queda", String(resto.status));
const vv = (await pool.query(`select total, devuelto from ventas where id = $1`, [venta])).rows[0];
ok(Number(vv.devuelto) === Number(vv.total), "lo devuelto suma exactamente el total de la venta", `${vv.devuelto} = ${vv.total}`);
await p.reload();
ok(await p.getByRole("button", { name: "Devolver productos" }).count() === 0, "sin nada por devolver, ya no se ofrece devolver");

// Comprobante
const t = await ctx.newPage(); await t.goto(B + `/tiquete/devolucion/${dev[0].id}`);
const txt = await t.locator("main").innerText();
ok(/DEVOLUCIÓN/.test(txt) && /Reembolso/.test(txt) && /No lo necesitó/.test(txt), "comprobante de devolución imprimible");

// Venta a crédito: la devolución baja el saldo
const cred = (await pool.query(`select v.id, vl.producto_id, vl.presentacion from ventas v join venta_lineas vl on vl.venta_id = v.id
  where v.condicion = 'credito' and v.estado = 'cerrada' and v.devuelto = 0 and v.empresa_id = (select id from empresas where demo limit 1)
  and v.total - coalesce((select sum(valor) from abonos a where a.venta_id = v.id and not a.anulado), 0) > 0 order by v.creado desc limit 1`)).rows[0];
if (cred) {
  const saldoAntes = Number((await pool.query(`select v.total - v.devuelto - coalesce((select sum(valor) from abonos a where a.venta_id = v.id and not a.anulado), 0) s from ventas v where id = $1`, [cred.id])).rows[0].s);
  const r = await api(p, `/api/ventas/${cred.id}/devolucion`, "POST", { motivo: "Devolución a crédito", lineas: [{ producto_id: cred.producto_id, presentacion: cred.presentacion, cantidad: 1 }] });
  const saldoDespues = Number((await pool.query(`select v.total - v.devuelto - coalesce((select sum(valor) from abonos a where a.venta_id = v.id and not a.anulado), 0) s from ventas v where id = $1`, [cred.id])).rows[0].s);
  ok(r.status === 200 && Number(r.j.devolucion.a_saldo) > 0 && saldoDespues === saldoAntes - Number(r.j.devolucion.a_saldo), "a crédito: lo devuelto baja el saldo", `${saldoAntes} → ${saldoDespues}`);
} else ok(false, "hay una venta a crédito con saldo para probar");
ok(errs.length === 0, "sin errores de JavaScript (dueño)", errs.join(" | "));
await ctx.close();

// La cajera no devuelve
{
  const { ctx, p } = await entrar("Laura");
  const otra = await api(p, "/api/ventas", "POST", { idem_key: crypto.randomUUID(), tipo_doc: "pos", lineas: [{ producto_id: prod.id, presentacion: "unidad", cantidad: 1 }], pagos: [{ medio: "efectivo", valor: 10000 }] });
  const r = await api(p, `/api/ventas/${otra.j.venta.venta_id}/devolucion`, "POST", { motivo: "intento de cajera", lineas: [{ producto_id: prod.id, presentacion: "unidad", cantidad: 1 }] });
  ok(r.status === 403, "la cajera no registra devoluciones", String(r.status));
  await ctx.close();
}

await b.close(); await pool.end();
console.log(`\n${fallos} fallos`);
process.exit(fallos ? 1 : 0);
