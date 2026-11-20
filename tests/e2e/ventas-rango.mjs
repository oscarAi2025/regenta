// Ventas por rango de fechas (20/11/2026, Oscar: «no veo mis ventas, no hay tramos de tiempo»): por defecto el mes,
// periodos rápidos, rango a mano, búsqueda, totales que cuadran con la base, Regenta y Alegra juntas para el dueño (Alegra
// marcada y enlazada a su detalle), la cajera solo Regenta, paginación y celular sin desbordes.
// Uso: BASE=… DATABASE_URL=… node tests/e2e/ventas-rango.mjs
import { chromium, devices } from "playwright-core";
import pg from "pg";

const B = process.env.BASE ?? "http://localhost:4500";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/regenta?host=/tmp" });
let fallos = 0;
const ok = (c, m, x = "") => { console.log(`${c ? "PASS" : "FAIL"} ${m}${x ? " — " + x : ""}`); if (!c) fallos++; };
const num = (t) => Number(String(t).replace(/[^\d]/g, ""));
const q1 = async (sql, v = []) => (await pool.query(sql, v)).rows[0];
const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium" });
{ const nc = b.newContext.bind(b); b.newContext = async (o) => { const c = await nc(o); await c.addInitScript(() => { try { sessionStorage.setItem("regenta_demo_v1", JSON.stringify({ hechos: [], ofertas: ["prueba", "prueba"], cerrada: true, inicio: Date.now() })); } catch {} }); return c; }; }
async function entrar(quien, o = { viewport: { width: 1440, height: 900 } }) {
  const ctx = await b.newContext(o); const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => m.type() === "error" && !/status of 4\d\d/.test(m.text()) && errs.push(m.text()));
  await p.goto(B + "/entrar"); await p.getByRole("button", { name: new RegExp(quien) }).click(); await p.waitForURL(/\/(caja|inicio)/);
  return { ctx, p, errs };
}
const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
const mes1 = hoy.slice(0, 8) + "01";
const EMP = (await q1(`select id from empresas where demo limit 1`)).id;
const R = Date.now().toString(36).slice(-5).toUpperCase();
const sumaRegenta = async (d, h) => q1(`select count(*)::int n, coalesce(sum(total - coalesce(devuelto, 0)), 0)::float t from ventas
  where empresa_id = $1 and origen is null and estado = 'cerrada' and (creado at time zone 'America/Bogota')::date between $2::date and $3::date`, [EMP, d, h]);
// Una venta del historial de Alegra en este mes, para verla junto a las de Regenta.
await pool.query(`insert into ventas_externas (empresa_id, origen, externo_id, documento, prefijo, numero, fecha, cliente_nombre, cliente_doc, subtotal, total, pagado, estado, lineas)
  values ($1, 'alegra', $2, 'pos', 'POSF', 990000 + floor(random() * 9000)::int, $3, $4, '900123456', 123456, 123456, 123456, 'pagada', '[{"nombre":"Producto Alegra prueba","cantidad":1,"total":123456}]')`,
  [EMP, `prueba-${R}`, hoy, `Cliente Alegra ${R}`]);

{
  const { ctx, p, errs } = await entrar("Carlos");
  await p.goto(B + "/ventas"); await p.waitForLoadState("networkidle");
  ok(await p.getByRole("link", { name: "Este mes" }).getAttribute("aria-current") === "page", "por defecto: este mes");
  const mes = await sumaRegenta(mes1, hoy);
  const vendido = num(await p.locator('[aria-label="Resumen"] .tarjeta').first().locator("p").nth(1).innerText());
  ok(Math.abs(vendido - (mes.t + 123456)) <= 1, "«Vendido» del mes = Regenta + Alegra (cuadra con la base)", `${vendido} vs ${mes.t + 123456}`);
  ok(await p.locator('[aria-label="Resumen"]').getByText(new RegExp(`${mes.n} en Regenta · 1 de Alegra`)).count() === 1, "dice cuántas son de Regenta y cuántas de Alegra");
  const filaA = p.locator("tbody tr").filter({ hasText: `Cliente Alegra ${R}` });
  ok(await filaA.count() === 1 && /Alegra/.test(await filaA.innerText()), "la venta de Alegra aparece en la lista, marcada «Alegra»");
  await filaA.getByRole("link").first().click(); await p.waitForURL(/\/ventas\/historial\//);
  ok(await p.getByText(`Cliente Alegra ${R}`).count() >= 1, "y abre su detalle del historial");

  // Periodos rápidos y rango a mano
  await p.goto(B + "/ventas"); await p.getByRole("link", { name: "Hoy", exact: true }).click(); await p.waitForLoadState("networkidle");
  const dHoy = await sumaRegenta(hoy, hoy);
  ok(new RegExp(`${dHoy.n + 1}`).test(await p.locator('[aria-label="Resumen"]').innerText()), "«Hoy»: las de hoy (Regenta + la de Alegra)", (await p.locator('[aria-label="Resumen"]').innerText()).replace(/\n/g, " "));
  await p.getByRole("link", { name: "Este año" }).click(); await p.waitForLoadState("networkidle");
  const anio = await sumaRegenta(hoy.slice(0, 4) + "-01-01", hoy);
  ok(new RegExp(`(^|\\D)${(anio.n + 1).toLocaleString("es-CO").replace(".", "\\.")}(\\D|$)`).test(await p.locator('[aria-label="Resumen"] .tarjeta').nth(1).innerText()), "«Este año»: todas las del año", `${anio.n + 1}`);
  const desde = new Date(Date.now() - 6 * 864e5).toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
  await p.fill("#v-desde", desde); await p.fill("#v-hasta", hoy); await p.getByRole("button", { name: "Ver ventas" }).click(); await p.waitForLoadState("networkidle");
  ok(p.url().includes(`desde=${desde}`) && /Del /.test(await p.locator("main").innerText()), "rango a mano (últimos 7 días)");
  // Búsqueda por número de una venta de Regenta del periodo
  const una = await q1(`select coalesce(prefijo, '') || numero n from ventas where empresa_id = $1 and origen is null and estado = 'cerrada' and (creado at time zone 'America/Bogota')::date between $2::date and $3::date order by creado desc limit 1`, [EMP, desde, hoy]);
  if (una) {
    await p.fill("#v-q", una.n); await p.getByRole("button", { name: "Ver ventas" }).click(); await p.waitForLoadState("networkidle");
    ok(await p.locator("tbody tr").filter({ hasText: una.n }).count() >= 1, `búsqueda por número (${una.n})`);
  }
  // Solo Regenta / solo Alegra
  await p.goto(B + `/ventas?origen=alegra&desde=${mes1}&hasta=${hoy}`); await p.waitForLoadState("networkidle");
  ok(await p.locator("tbody tr").count() === 1 && await p.locator("tbody tr").filter({ hasText: `Cliente Alegra ${R}` }).count() === 1, "«Solo historial de Alegra»");
  // Paginación con muchas ventas (este año en la demo)
  await p.goto(B + `/ventas?desde=${hoy.slice(0, 4)}-01-01&hasta=${hoy}`); await p.waitForLoadState("networkidle");
  const total = (await q1(`select (select count(*) from ventas where empresa_id = $1 and origen is null and estado in ('cerrada', 'anulada') and (creado at time zone 'America/Bogota')::date >= $2::date)
    + (select count(*) from ventas_externas where empresa_id = $1 and estado <> 'borrador' and fecha >= $2::date) n`, [EMP, hoy.slice(0, 4) + "-01-01"])).n;
  ok(await p.locator("tbody tr").count() === Math.min(50, Number(total)), "50 por página", `${await p.locator("tbody tr").count()} de ${total}`);
  if (Number(total) > 50) {
    await p.getByRole("link", { name: "Siguiente" }).click(); await p.waitForLoadState("networkidle");
    ok(p.url().includes("pagina=2") && await p.locator("tbody tr").count() >= 1, "página 2");
  }
  // Compatibilidad con enlaces viejos ?dia=
  await p.goto(B + `/ventas?dia=${hoy}`); await p.waitForLoadState("networkidle");
  ok(await p.getByRole("link", { name: "Hoy", exact: true }).getAttribute("aria-current") === "page", "?dia= de enlaces viejos sigue funcionando");
  ok(errs.length === 0, "sin errores en el navegador (dueño)", errs.join(" | "));
  await ctx.close();
}
{
  const { ctx, p, errs } = await entrar("Laura");
  await p.goto(B + "/ventas"); await p.waitForLoadState("networkidle");
  ok(await p.locator("tbody tr").filter({ hasText: `Cliente Alegra ${R}` }).count() === 0, "la cajera ve sus ventas de Regenta, no el historial de Alegra");
  ok(await p.getByRole("link", { name: "Este mes" }).count() === 1, "y también filtra por periodo");
  ok(errs.length === 0, "sin errores en el navegador (cajera)", errs.join(" | "));
  await ctx.close();
}
{
  const { ctx, p, errs } = await entrar("Carlos", { ...devices["iPhone 13"] });
  await p.goto(B + "/ventas"); await p.waitForLoadState("networkidle");
  const ancho = await p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  ok(ancho <= 1, "celular: la página no se sale de lado", String(ancho));
  ok(errs.length === 0, "sin errores en el navegador (celular)", errs.join(" | "));
  await ctx.close();
}
await pool.query(`delete from ventas_externas where empresa_id = $1 and externo_id = $2`, [EMP, `prueba-${R}`]);
await b.close(); await pool.end();
console.log(fallos ? `\n${fallos} FALLOS` : "\nTODO OK");
process.exit(fallos ? 1 : 0);
