// Resultados, gastos, auxiliar de IVA, cierre del día y bitácora (Bloque 3-A):
//   · venta + devolución → la utilidad baja exactamente el margen devuelto; un lote sin costo no infla la utilidad y sale en
//     «vendidos sin costo»; el costo heredado se marca;
//   · gasto en efectivo desde la caja (por la pantalla) aparece en el turno y en resultados; anularlo lo revierte;
//   · IVA por tarifa = suma de las líneas − notas crédito; IVA descontable = compras de prueba;
//   · cierre del día = suma de los turnos; bitácora con un cambio de precio y una anulación (usuario y fecha);
//   · cajera 403, CSV con BOM y protegido, aislamiento entre empresas, celular sin desbordes, sin errores de consola.
// Uso: servidor con la base sembrada → BASE=http://localhost:4531 DATABASE_URL=… node tests/e2e/resultados.mjs
import { chromium, devices } from "playwright-core";
import { mkdirSync } from "node:fs";
import { SignJWT } from "jose";
import pg from "pg";

const B = process.env.BASE ?? "http://localhost:4500";
const OUT = process.env.OUT ?? "test-results/resultados";
mkdirSync(OUT, { recursive: true });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/regenta?host=/tmp" });
let fallos = 0;
const ok = (c, m, x = "") => { console.log(`${c ? "PASS" : "FAIL"} ${m}${x ? " — " + x : ""}`); if (!c) fallos++; };
const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium" });
{ const nc = b.newContext.bind(b); b.newContext = async (o) => { const c = await nc(o); await c.addInitScript(() => { try { sessionStorage.setItem("regenta_demo_v1", JSON.stringify({ hechos: [], ofertas: ["prueba", "prueba"], cerrada: true, inicio: Date.now() })); } catch {} }); return c; }; }

const vigilar = (p) => { const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => m.type() === "error" && errs.push(m.text())); return errs; };
async function entrar(quien, opciones = { viewport: { width: 1440, height: 900 } }) {
  const ctx = await b.newContext(opciones);
  const p = await ctx.newPage();
  const errs = vigilar(p);
  await p.goto(B + "/entrar"); await p.getByRole("button", { name: new RegExp(quien) }).click(); await p.waitForURL(/\/(caja|inicio)/);
  return { ctx, p, errs };
}
const ir = async (p, ruta) => { await p.goto(B + ruta); await p.waitForLoadState("networkidle"); };
const api = async (p, url, metodo = "GET", cuerpo) => {
  const r = await p.evaluate(async ([u, m, c]) => {
    const r = await fetch(u, { method: m, headers: c === undefined ? {} : { "content-type": "application/json" }, body: c === undefined ? undefined : JSON.stringify(c) });
    return { status: r.status, j: await r.json().catch(() => ({})) };
  }, [url, metodo, cuerpo]);
  if (r.status >= 400) p.__provocados = (p.__provocados ?? 0) + 1;
  return r;
};
const sinProvocados = (p, errs) => { let n = p.__provocados ?? 0; return errs.filter((e) => !(n > 0 && /Failed to load resource: the server responded with a status of 4\d\d/.test(e) && n--)); };
const q1 = async (sql, params = []) => (await pool.query(sql, params)).rows[0];
const desborde = (p) => p.evaluate(() => Math.max(document.documentElement.scrollWidth, innerWidth) - screen.width);
const cortados = (p) => p.evaluate(() => [...document.querySelectorAll("main *")].filter((el) => {
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.right <= screen.width + 1) return false;
  for (let a = el.parentElement; a; a = a.parentElement) if (/(auto|scroll)/.test(getComputedStyle(a).overflowX)) return false;
  return true;
}).slice(0, 3).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} (${Math.round(el.getBoundingClientRect().right)}px)`));
const num = (t) => Number(String(t).replace(/[^\d,−-]/g, "").replace(",", ".").replace("−", "-"));
const cerca = (a, b2) => Math.abs(Number(a) - Number(b2)) < 0.005;

const HOY = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
const HOY_TEXTO = HOY.split("-").reverse().join("/");
const R = `desde=${HOY}&hasta=${HOY}`;
const EMP = await q1(`select id from empresas where demo limit 1`);
const CAJA = await q1(`select id, sede_id, nombre from cajas where empresa_id = $1 and activa order by nombre, id limit 1`, [EMP.id]);
const E_B = (await q1(`select id from empresas where not demo order by creado limit 1`))?.id;
const U_B = E_B ? (await q1(`select user_id from miembros where empresa_id = $1 and rol = 'dueno' and activo limit 1`, [E_B]))?.user_id : null;
const SELLO = Date.now().toString(36).slice(-6).toUpperCase();
const CARLOS = (await q1(`select user_id from miembros where empresa_id = $1 and rol = 'dueno' limit 1`, [EMP.id])).user_id;
/** Cifras de un turno con resumen_turno, como el dueño (la función exige ser miembro de la droguería). */
async function resumenTurno(id) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: CARLOS, role: "authenticated" })]);
    await c.query("set local role authenticated");
    const r = (await c.query(`select case when estado = 'cerrado' and resumen is not null then resumen else resumen_turno(id) end r from turnos where id = $1`, [id])).rows[0].r;
    await c.query("commit");
    return r;
  } catch (e) { await c.query("rollback"); throw e; } finally { c.release(); }
}
// El IVA solo se cobra si la droguería es responsable de IVA: la prueba lo activa en la demo y lo deja como estaba al final.
const RESP_IVA = (await q1(`select responsable_iva from empresas where id = $1`, [EMP.id])).responsable_iva;
await pool.query(`update empresas set responsable_iva = true where id = $1`, [EMP.id]);

// ───────────── Productos de prueba (precio, IVA y costo conocidos), con un lote cada uno en la sede de la caja.
async function producto(nombre, iva, precio, costo, { heredado = false, unidades = 60 } = {}) {
  const id = (await q1(`insert into productos (empresa_id, nombre, laboratorio, iva, unidades_por_caja, precio_caja) values ($1, $2, 'Laboratorio E2E', $3, 1, $4) returning id`,
    [EMP.id, `${nombre} ${SELLO}`, iva, precio])).id;
  const lote = (await q1(`insert into lotes (empresa_id, sede_id, producto_id, lote, vence) values ($1, $2, $3, $4, current_date + 400) returning id`, [EMP.id, CAJA.sede_id, id, `R${SELLO}`])).id;
  if (costo !== null) await pool.query(`insert into lote_costos (lote_id, empresa_id, costo_unidad, heredado) values ($1, $2, $3, $4)`, [lote, EMP.id, costo, heredado]);
  await pool.query(`insert into movimientos (empresa_id, sede_id, producto_id, lote_id, cantidad, tipo, motivo) values ($1, $2, $3, $4, $5, 'inicial', 'Carga e2e resultados')`, [EMP.id, CAJA.sede_id, id, lote, unidades]);
  return { id, nombre: `${nombre} ${SELLO}`, iva, precio };
}
const P19 = await producto("E2E Jarabe IVA19", 19, 11900, 6000);
const P5 = await producto("E2E Tapabocas IVA5", 5, 10500, 7000);
const P0 = await producto("E2E Tabletas IVA0", 0, 5000, 3000);
const PS = await producto("E2E Crema sin costo", 0, 8000, null);
const PH = await producto("E2E Gotas costo anterior", 0, 4000, 2500, { heredado: true });
const prov = (await q1(`insert into proveedores (empresa_id, nombre, plazo_dias) values ($1, $2, 30) returning id`, [EMP.id, `Proveedor E2E ${SELLO}`])).id;

const D = await entrar("Carlos");
const { p } = D;
const resultados = async () => (await api(p, `/api/reportes/resultados?${R}`)).j;
const iva = async () => (await api(p, `/api/reportes/iva?${R}`)).j;
const vender = async (lineas, total) => (await api(p, "/api/ventas", "POST", { idem_key: crypto.randomUUID(), tipo_doc: "pos", lineas: lineas.map(([x, n]) => ({ producto_id: x.id, presentacion: "caja", cantidad: n })), pagos: [{ medio: "efectivo", valor: total }] }));

// Turno abierto en la caja (para el gasto desde caja y el cierre del día).
{
  await ir(p, "/inicio");
  const t = await api(p, "/api/turnos");
  if (!t.j.turno) ok((await api(p, "/api/turnos", "POST", { accion: "abrir", base: 100000 })).status === 200, "se abre el turno de la caja");
}
const TURNO = (await q1(`select id from turnos where caja_id = $1 and estado = 'abierto'`, [CAJA.id])).id;

// ───────────── 1 · Utilidad: venta con costo (y heredado), lote sin costo, devolución
const R0 = await resultados();
ok(R0.rango?.desde === HOY, "el estado de resultados responde para hoy", JSON.stringify(R0).slice(0, 120));
const v1 = await vender([[P19, 2], [P5, 1], [P0, 1], [PH, 1]], 2 * 11900 + 10500 + 5000 + 4000);
ok(v1.status === 200, "venta con costo registrada", JSON.stringify(v1.j).slice(0, 150));
const R1 = await resultados();
// Márgenes (sin IVA): 2 × (10.000 − 6.000) + (10.000 − 7.000) + (5.000 − 3.000) + (4.000 − 2.500) = 14.500
ok(cerca(R1.utilidad_bruta - R0.utilidad_bruta, 14500), "la utilidad sube exactamente el margen vendido (14.500)", `${R1.utilidad_bruta - R0.utilidad_bruta}`);
ok(cerca(R1.netas - R0.netas, 39000), "ventas netas sin IVA suben 39.000 (20.000 + 10.000 + 5.000 + 4.000)", `${R1.netas - R0.netas}`);
ok(cerca(R1.heredado.utilidad - R0.heredado.utilidad, 1500) && cerca(R1.heredado.netas - R0.heredado.netas, 4000), "el lote con costo anterior queda marcado aparte (1.500 de utilidad)");

const v2 = await vender([[PS, 2]], 16000);
ok(v2.status === 200, "venta de un lote sin costo registrada");
const R2 = await resultados();
ok(cerca(R2.utilidad_bruta, R1.utilidad_bruta), "un lote sin costo NO cambia la utilidad", `${R1.utilidad_bruta} → ${R2.utilidad_bruta}`);
ok(cerca(R2.sin_costo.netas - R1.sin_costo.netas, 16000) && cerca(R2.netas - R1.netas, 16000), "lo vendido sin costo sube 16.000 en «vendidos sin costo» y en ventas netas");

const dev = await api(p, `/api/ventas/${v1.j.venta.venta_id}/devolucion`, "POST", { motivo: "Prueba e2e de resultados", medio: "efectivo", lineas: [{ producto_id: P19.id, presentacion: "caja", cantidad: 1 }] });
ok(dev.status === 200, "devolución de 1 jarabe", JSON.stringify(dev.j).slice(0, 150));
const R3 = await resultados();
ok(cerca(R2.utilidad_bruta - R3.utilidad_bruta, 4000), "la utilidad baja exactamente el margen devuelto (10.000 − 6.000 = 4.000)", `${R2.utilidad_bruta - R3.utilidad_bruta}`);
ok(cerca(R3.devoluciones - R2.devoluciones, 10000) && cerca(R2.con_costo.costo - R3.con_costo.costo, 6000), "la devolución resta su base (10.000) y su costo (6.000)");

await ir(p, `/reportes/resultados?${R}`);
const nota = await p.getByRole("note", { name: "Vendido sin costo" }).innerText().catch(() => "");
ok(/vendidos sin costo registrado/.test(nota) && nota.includes(pesos(R3.sin_costo.netas)), "la pantalla informa «$X vendidos sin costo registrado»", nota.slice(0, 120));
ok(/Costo anterior a compras: puede incluir IVA/.test(await p.getByRole("note", { name: "Costo anterior a compras" }).innerText().catch(() => "")), "la pantalla marca el costo anterior a compras");
const est = await p.getByRole("region", { name: "Estado de resultados" }).innerText();
ok(est.includes("Utilidad bruta") && est.includes(pesos(R3.utilidad_bruta)) && est.includes("Utilidad operativa"), "el estado muestra utilidad bruta y operativa", est.slice(0, 200));
await p.screenshot({ path: `${OUT}/resultados-1440.png`, fullPage: true });
// Reportes e Inicio usan la misma utilidad corregida.
await ir(p, `/reportes?${R}`);
const util = await p.getByRole("region", { name: "Resumen" }).getByText("Ganancia bruta", { exact: true }).locator("xpath=..").innerText();
ok(util.includes(pesos(Math.round(R3.utilidad_bruta))) && /vendidos sin costo registrado/.test(util), "Reportes muestra la utilidad corregida y lo vendido sin costo", util.replace(/\n/g, " · "));
const filaPS = await p.getByRole("region", { name: "Por producto" }).locator("tr", { hasText: PS.nombre }).innerText();
ok(/sin costo/.test(filaPS), "por producto, el lote sin costo dice «sin costo» (no ganancia)", filaPS);
const filaP19 = await p.getByRole("region", { name: "Por producto" }).locator("tr", { hasText: P19.nombre }).innerText();
ok(filaP19.includes(pesos(4000)), "por producto, la ganancia es neta de lo devuelto (2 vendidos, 1 devuelto = 4.000)", filaP19);
await ir(p, "/inicio");
const ini = await p.getByRole("region", { name: "Hoy" }).getByText("Ganancia bruta hoy", { exact: true }).locator("xpath=..").innerText();
ok(ini.includes(pesos(Math.round(R3.utilidad_bruta))), "Inicio muestra la misma utilidad del día", ini.replace(/\n/g, " · "));

// ───────────── 2 · Auxiliar de IVA: ventas por tarifa = líneas − notas crédito; descontable = compras de prueba
{
  const I0 = await iva();
  const sql = async (q) => (await pool.query(q, [EMP.id, HOY])).rows;
  const lineas = await sql(`select l.iva_pct::float t, sum(l.base)::float base, sum(l.iva)::float iva from venta_lineas l join ventas v on v.id = l.venta_id
    where v.empresa_id = $1 and v.estado = 'cerrada' and (v.creado at time zone 'America/Bogota')::date = $2::date group by 1`);
  const notas = await sql(`select l.iva_pct::float t, sum(dl.base)::float base, sum(dl.iva)::float iva from devolucion_lineas dl join devoluciones d on d.id = dl.devolucion_id
    join venta_lineas l on l.id = dl.venta_linea_id where d.empresa_id = $1 and (d.creado at time zone 'America/Bogota')::date = $2::date group by 1`);
  const de = (f, t, k) => f.find((x) => x.t === t)?.[k] ?? 0;
  const cuadra = [0, 5, 19].every((t, i) => cerca(I0.ventas[i].base, de(lineas, t, "base")) && cerca(I0.ventas[i].iva, de(lineas, t, "iva"))
    && cerca(I0.notas[i].base, de(notas, t, "base")) && cerca(I0.notas[i].iva, de(notas, t, "iva"))
    && cerca(I0.ventas_netas[i].iva, de(lineas, t, "iva") - de(notas, t, "iva")) && cerca(I0.ventas_netas[i].base, de(lineas, t, "base") - de(notas, t, "base")));
  ok(cuadra, "IVA por tarifa (0, 5, 19 %) = suma de las líneas − notas crédito", JSON.stringify(I0.ventas_netas));
  ok(cerca(I0.notas[2].iva, de(notas, 19, "iva")) && de(notas, 19, "iva") >= 1900, "la nota crédito del jarabe resta IVA del 19 %");
  const c = await api(p, "/api/compras", "POST", { proveedor_id: prov, numero_factura: `E2E-${SELLO}`, fecha_factura: HOY, condicion: "credito", lineas: [
    { producto_id: P19.id, lote: `C19${SELLO}`, vence: "2031-01-31", unidades: 10, costo: 1000, costo_por: "unidad", iva_pct: 19 },
    { producto_id: P5.id, lote: `C5${SELLO}`, vence: "2031-01-31", unidades: 4, costo: 2500, costo_por: "unidad", iva_pct: 5 },
    { producto_id: P0.id, lote: `C0${SELLO}`, vence: "2031-01-31", unidades: 2, costo: 1500, costo_por: "unidad", iva_pct: 0 }] });
  ok(c.status === 201 && c.j.estado === "registrada" && cerca(c.j.iva, 2400), "compra de prueba registrada (IVA 1.900 + 500)", JSON.stringify(c.j).slice(0, 160));
  const I1 = await iva();
  const d = (i, k) => I1.compras[i][k] - I0.compras[i][k];
  ok(cerca(d(2, "base"), 10000) && cerca(d(2, "iva"), 1900) && cerca(d(1, "base"), 10000) && cerca(d(1, "iva"), 500) && cerca(d(0, "base"), 3000) && cerca(d(0, "iva"), 0),
    "IVA descontable por tarifa cuadra con la compra de prueba", JSON.stringify([d(0, "iva"), d(1, "iva"), d(2, "iva")]));
  ok(cerca(I1.descontable[2].iva - I0.descontable[2].iva, 1900), "el neto descontable del 19 % sube 1.900");
  await ir(p, `/reportes/iva?${R}`);
  ok(await p.getByText("Auxiliar para tu contador, no reemplaza la declaración.").count() === 1, "la pantalla dice «auxiliar para tu contador, no reemplaza la declaración»");
  const t19 = await p.getByRole("table", { name: "IVA de ventas" }).locator("tbody tr", { hasText: "19 %" }).innerText();
  ok(t19.includes(pesosExactos(I1.ventas_netas[2].iva)), "la tabla de ventas muestra el IVA neto del 19 %", t19.replace(/\s+/g, " "));
  await p.screenshot({ path: `${OUT}/iva-1440.png`, fullPage: true });
  const csvIva = await p.request.get(B + `/api/reportes/iva?${R}&formato=csv`);
  const bytes = new Uint8Array(await csvIva.body());
  const txt = new TextDecoder().decode(bytes);
  ok(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf && txt.includes("Concepto;Tarifa;Base;IVA") && /no reemplaza la declaración/.test(txt), "CSV de IVA con BOM, «;» y la aclaración para el contador");
}

// ───────────── 3 · Gasto en efectivo desde la caja (por la pantalla), en el turno y en resultados; anularlo lo revierte
{
  const r0 = await resumenTurno(TURNO);
  const RG0 = await resultados();
  await ir(p, "/gastos");
  const fg = p.getByRole("form", { name: "Registrar un gasto" });
  await fg.getByLabel("Categoría", { exact: true }).selectOption("transporte");
  const desc = `=HIPERVINCULO("x") domicilio ${SELLO}`;
  await fg.getByLabel("Descripción").fill(desc);
  await fg.getByLabel("Valor").fill("23.500");
  ok(await fg.getByLabel("Medio de pago").inputValue() === "efectivo" && /como egreso del turno abierto/.test(await fg.innerText()), "en efectivo, avisa que sale de la caja");
  await fg.getByRole("button", { name: "Registrar gasto" }).click();
  const st = await p.getByRole("status").filter({ hasText: /Gasto G-\d+ de \$23\.500 registrado/ }).first().innerText({ timeout: 15000 }).catch(() => "");
  ok(/salió de .* como egreso del turno/.test(st), "registra el gasto y dice que salió de la caja", st);
  const G = await q1(`select id, numero, turno_id, movimiento_caja_id from gastos where empresa_id = $1 and descripcion = $2`, [EMP.id, desc]);
  ok(G?.turno_id === TURNO && !!G.movimiento_caja_id, "el gasto queda ligado al turno abierto con su egreso");
  const fila = p.getByRole("table", { name: "Gastos" }).locator("tr", { hasText: `G-${G.numero}` });
  ok(await fila.waitFor({ timeout: 10000 }).then(() => true, () => false), "la lista muestra el gasto sin recargar");
  await p.screenshot({ path: `${OUT}/gastos-1440.png`, fullPage: true });
  const r1 = await resumenTurno(TURNO);
  ok(cerca(r1.egresos - r0.egresos, 23500) && cerca(r0.efectivo_esperado - r1.efectivo_esperado, 23500), "en el turno: salidas +23.500 y efectivo esperado −23.500");
  await ir(p, "/turno");
  ok(await p.getByText(new RegExp(`Gasto G-${G.numero} · Transporte`)).count() >= 1, "la pantalla del turno muestra el gasto");
  const RG1 = await resultados();
  ok(cerca(RG1.total_gastos - RG0.total_gastos, 23500) && cerca(RG1.utilidad_operativa, RG1.utilidad_bruta - RG1.total_gastos), "resultados: gastos +23.500 y utilidad operativa = bruta − gastos");
  ok(RG1.gastos.some((g) => g.categoria === "transporte" && g.valor >= 23500), "el gasto sale en su categoría");
  // CSV protegido contra fórmulas y con BOM
  const resp = await p.request.get(B + "/api/gastos?formato=csv");
  const by = new Uint8Array(await resp.body()), tx = new TextDecoder().decode(by);
  ok(by[0] === 0xef && by[1] === 0xbb && by[2] === 0xbf && tx.split("\r\n")[0].startsWith("Gasto;Fecha;Categoría"), "CSV de gastos con BOM y «;»");
  ok(tx.includes(`"'=HIPERVINCULO(""x"") domicilio ${SELLO}"`) && !tx.includes(`;=HIPERVINCULO`), "la descripción que empieza por = sale protegida en el CSV");
  // Anular (por la pantalla)
  await ir(p, "/gastos");
  const f2 = p.getByRole("table", { name: "Gastos" }).locator("tr", { hasText: `G-${G.numero}` });
  await f2.getByRole("button", { name: "Anular" }).click();
  await p.getByLabel("Motivo de la anulación").fill("Se registró por error");
  await p.getByRole("button", { name: "Anular gasto" }).click();
  ok(await p.getByRole("status").filter({ hasText: new RegExp(`Gasto G-${G.numero} anulado: el efectivo volvió a la caja`) }).waitFor({ timeout: 15000 }).then(() => true, () => false), "anula el gasto y avisa que el efectivo volvió");
  ok(/Anulado/.test(await f2.innerText()), "la fila queda anulada (sin borrarse)");
  const r2 = await resumenTurno(TURNO);
  ok(cerca(r2.efectivo_esperado, r0.efectivo_esperado), "en el turno el efectivo esperado vuelve a ser el de antes del gasto");
  const RG2 = await resultados();
  ok(cerca(RG2.total_gastos, RG0.total_gastos) && cerca(RG2.utilidad_operativa, RG0.utilidad_operativa), "resultados: el gasto anulado ya no cuenta");
  // Validación y filtros con enlaces
  const malo = await api(p, "/api/gastos", "POST", { fecha: HOY, categoria: "transporte", descripcion: "ab", medio: "transferencia", valor: 100 });
  ok(malo.status === 400 && /en qué se gastó/.test(malo.j.error), "la API valida en español", malo.j.error);
  await ir(p, "/gastos");
  await Promise.all([p.waitForURL(/estado=anulados/), p.getByRole("navigation", { name: "Estado" }).getByRole("link", { name: "Anulados" }).click()]);
  await p.waitForLoadState("networkidle");
  ok(await p.getByRole("table", { name: "Gastos" }).locator("tr", { hasText: `G-${G.numero}` }).count() === 1, "el filtro «Anulados» (enlace) muestra el gasto anulado");
  ok(sinProvocados(p, D.errs).length === 0, "gastos sin errores de consola", sinProvocados(p, D.errs).join(" | "));
}

// ───────────── 4 · Cierre del día = suma de los turnos
{
  const ventaCierre = await vender([[P0, 1]], 5000);
  ok(ventaCierre.status === 200, "una venta más en el turno");
  await ir(p, "/reportes/cierre");
  const tot = p.getByRole("table", { name: "Turnos del día" }).locator("tfoot");
  const leer = async (k) => num(await tot.locator(`[data-total="${k}"]`).innerText());
  const ids = (await pool.query(`select id from turnos where empresa_id = $1 and abierto < ((current_date + 1)::timestamp at time zone 'America/Bogota')
    and coalesce(cerrado, now()) >= (current_date::timestamp at time zone 'America/Bogota')`, [EMP.id])).rows.map((x) => x.id);
  let ventas = 0, egresos = 0, esperado = 0;
  for (const id of ids) {
    const r = await resumenTurno(id);
    ventas += Number(r.ventas ?? 0); egresos += Number(r.egresos ?? 0); esperado += Number(r.efectivo_esperado ?? 0);
  }
  ok(ids.includes(TURNO) && await p.getByRole("table", { name: "Turnos del día" }).locator("tbody tr").count() === ids.length, "el cierre lista todos los turnos del día", String(ids.length));
  ok(cerca(await leer("ventas"), Math.round(ventas * 100) / 100) && cerca(await leer("egresos"), Math.round(egresos * 100) / 100) && cerca(await leer("esperado"), Math.round(esperado * 100) / 100),
    "totales del cierre = suma de los turnos (ventas, salidas, esperado)", `${await leer("ventas")}/${ventas} · ${await leer("egresos")}/${egresos} · ${await leer("esperado")}/${esperado}`);
  const medios = await p.getByRole("region", { name: "Ventas por medio de pago" }).innerText();
  const ef = await q1(`select coalesce(sum(pg.valor), 0) - coalesce((select sum(cambio) from ventas where empresa_id = $1 and estado = 'cerrada' and (creado at time zone 'America/Bogota')::date = $2::date), 0) v
    from pagos pg join ventas v on v.id = pg.venta_id where v.empresa_id = $1 and v.estado = 'cerrada' and pg.medio = 'efectivo' and (v.creado at time zone 'America/Bogota')::date = $2::date`, [EMP.id, HOY]);
  ok(medios.includes(pesosExactos(Number(ef.v))), "ventas en efectivo del día (todas las cajas) cuadran con la base", `${pesosExactos(Number(ef.v))}`);
  await p.screenshot({ path: `${OUT}/cierre-1440.png`, fullPage: true });
}

// ───────────── 4b · Cerrar el turno con un faltante: el cierre del día lo suma y la bitácora lo registra
{
  const esperado = Number((await resumenTurno(TURNO)).efectivo_esperado);
  const cierre = await api(p, "/api/turnos", "POST", { accion: "cerrar", turno: TURNO, contado: esperado - 1000, observaciones: `Faltante e2e ${SELLO}` });
  ok(cierre.status === 200 && Number(cierre.j.cierre?.diferencia) === -1000, "se cierra el turno con un faltante de 1.000", JSON.stringify(cierre.j).slice(0, 120));
  await ir(p, "/reportes/cierre");
  const difs = await q1(`select coalesce(sum(diferencia), 0)::float d from turnos where empresa_id = $1 and estado = 'cerrado' and abierto < ((current_date + 1)::timestamp at time zone 'America/Bogota')
    and cerrado >= (current_date::timestamp at time zone 'America/Bogota')`, [EMP.id]);
  const tdif = num(await p.getByRole("table", { name: "Turnos del día" }).locator('tfoot [data-total="diferencia"]').innerText());
  ok(cerca(tdif, difs.d) && difs.d <= -1000, "el cierre del día suma las diferencias de los turnos cerrados", `${tdif} = ${difs.d}`);
  const fila = await p.getByRole("table", { name: "Turnos del día" }).locator("tbody tr", { hasText: CAJA.nombre }).last().innerText();
  ok(fila.includes("−$1.000"), "la fila del turno muestra el faltante", fila.replace(/\s+/g, " "));
  await ir(p, "/bitacora?tipo=turno");
  const ev = await p.getByRole("list", { name: "Lista de eventos" }).locator("li").first().innerText().catch(() => "");
  ok(/Turno con faltante/.test(ev) && /faltan \$1\.000/.test(ev) && ev.includes(CAJA.nombre) && /Carlos/.test(ev), "la bitácora muestra el turno con faltante", ev.replace(/\n/g, " · "));
}

// ───────────── 5 · Bitácora: cambio de precio y anulación, con usuario y fecha, en español
{
  const pr = await api(p, `/api/productos/${P0.id}`, "PATCH", { nombre: P0.nombre, laboratorio: "Laboratorio E2E", iva: 0, unidades_por_caja: 1, precio_caja: 5200, stock_minimo: 0 });
  ok(pr.status === 200, "cambio de precio por la API de productos", JSON.stringify(pr.j));
  const v = await vender([[P0, 1]], 5200);
  const an = await api(p, `/api/ventas/${v.j.venta.venta_id}`, "DELETE", { motivo: `Anulación e2e ${SELLO}` });
  ok(an.status === 200, "venta anulada para la bitácora");
  const numero = `${v.j.venta.prefijo}${v.j.venta.numero}`;
  await ir(p, "/bitacora?tipo=precio");
  const ev = p.getByRole("list", { name: "Lista de eventos" }).locator("li", { hasText: P0.nombre }).first();
  const tp = await ev.innerText().catch(() => "");
  ok(/Cambio de precio/.test(tp) && tp.includes("$5.000 → $5.200") && /Carlos/.test(tp) && tp.includes(HOY_TEXTO), "la bitácora muestra el cambio de precio con producto, valores, usuario y fecha", tp.replace(/\n/g, " · "));
  ok(!/[{}"]/.test(tp), "el detalle está en español, sin JSON crudo");
  await p.screenshot({ path: `${OUT}/bitacora-1440.png`, fullPage: true });
  await Promise.all([p.waitForURL(/tipo=anulacion/), p.getByRole("navigation", { name: "Tipo de evento" }).getByRole("link", { name: "Anulaciones" }).click()]);
  await p.waitForLoadState("networkidle");
  const ta = await p.getByRole("list", { name: "Lista de eventos" }).locator("li", { hasText: `Anulación e2e ${SELLO}` }).first().innerText().catch(() => "");
  ok(/Anulación de venta/.test(ta) && ta.includes(numero) && /Carlos/.test(ta) && ta.includes(HOY_TEXTO), "la bitácora muestra la anulación con número, motivo, usuario y fecha", ta.replace(/\n/g, " · "));
  ok(/Anulación de gasto/.test(await p.getByRole("list", { name: "Lista de eventos" }).innerText()), "la anulación del gasto también queda en la bitácora");
  const carlos = (await q1(`select user_id from miembros where empresa_id = $1 and rol = 'dueno' limit 1`, [EMP.id])).user_id;
  const laura = (await q1(`select user_id from miembros where empresa_id = $1 and rol = 'cajero' limit 1`, [EMP.id])).user_id;
  ok((await api(p, `/api/bitacora?usuario=${carlos}&tipo=anulacion`)).j.filas?.length > 0 && (await api(p, `/api/bitacora?usuario=${laura}&tipo=anulacion`)).j.total === 0, "filtra por usuario");
  const pag = await api(p, "/api/bitacora?pagina=1");
  ok(pag.j.filas.length <= 50 && pag.j.paginas === Math.max(1, Math.ceil(pag.j.total / 50)), "paginada de a 50", `${pag.j.total} eventos`);
  const turnoDif = await api(p, `/api/bitacora?tipo=turno`);
  ok(turnoDif.status === 200 && turnoDif.j.filas.every((x) => /Turno con (faltante|sobrante)/.test(x.titulo)), "el filtro de turnos solo trae los que tienen diferencia");
  // Fechas imposibles (mes 13) no tumban los reportes: se usa el rango por defecto.
  const malas = await Promise.all(["/api/reportes/iva?desde=2026-13-01", "/api/reportes/resultados?hasta=2026-02-30", "/api/reportes/cierre?fecha=2026-13-45", "/api/reportes?tipo=dias&desde=2026-13-01"].map((u) => api(p, u)));
  ok(malas.every((x) => x.status === 200), "fechas imposibles no dan error 500", malas.map((x) => x.status).join(","));
  ok(sinProvocados(p, D.errs).length === 0, "dueño sin errores de consola", sinProvocados(p, D.errs).join(" | "));
}

// ───────────── 6 · Permisos: la cajera no entra (pantallas ni API)
{
  const { ctx, p: pc, errs } = await entrar("Laura");
  for (const ruta of ["/reportes/resultados", "/reportes/iva", "/reportes/cierre", "/gastos", "/bitacora"]) {
    await pc.goto(B + ruta); await pc.waitForURL(/\/inicio/, { timeout: 10000 }).catch(() => {});
    ok(!pc.url().includes(ruta) && await pc.getByRole("region", { name: /Estado de resultados|Turnos del día|Eventos|Gastos registrados/ }).count() === 0, `la cajera no ve ${ruta}`, pc.url());
  }
  for (const [m, u, c] of [["GET", "/api/reportes/resultados"], ["GET", "/api/reportes/iva?formato=csv"], ["GET", "/api/reportes/cierre"], ["GET", "/api/gastos"], ["GET", "/api/bitacora"],
    ["POST", "/api/gastos", { fecha: HOY, categoria: "otros", descripcion: "Intento cajera", medio: "efectivo", valor: 1000 }], ["DELETE", "/api/gastos", { id: crypto.randomUUID(), motivo: "Intento" }]]) {
    ok((await api(pc, u, m, c)).status === 403, `la cajera recibe 403 en ${m} ${u}`);
  }
  ok(sinProvocados(pc, errs).length === 0, "cajera sin errores de consola", sinProvocados(pc, errs).join(" | "));
  await ctx.close();
}

// ───────────── 7 · Aislamiento: el dueño de otra droguería no ve ni anula lo de esta
if (E_B && U_B) {
  const jwt = await new SignJWT({ uid: U_B, empresa: E_B, nombre: "Dueño Vecina", rol: "dueno", v: 0 }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h")
    .sign(new TextEncoder().encode(process.env.REGENTA_SESSION_SECRET ?? "prueba-local-0123456789abcdef0123456789abcdef"));
  const h = { cookie: `regenta_sesion=${jwt}`, origin: B };
  const g = await q1(`select id from gastos where empresa_id = $1 and not anulado order by creado desc limit 1`, [EMP.id])
    ?? (await pool.query(`select id from gastos where empresa_id = $1 limit 1`, [EMP.id])).rows[0];
  const lista = await (await fetch(B + "/api/gastos", { headers: h })).json();
  ok(Array.isArray(lista.gastos) && !lista.gastos.some((x) => String(x.descripcion).includes(SELLO)), "otra droguería no ve los gastos de esta");
  const del = await fetch(B + "/api/gastos", { method: "DELETE", headers: { ...h, "content-type": "application/json" }, body: JSON.stringify({ id: g.id, motivo: "Intento ajeno" }) });
  ok(del.status === 404, "otra droguería no anula un gasto ajeno (404)", String(del.status));
  const bit = await (await fetch(B + "/api/bitacora", { headers: h })).json();
  ok(Array.isArray(bit.filas) && !JSON.stringify(bit.filas).includes(SELLO), "otra droguería no ve la bitácora de esta");
  const rb = await (await fetch(B + `/api/reportes/resultados?${R}`, { headers: h })).json();
  const ventasB = Number((await q1(`select coalesce(sum(base), 0) v from ventas where empresa_id = $1 and estado = 'cerrada' and (creado at time zone 'America/Bogota')::date = $2::date`, [E_B, HOY])).v);
  ok(cerca(rb.ventas, ventasB), "los resultados de otra droguería son solo los suyos", `${rb.ventas} = ${ventasB}`);
  const ivB = await (await fetch(B + `/api/reportes/iva?${R}`, { headers: h })).json();
  const comprasB = Number((await q1(`select coalesce(sum(base), 0) v from compra_lineas cl join compras k on k.id = cl.compra_id where k.empresa_id = $1 and k.estado = 'registrada' and k.fecha_factura = $2::date`, [E_B, HOY])).v);
  ok(cerca(ivB.compras.reduce((a, x) => a + x.base, 0), comprasB), "el auxiliar de IVA de otra droguería trae solo sus compras", `${comprasB}`);
} else ok(false, "hay una segunda droguería para probar el aislamiento");

// ───────────── 8 · Celular (iPhone 13): sin desbordes; capturas
{
  const { ctx, p: pm, errs } = await entrar("Carlos", { ...devices["iPhone 13"] });
  for (const [ruta, nombre] of [[`/reportes/resultados?${R}`, "resultados"], [`/reportes/iva?${R}`, "iva"], ["/reportes/cierre", "cierre"], ["/gastos", "gastos"], ["/bitacora", "bitacora"], [`/reportes?${R}`, "reportes"]]) {
    await ir(pm, ruta);
    await pm.locator("main h1").first().waitFor({ timeout: 15000 });
    const sobra = await desborde(pm), cort = await cortados(pm);
    ok(sobra <= 1 && cort.length === 0, `${nombre} en el celular sin desborde`, `${sobra}px ${cort.join(", ")}`);
    await pm.screenshot({ path: `${OUT}/${nombre}-iphone13.png`, fullPage: true });
  }
  ok(errs.length === 0, "celular sin errores de consola", errs.join(" | "));
  await ctx.close();
}

await D.ctx.close();
await pool.query(`update empresas set responsable_iva = $2 where id = $1`, [EMP.id, RESP_IVA]);
await b.close(); await pool.end();
console.log(`\n${fallos} fallos`);
process.exit(fallos ? 1 : 0);

function pesos(n) { return pesosExactos(n); }
function pesosExactos(v) {
  const n = Math.round(Number(v) * 100), neg = n < 0, a = Math.abs(n);
  const ent = Math.floor(a / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, "."), cen = a % 100;
  return `${neg ? "−" : ""}$${ent}${cen ? "," + String(cen).padStart(2, "0") : ""}`;
}
