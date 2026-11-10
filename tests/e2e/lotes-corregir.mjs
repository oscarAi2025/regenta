// Corregir lotes: el dueño o la bodega cambian el código o la fecha de vencimiento de un lote con motivo; queda en la
// auditoría, las existencias no cambian, la cajera no puede y los lotes con alerta del INVIMA no cambian de código.
// Uso: servidor con REGENTA_DEMO=1 y la base recién sembrada → node tests/e2e/lotes-corregir.mjs
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
  const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => m.type() === "error" && !/status of 4\d\d/.test(m.text()) && errs.push(m.text()));
  await p.goto(B + "/entrar"); await p.getByRole("button", { name: new RegExp(quien) }).click(); await p.waitForURL(/\/(caja|inicio)/);
  return { ctx, p, errs };
}
const api = (p, url, metodo = "GET", cuerpo) => p.evaluate(async ([u, m, c]) => {
  const r = await fetch(u, { method: m, headers: c === undefined ? {} : { "content-type": "application/json" }, body: c === undefined ? undefined : JSON.stringify(c) });
  return { status: r.status, j: await r.json().catch(() => ({})) };
}, [url, metodo, cuerpo]);
const q = async (sql, v = []) => (await pool.query(sql, v)).rows;
const iso = (d) => d.toISOString().slice(0, 10);
const enDias = (n) => iso(new Date(Date.now() + n * 864e5));

// Un producto de la demo con dos lotes con existencias (para probar el código repetido).
const [x] = await q(`select s.producto_id, p.nombre, s.empresa_id, array_agg(s.lote_id order by s.vence) lotes
  from v_stock_lotes s join productos p on p.id = s.producto_id join empresas e on e.id = s.empresa_id
  where e.demo and s.unidades > 0 and not s.bloqueado and s.vence > current_date group by 1, 2, 3 having count(*) >= 2 order by p.nombre limit 1`);
const [L1, L2] = x.lotes;
const lote = async (id) => (await q(`select l.lote, l.vence::text, (select unidades from v_stock_lotes where lote_id = l.id) u from lotes l where id = $1`, [id]))[0];
const antes1 = await lote(L1), antes2 = await lote(L2);

// ── Dueño: desde inventario, corrige la fecha y el código de un lote en pantalla
{
  const { ctx, p, errs } = await entrar("Carlos");
  await p.goto(B + "/inventario"); await p.waitForLoadState("networkidle");
  ok(await p.getByRole("link", { name: "Lotes y vencimientos" }).isVisible(), "inventario lleva a «Lotes y vencimientos»");
  await p.getByRole("link", { name: "Lotes y vencimientos" }).click(); await p.waitForURL(/\/inventario\/lotes/);
  await p.fill("#buscar-lote", x.nombre.slice(0, 18));
  ok(await p.locator('[aria-label="Resultados"] button').first().waitFor({ timeout: 8000 }).then(() => true, () => false), "la búsqueda de producto muestra resultados");
  await p.goto(B + `/inventario/lotes?producto=${x.producto_id}`); await p.waitForLoadState("networkidle");
  const nuevaFecha = enDias(400);
  await p.getByRole("button", { name: `Corregir el lote ${antes1.lote}` }).click();
  await p.fill("#corregir-codigo", "corr-" + antes1.lote.slice(0, 20));
  await p.fill("#corregir-vence", nuevaFecha);
  await p.getByRole("button", { name: "Guardar corrección" }).click();
  ok(/Escribe por qué/.test(await p.locator('[role="alert"]').first().textContent()), "sin motivo no guarda");
  await p.fill("#corregir-motivo", "Fecha mal digitada al recibir, se revisó la caja");
  await p.getByRole("button", { name: "Guardar corrección" }).click();
  await p.locator('[role="status"]', { hasText: "corregido" }).waitFor();
  const d1 = await lote(L1);
  ok(d1.vence === nuevaFecha && d1.lote === ("CORR-" + antes1.lote.slice(0, 20)).toUpperCase(), "el lote queda con el código (en mayúsculas) y la fecha nuevos", `${d1.lote} ${d1.vence}`);
  ok(d1.u === antes1.u, "las existencias no cambian", `${antes1.u} → ${d1.u}`);
  const [a] = await q(`select datos, usuario_id from auditoria where accion = 'corregir_lote' and entidad_id = $1 order by id desc limit 1`, [L1]);
  ok(a && a.datos.antes.vence === antes1.vence && a.datos.despues.vence === nuevaFecha && a.datos.antes.lote === antes1.lote && /mal digitada/.test(a.datos.motivo) && a.usuario_id,
    "la auditoría guarda antes, después, motivo y quién", JSON.stringify(a?.datos));
  ok(await p.getByText(`Lote ${d1.lote}`, { exact: true }).isVisible(), "la lista muestra el lote corregido");

  // Validaciones por la API
  const r = (c) => api(p, `/api/inventario/lotes/${L2}`, "PATCH", c);
  const motivo = "Revisión de la caja física";
  let t = await r({ lote: d1.lote, vence: antes2.vence, motivo });
  ok(t.status === 422 && /ya tiene un lote/.test(t.j.error), "no deja dos lotes con el mismo código en el producto", `${t.status} ${t.j.error}`);
  t = await r({ lote: antes2.lote, vence: antes2.vence, motivo });
  ok(t.status === 422 && /ya tiene ese código y esa fecha/.test(t.j.error), "sin cambios avisa", `${t.status} ${t.j.error}`);
  t = await r({ lote: antes2.lote, vence: "2026-02-31", motivo });
  ok(t.status === 400, "fecha imposible: 400", `${t.status} ${t.j.error}`);
  t = await r({ lote: antes2.lote, vence: "1990-01-01", motivo });
  ok(t.status === 422 && /no es válida/.test(t.j.error), "fecha fuera de rango: 422", `${t.status} ${t.j.error}`);
  t = await r({ lote: "", vence: antes2.vence, motivo });
  ok(t.status === 400, "sin código: 400", `${t.status}`);
  t = await api(p, `/api/inventario/lotes/${crypto.randomUUID()}`, "PATCH", { lote: "X", vence: enDias(10), motivo });
  ok(t.status === 404, "lote que no existe: 404", `${t.status}`);
  const [otro] = await q(`select l.id from lotes l join empresas e on e.id = l.empresa_id where l.empresa_id <> $1 limit 1`, [x.empresa_id]);
  if (otro) { t = await api(p, `/api/inventario/lotes/${otro.id}`, "PATCH", { lote: "X", vence: enDias(10), motivo }); ok(t.status === 404, "lote de otra droguería: 404", `${t.status}`); }

  // Vencido por error → aparece en la lista de vencidos → se corrige y sale
  t = await r({ lote: antes2.lote, vence: enDias(-3), motivo });
  ok(t.status === 200, "se puede poner una fecha pasada (lote que sí venció)", `${t.status} ${t.j.error ?? ""}`);
  await p.goto(B + "/inventario/lotes"); await p.waitForLoadState("networkidle");
  const fila = p.getByRole("link", { name: `Revisar el lote ${antes2.lote} de ${x.nombre}` });
  ok(await fila.isVisible(), "el lote vencido aparece en «Lotes vencidos con existencias»");
  await fila.click(); await p.waitForURL(/producto=/);
  await p.getByRole("button", { name: `Corregir el lote ${antes2.lote}` }).waitFor();
  ok(await p.getByText(/vencido/).first().isVisible(), "al revisarlo se ve marcado como vencido");
  await p.getByRole("button", { name: `Corregir el lote ${antes2.lote}` }).click();
  await p.fill("#corregir-vence", antes2.vence); await p.fill("#corregir-motivo", motivo);
  await p.getByRole("button", { name: "Guardar corrección" }).click();
  await p.locator('[role="status"]', { hasText: "corregido" }).waitFor();
  const sale = await p.getByRole("link", { name: `Revisar el lote ${antes2.lote} de ${x.nombre}` }).waitFor({ state: "detached", timeout: 8000 }).then(() => true, () => false);
  ok(sale, "corregida la fecha, sale de la lista de vencidos (sin recargar)");
  const [v] = await q(`select vence > current_date ok from lotes where id = $1`, [L2]);
  ok(v.ok, "vuelve a ser vendible (vence en el futuro)");

  // Alerta del INVIMA: la fecha sí, el código no
  await pool.query(`update lotes set bloqueado = true, bloqueo_tipo = 'invima', bloqueo_motivo = 'Alerta INVIMA prueba' where id = $1`, [L2]);
  t = await r({ lote: "OTRO-CODIGO", vence: antes2.vence, motivo });
  ok(t.status === 422 && /INVIMA/.test(t.j.error), "un lote con alerta del INVIMA no cambia de código", `${t.status} ${t.j.error}`);
  t = await r({ lote: antes2.lote, vence: enDias(200), motivo });
  ok(t.status === 200, "a un lote con alerta del INVIMA sí se le corrige la fecha", `${t.status} ${t.j.error ?? ""}`);
  await pool.query(`update lotes set bloqueado = false where id = $1`, [L2]);
  ok(errs.length === 0, "sin errores de consola (dueño)", errs.join(" | "));
  await ctx.close();
}

// ── Bodega sí; cajera no
{
  const { ctx, p } = await entrar("Andrés");
  const t = await api(p, `/api/inventario/lotes/${L2}`, "PATCH", { lote: antes2.lote, vence: antes2.vence, motivo: "Revisión de bodega" });
  ok(t.status === 200, "la bodega corrige lotes", `${t.status} ${t.j.error ?? ""}`);
  await pool.query(`update lotes set vence = current_date - 2 where id = $1`, [L2]);
  const rv = await api(p, `/api/inventario/lotes/${L2}`, "PATCH", { lote: antes2.lote, vence: antes2.vence, motivo: "La bodega quiere volverlo vendible" });
  ok(rv.status === 403 && /dueño o el administrador/.test(rv.j.error), "la bodega no vuelve vendible un lote vencido", `${rv.status} ${rv.j.error}`);
  const rc = await api(p, `/api/inventario/lotes/${L2}`, "PATCH", { lote: antes2.lote, vence: enDias(-5), motivo: "Fecha real más temprana" });
  ok(rc.status === 200, "la bodega sí corrige la fecha de un vencido sin volverlo vendible", `${rc.status} ${rc.j.error ?? ""}`);
  await pool.query(`update lotes set vence = $2::date where id = $1`, [L2, antes2.vence]);
  await ctx.close();
}
{
  const { ctx, p, errs } = await entrar("Laura");
  const t = await api(p, `/api/inventario/lotes/${L2}`, "PATCH", { lote: "X", vence: enDias(10), motivo: "Intento de la cajera" });
  ok(t.status === 403, "la cajera no corrige lotes", `${t.status}`);
  await p.goto(B + "/inventario/lotes"); await p.waitForLoadState("networkidle");
  ok(!/\/inventario\/lotes/.test(p.url()), "la cajera no entra a la pantalla", p.url());
  ok(errs.length === 0, "sin errores de consola (cajera)", errs.join(" | "));
  await ctx.close();
}

await b.close(); await pool.end();
console.log(`\n${fallos} fallos`);
process.exit(fallos ? 1 : 0);
