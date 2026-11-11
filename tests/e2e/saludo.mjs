// Saludo de inicio personalizado (11/11/2026): solo para el correo configurado; los demás siguen con «Buenos días, …».
import { chromium } from "playwright-core";
import pg from "pg";
const B = process.env.BASE ?? "http://localhost:4500";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/regenta?host=/tmp" });
let fallos = 0; const ok = (c, m, x = "") => { console.log(`${c ? "PASS" : "FAIL"} ${m}${x ? " — " + x : ""}`); if (!c) fallos++; };
const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium" });
async function titulo(quien) {
  const ctx = await b.newContext(); await ctx.addInitScript(() => { try { sessionStorage.setItem("regenta_demo_v1", JSON.stringify({ hechos: [], ofertas: ["prueba", "prueba"], cerrada: true, inicio: Date.now() })); } catch {} });
  const p = await ctx.newPage(); await p.goto(B + "/entrar"); await p.getByRole("button", { name: new RegExp(quien) }).click(); await p.waitForURL(/\/(caja|inicio)/);
  await p.goto(B + "/inicio"); const t = await p.locator("main h1").first().innerText(); await ctx.close(); return t;
}
const [{ user_id: uid }] = (await pool.query(`select user_id from miembros where rol = 'dueno' and nombre ilike 'Carlos%' limit 1`)).rows;
// La demo no tiene cuenta con correo: se crea una de prueba para Carlos y se borra al final.
await pool.query(`delete from cuentas where id = $1`, [uid]);
const antes = await titulo("Carlos");
ok(/^(Buenos días|Buenas tardes|Buenas noches), Carlos/.test(antes), "sin saludo propio: el normal", antes);
await pool.query(`insert into cuentas (id, email, nombre) values ($1, 'carlos.nustes@farmagenericoscolombia.com', 'Carlos')`, [uid]);
const con = await titulo("Carlos");
ok(con === "KELOKE MI NEGRO LOCO, BREVE PAPI PILAS CON LAS VENTAS", "con su correo: el saludo pedido", con);
await pool.query(`delete from cuentas where id = $1`, [uid]);
const otro = await titulo("Laura");
ok(!/KELOKE/.test(otro), "los demás no lo ven", otro);
await b.close(); await pool.end(); console.log(`\n${fallos} fallos`); process.exit(fallos ? 1 : 0);
