// Conteo físico: cada diferencia queda explicada y guardada (20/11/2026, Oscar: «que quede el registro de las veces que se
// contó, qué se contó, el informe y los errores, para todos los clientes»). Conteo de un laboratorio con dos diferencias;
// el informe dice cuántas faltan por explicar; se explica una desde la pantalla y otra por la API; una explicación nueva
// queda encima de la anterior (sin borrar nada); resumen por causa; el listado avisa «sin explicar»; la cajera no puede;
// otra droguería no ve nada; la base no deja cambiar ni borrar explicaciones.
// Uso: BASE=… DATABASE_URL=… node tests/e2e/conteo-justificar.mjs
import { chromium } from "playwright-core";
import pg from "pg";

const B = process.env.BASE ?? "http://localhost:4500";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/regenta?host=/tmp" });
let fallos = 0;
const ok = (c, m, x = "") => { console.log(`${c ? "PASS" : "FAIL"} ${m}${x ? " — " + x : ""}`); if (!c) fallos++; };
const q1 = async (sql, v = []) => (await pool.query(sql, v)).rows[0];
const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium" });
{ const nc = b.newContext.bind(b); b.newContext = async (o) => { const c = await nc(o); await c.addInitScript(() => { try { sessionStorage.setItem("regenta_demo_v1", JSON.stringify({ hechos: [], ofertas: ["prueba", "prueba"], cerrada: true, inicio: Date.now() })); } catch {} }); return c; }; }
async function entrar(quien) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } }); const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => m.type() === "error" && !/status of 4\d\d/.test(m.text()) && errs.push(m.text()));
  await p.goto(B + "/entrar"); await p.getByRole("button", { name: new RegExp(quien) }).click(); await p.waitForURL(/\/(caja|inicio)/);
  return { ctx, p, errs };
}
const api = (p, url, metodo = "GET", cuerpo) => p.evaluate(async ([u, m, c]) => {
  const r = await fetch(u, { method: m, headers: c === undefined ? {} : { "content-type": "application/json" }, body: c === undefined ? undefined : JSON.stringify(c) });
  return { status: r.status, j: await r.json().catch(() => ({})) };
}, [url, metodo, cuerpo]);
const EMP = (await q1(`select id from empresas where demo limit 1`)).id;

const { ctx, p, errs } = await entrar("Carlos");
// Conteos abiertos de otras pruebas: se cierran sin diferencias.
for (const k of (await pool.query(`select id from conteos where empresa_id = $1 and estado = 'abierto'`, [EMP])).rows) await api(p, `/api/inventario/conteos/${k.id}`, "DELETE", { motivo: "Limpieza de la prueba" });
// Un laboratorio con al menos dos lotes con existencias.
const lab = (await q1(`select trim(p.laboratorio) lab from productos p join v_stock_lotes s on s.producto_id = p.id where p.empresa_id = $1 and s.unidades > 2 and coalesce(trim(p.laboratorio), '') <> ''
  group by 1 having count(*) between 2 and 12 order by count(*) desc limit 1`, [EMP])).lab;
const nuevo = await api(p, "/api/inventario/conteos", "POST", { alcance: "laboratorio", filtro: lab });
ok(nuevo.status === 201 || nuevo.status === 200, `conteo del laboratorio ${lab}`, `${nuevo.status} ${nuevo.j.error ?? ""}`);
const K = nuevo.j.id ?? nuevo.j.conteo?.id;
const det = await api(p, `/api/inventario/conteos/${K}`);
const lineas = det.j.lineas;
// Dos diferencias (−1 y +2); el resto, igual al sistema.
for (const [i, l] of lineas.entries()) await api(p, `/api/inventario/conteos/${K}`, "PATCH", { modo: "fijar", lote_id: l.lote_id, cantidad: i === 0 ? l.sistema - 1 : i === 1 ? l.sistema + 2 : l.sistema });
const cierre = await api(p, `/api/inventario/conteos/${K}/cerrar`, "POST", {});
ok(cierre.status === 200, "conteo cerrado con 2 diferencias", `${cierre.status} ${cierre.j.error ?? ""}`);
const L = (await pool.query(`select id::int, lote_id from conteo_lineas where conteo_id = $1 and contado <> sistema order by id`, [K])).rows;
ok(L.length === 2, "quedan guardadas las 2 líneas con diferencia", String(L.length));

// Listado: el conteo avisa que hay diferencias sin explicar
await p.goto(B + "/inventario/conteos"); await p.waitForLoadState("networkidle");
ok(await p.getByRole("link", { name: "2 sin explicar" }).count() === 1, "el historial de conteos avisa «2 sin explicar»");

// Informe: pendientes, explicar desde la pantalla
await p.goto(B + `/inventario/conteos/${K}/informe`); await p.waitForLoadState("networkidle");
const sec = p.locator('section[aria-labelledby="explicacion"]');
ok(/0 de 2 explicadas · faltan 2/.test(await sec.innerText()), "el informe dice cuántas faltan por explicar", (await sec.innerText()).slice(0, 120));
ok(await p.getByText("Sin explicar").count() === 2, "cada diferencia sin explicar se marca");
await p.getByRole("button", { name: "Explicar esta diferencia" }).first().click();
await p.getByLabel("Causa de la diferencia").selectOption("venta_sin_descargar");
await p.getByLabel("Qué pasó").fill("Salió en el pedido de la Droguería Prueba y no se facturó");
await p.getByLabel("Documento").fill("Remisión R-77");
await p.getByRole("button", { name: "Guardar explicación" }).click();
await p.getByText(/1 de 2 explicadas · faltan 1/).waitFor({ timeout: 15000 });
ok(await p.getByText(/Venta o pedido que no se descargó\./).count() === 1 && await p.getByText(/Soporte: Remisión R-77\./).count() === 1, "la explicación queda en el informe con causa, detalle y soporte");
// Validación y la segunda por la API
const malo = await api(p, `/api/inventario/conteos/${K}/justificar`, "POST", { linea_id: L[1].id, causa: "inventada", detalle: "x" });
ok(malo.status === 400, "causa inválida: rechazada (400)", malo.j.error);
const otraConteo = (await q1(`select cl.id::int id from conteo_lineas cl join conteos k on k.id = cl.conteo_id where k.empresa_id = $1 and cl.conteo_id <> $2 limit 1`, [EMP, K]))?.id;
if (otraConteo) ok((await api(p, `/api/inventario/conteos/${K}/justificar`, "POST", { linea_id: otraConteo, causa: "otro", detalle: "no corresponde" })).status === 404, "una línea de otro conteo no se mezcla (404)");
const dos = await api(p, `/api/inventario/conteos/${K}/justificar`, "POST", { linea_id: L[1].id, causa: "error_conteo", detalle: "Se contaron dos cajas dos veces" });
ok(dos.status === 201, "segunda explicada (error de conteo)", dos.j.error);
// Cambiar la primera: la nueva queda encima, la anterior se conserva
const cambio = await api(p, `/api/inventario/conteos/${K}/justificar`, "POST", { linea_id: L[0].id, causa: "averia", detalle: "Caja rota en bodega", documento: "Acta 12" });
ok(cambio.status === 201, "una explicación nueva para la primera", cambio.j.error);
await p.reload(); await p.waitForLoadState("networkidle");
ok(/Las 2 diferencias están explicadas/.test(await p.locator('section[aria-labelledby="explicacion"]').innerText()), "informe: todas explicadas");
ok(await p.getByText(/Avería o rotura\./).count() === 1 && /1 explicación anterior/.test(await p.locator("main").innerText()), "vale la última y se ve que hubo una anterior");
const porCausa = await p.locator('table[aria-label="Diferencias por causa"]').innerText();
ok(/Avería o rotura/.test(porCausa) && /Error de conteo/.test(porCausa) && !/Venta o pedido/.test(porCausa), "resumen por causa con las explicaciones vigentes", porCausa.replace(/\n/g, " "));
const hist = await q1(`select count(*)::int n from conteo_justificaciones where conteo_id = $1`, [K]);
ok(hist.n === 3, "las 3 explicaciones quedan guardadas (ninguna se borra)", String(hist.n));
await p.goto(B + "/inventario/conteos"); await p.waitForLoadState("networkidle");
ok(await p.getByText("Todas explicadas").count() >= 1, "el historial de conteos dice «Todas explicadas»");
ok(errs.length === 0, "sin errores en el navegador", errs.join(" | "));
await ctx.close();

// La base no deja cambiar ni borrar; la cajera no explica; otra droguería no ve
{
  let cambiar = false, borrar = false;
  try { await pool.query(`update conteo_justificaciones set detalle = 'otro texto' where conteo_id = $1`, [K]); } catch (e) { cambiar = /no se cambian/.test(e.message); }
  ok(cambiar, "la base no deja cambiar una explicación");
  const c = await pool.connect();
  try {
    await c.query("begin");
    const dB = (await c.query(`select m.user_id, m.empresa_id from miembros m join empresas e on e.id = m.empresa_id where not e.demo and m.rol = 'dueno' limit 1`)).rows[0];
    await c.query(`select set_config('request.jwt.claims', $1, true)`, [JSON.stringify({ sub: dB.user_id, role: "authenticated" })]);
    await c.query("set local role authenticated");
    const vistos = (await c.query(`select count(*)::int n from conteo_justificaciones where conteo_id = $1`, [K])).rows[0].n;
    ok(vistos === 0, "otra droguería no ve las explicaciones (RLS)", String(vistos));
    await c.query("savepoint s1");
    try { await c.query(`delete from conteo_justificaciones where conteo_id = $1`, [K]); borrar = true; } catch { borrar = true; await c.query("rollback to savepoint s1"); }
    let ajeno = false;
    await c.query("savepoint s2");
    try { await c.query(`select justificar_diferencia($1, $2, 'otro', 'intento ajeno', null)`, [EMP, L[0].id]); } catch (e) { ajeno = /dueño, el administrador o la bodega/.test(e.message); await c.query("rollback to savepoint s2"); }
    ok(ajeno, "no puede explicar diferencias de otra droguería");
    await c.query("rollback");
  } finally { c.release(); }
  ok(borrar && (await q1(`select count(*)::int n from conteo_justificaciones where conteo_id = $1`, [K])).n === 3, "nadie las borra desde la aplicación");
  const caj = await entrar("Laura");
  const r = await api(caj.p, `/api/inventario/conteos/${K}/justificar`, "POST", { linea_id: L[0].id, causa: "otro", detalle: "intento de la cajera" });
  ok(r.status === 403, "la cajera no explica diferencias (403)", String(r.status));
  await caj.ctx.close();
}
await b.close(); await pool.end();
console.log(fallos ? `\n${fallos} FALLOS` : "\nTODO OK");
process.exit(fallos ? 1 : 0);
