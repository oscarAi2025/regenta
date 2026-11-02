// Reportes de gerencia: cifras que cuadran con la base (ventas netas, por medio, por cajero, por producto), exportar a
// Excel (CSV con «;» y BOM), rangos rápidos, la cajera no entra y en el celular no hay desbordes.
// Uso: servidor en :4500 (REGENTA_DEMO=1) con la base sembrada → node tests/e2e/reportes.mjs
import { chromium, devices } from "playwright-core";
import pg from "pg";

const B = process.env.BASE ?? "http://localhost:4500";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/regenta?host=/tmp" });
let fallos = 0;
const ok = (c, m, x = "") => { console.log(`${c ? "PASS" : "FAIL"} ${m}${x ? " — " + x : ""}`); if (!c) fallos++; };
const num = (t) => Number(String(t).replace(/[^\d-]/g, ""));
const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium" });
{ const nc = b.newContext.bind(b); b.newContext = async (o) => { const c = await nc(o); await c.addInitScript(() => { try { sessionStorage.setItem("regenta_demo_v1", JSON.stringify({ hechos: [], ofertas: ["prueba", "prueba"], cerrada: true, inicio: Date.now() })); } catch {} }); return c; }; }
async function entrar(quien, opts = { viewport: { width: 1440, height: 900 } }) {
  const ctx = await b.newContext(opts); const p = await ctx.newPage(); const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(B + "/entrar"); await p.getByRole("button", { name: new RegExp(quien) }).click(); await p.waitForURL(/\/(caja|inicio)/);
  return { ctx, p, errs };
}
const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
const desde = new Date(Date.now() - 29 * 86400000).toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
const emp = (await pool.query(`select id from empresas where demo limit 1`)).rows[0].id;
const rangoSql = `empresa_id = $1 and (creado at time zone 'America/Bogota')::date between $2::date and $3::date`;
const bruto = Number((await pool.query(`select coalesce(sum(total), 0) t from ventas where ${rangoSql} and estado = 'cerrada'`, [emp, desde, hoy])).rows[0].t);
const devuelto = Number((await pool.query(`select coalesce(sum(total), 0) t from devoluciones where ${rangoSql}`, [emp, desde, hoy])).rows[0].t);

{
  const { ctx, p, errs } = await entrar("Carlos");
  await p.getByRole("link", { name: "Reportes" }).first().click();
  await p.waitForURL(/\/reportes/, { waitUntil: "commit" });
  ok(await p.getByRole("heading", { name: "Reportes", level: 1 }).waitFor({ timeout: 15000 }).then(() => true, () => false), "el dueño entra a Reportes desde el menú");
  await p.goto(B + `/reportes?desde=${desde}&hasta=${hoy}`);
  const netas = num(await p.getByRole("region", { name: "Resumen" }).locator("p.num").first().textContent());
  ok(netas === Math.round(bruto - devuelto), "ventas netas = vendido − devuelto (cuadra con la base)", `${netas} = ${Math.round(bruto - devuelto)}`);
  for (const r of ["Por día", "Por medio de pago", "Por cajero", "Por producto"]) ok(await p.getByRole("region", { name: r }).isVisible(), `muestra «${r}»`);
  const filasProd = await p.getByRole("region", { name: "Por producto" }).locator("tbody tr").count();
  ok(filasProd > 10, "lista productos con su venta y ganancia", String(filasProd));
  const sumaMedios = (await p.getByRole("region", { name: "Por medio de pago" }).locator("li span.font-semibold").allTextContents()).map(num).reduce((a, x) => a + x, 0);
  ok(Math.abs(sumaMedios - bruto) <= 2, "los medios de pago (con crédito) suman lo vendido", `${sumaMedios} vs ${Math.round(bruto)}`);
  // Exportar
  const resp = await p.request.get(B + `/api/reportes?desde=${desde}&hasta=${hoy}&tipo=productos`);
  const cuerpo = await resp.text();
  ok(resp.ok() && cuerpo.charCodeAt(0) === 0xfeff && cuerpo.split("\r\n")[0].includes("Producto;Unidades;Devueltas;Vendido;Ganancia"), "exporta productos a CSV para Excel");
  ok((resp.headers()["content-disposition"] ?? "").includes(`regenta-productos-${desde}-a-${hoy}.csv`), "el archivo trae nombre con el rango");
  for (const t of ["cajeros", "medios", "dias"]) ok((await p.request.get(B + `/api/reportes?desde=${desde}&hasta=${hoy}&tipo=${t}`)).ok(), `exporta ${t}`);
  // Rango rápido
  const hrefHoy = await p.getByRole("link", { name: "Hoy", exact: true }).getAttribute("href");
  ok(hrefHoy === `/reportes?desde=${hoy}&hasta=${hoy}`, "rango rápido «Hoy»", hrefHoy);
  // Fechas al revés se corrigen
  await p.goto(B + `/reportes?desde=${hoy}&hasta=${desde}`);
  ok(await p.getByRole("region", { name: "Resumen" }).isVisible(), "fechas invertidas no rompen la pantalla");
  ok(errs.length === 0, "sin errores de JavaScript", errs.join(" | "));
  await ctx.close();
}
{
  const { ctx, p } = await entrar("Laura");
  await p.goto(B + "/reportes");
  await p.waitForURL(/\/inicio/, { timeout: 10000 }).catch(() => {}); // la redirección puede llegar en el flujo (hay loading)
  ok(!p.url().includes("/reportes") && !(await p.getByRole("region", { name: "Resumen" }).count()), "la cajera no ve reportes", p.url());
  ok((await p.request.get(B + "/api/reportes?tipo=productos")).status() === 403, "la cajera no exporta reportes");
  await ctx.close();
}
{
  const { ctx, p } = await entrar("Carlos", { ...devices["iPhone 13"] });
  await p.goto(B + `/reportes?desde=${desde}&hasta=${hoy}`);
  const sobra = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(sobra <= 1, "Reportes en el celular sin desborde", `${sobra}px`);
  await p.screenshot({ path: "/tmp/claude-0/capturas/reportes-celular.png", fullPage: true });
  await ctx.close();
}
await b.close(); await pool.end();
console.log(`\n${fallos} fallos`);
process.exit(fallos ? 1 : 0);
