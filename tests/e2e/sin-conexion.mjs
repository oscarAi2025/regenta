// Venta sin internet: la caja busca en el catálogo guardado, cobra con tiquete POS y entrega comprobante provisional;
// al volver la conexión las ventas se registran solas, sin duplicarse aunque se envíen dos veces. La factura
// electrónica exige conexión.
// Uso: servidor en :4500 (REGENTA_DEMO=1) con la base sembrada → node tests/e2e/sin-conexion.mjs
import { chromium } from "playwright-core";
import pg from "pg";

const B = process.env.BASE ?? "http://localhost:4500";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/regenta?host=/tmp" });
let fallos = 0;
const ok = (c, m, x = "") => { console.log(`${c ? "PASS" : "FAIL"} ${m}${x ? " — " + x : ""}`); if (!c) fallos++; };
const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium" });
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
await ctx.addInitScript(() => { try { sessionStorage.setItem("regenta_demo_v1", JSON.stringify({ hechos: [], ofertas: ["prueba", "prueba"], cerrada: true, inicio: Date.now() })); } catch {} });
const p = await ctx.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
await p.goto(B + "/entrar"); await p.getByRole("button", { name: /Laura/ }).click(); await p.waitForURL(/\/caja/);
await p.waitForFunction(() => { try { return (JSON.parse(localStorage.getItem("regenta.catalogo") ?? "null")?.productos?.length ?? 0) > 100; } catch { return false; } }, null, { timeout: 20000 });
ok(true, "la caja guarda el catálogo para trabajar sin internet");

const vender = async (texto) => {
  await p.locator("#buscar").fill(texto); await p.waitForSelector('[aria-label="Resultados"] [role="option"]'); await p.keyboard.press("Enter");
  await p.keyboard.press("F9"); await p.waitForSelector("#recibido"); await p.fill("#recibido", "100000");
  await p.getByRole("button", { name: /Confirmar/ }).click();
};

// Sin internet
await ctx.setOffline(true);
await p.getByText(/Sin internet: sigues vendiendo/).waitFor({ timeout: 5000 }).catch(() => {});
await p.locator("#buscar").fill("acetaminofen forte mk");
await p.waitForSelector('[role="option"]', { timeout: 5000 }).catch(() => {});
ok(await p.locator('[role="option"]').count() > 0, "sin internet la búsqueda usa el catálogo guardado");
await p.locator("#buscar").fill("");
await vender("acetaminofen forte mk");
await p.getByText("Venta guardada sin internet").waitFor({ timeout: 8000 }).catch(() => {});
ok(await p.getByText("Venta guardada sin internet").isVisible(), "cobra sin internet y muestra el comprobante provisional");
ok(await p.locator('iframe[title="Comprobante provisional"]').count() === 1, "manda a imprimir el comprobante provisional");
await p.getByRole("button", { name: /Nueva venta/ }).click();
await vender("dolex");
await p.getByText("Venta guardada sin internet").waitFor({ timeout: 8000 });
const cola = await p.evaluate(() => JSON.parse(localStorage.getItem("regenta.cola_ventas") ?? "[]"));
ok(cola.length === 2, "dos ventas en la cola de esta caja", String(cola.length));
ok(await p.getByText(/2 ventas guardadas en esta caja/).isVisible(), "la caja avisa cuántas ventas esperan");
// Factura sin internet: no
await p.getByRole("button", { name: /Nueva venta/ }).click();
await p.locator("#buscar").fill("acetaminofen forte mk"); await p.waitForSelector('[aria-label="Resultados"] [role="option"]'); await p.keyboard.press("Enter");
await p.getByRole("button", { name: "Factura electrónica" }).click();
ok(await p.getByRole("button", { name: /Cobrar/ }).first().isDisabled(), "sin cliente no se puede facturar (y sin internet tampoco se busca)");
await p.getByRole("button", { name: "Tiquete POS" }).click();
await p.getByRole("button", { name: /Quitar/ }).first().click();

// Vuelve internet: se registran solas
const antes = Number((await pool.query(`select count(*) n from ventas where idem_key = any($1)`, [cola.map((v) => v.idem_key)])).rows[0].n);
ok(antes === 0, "mientras no hay internet no hay nada en la base");
await ctx.setOffline(false);
await p.getByText(/quedaron registradas/).waitFor({ timeout: 30000 }).catch(() => {});
const despues = (await pool.query(`select v.id, v.total, d.estado from ventas v left join documentos_dian d on d.venta_id = v.id where v.idem_key = any($1)`, [cola.map((v) => v.idem_key)])).rows;
ok(despues.length === 2, "al volver internet las dos ventas quedan registradas", String(despues.length));
{
  // Cada una con la hora en que se vendió (no la de la sincronización): queda en su día, su turno y su arqueo.
  const horas = (await pool.query(`select idem_key, creado from ventas where idem_key = any($1)`, [cola.map((v) => v.idem_key)])).rows;
  ok(horas.length === 2 && horas.every((h) => Math.abs(new Date(h.creado).getTime() - new Date(cola.find((v) => v.idem_key === h.idem_key).creado).getTime()) < 2000),
    "cada venta queda con la hora real en que se hizo sin internet");
}
ok(despues.every((v) => v.estado), "y cada una con su documento electrónico en camino", despues.map((v) => v.estado).join(","));
ok(despues.reduce((a, v) => a + Number(v.total), 0) === cola.reduce((a, v) => a + v.total, 0), "los totales registrados son los cobrados");
ok((await p.evaluate(() => JSON.parse(localStorage.getItem("regenta.cola_ventas") ?? "[]").length)) === 0, "la cola queda vacía");
// Reenvío de la misma venta: no se duplica
const otra = await p.evaluate(async (cuerpo) => (await (await fetch("/api/ventas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) })).json()), cola[0].cuerpo);
const n = Number((await pool.query(`select count(*) n from ventas where idem_key = $1`, [cola[0].idem_key])).rows[0].n);
ok(n === 1 && otra.venta?.repetida, "enviar dos veces la misma venta no la duplica");
ok(errs.length === 0, "sin errores de JavaScript", errs.join(" | "));
await b.close(); await pool.end();
console.log(`\n${fallos} fallos`);
process.exit(fallos ? 1 : 0);
