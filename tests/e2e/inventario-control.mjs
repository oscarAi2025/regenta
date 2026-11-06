// Control de inventario: baja por vencido con acta imprimible, ajustes positivos y negativos con motivo, permisos (la
// cajera no ajusta ni por pantalla ni por API), kardex que cuadra con las existencias tras venta + devolución + ajuste,
// conteo físico con diferencias y cierre que deja existencias = contadas, conteo cerrado inmodificable, sin errores de
// consola y pantallas sin desborde en el celular. Guarda capturas de escritorio (1440) y iPhone 13.
// Uso: servidor con la base sembrada → BASE=http://localhost:4501 DATABASE_URL=… node tests/e2e/inventario-control.mjs
import { chromium, devices } from "playwright-core";
import { mkdirSync } from "node:fs";
import pg from "pg";

const B = process.env.BASE ?? "http://localhost:4500";
const OUT = process.env.OUT ?? "test-results/inventario-control";
mkdirSync(OUT, { recursive: true });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/regenta?host=/tmp" });
let fallos = 0;
const ok = (c, m, x = "") => { console.log(`${c ? "PASS" : "FAIL"} ${m}${x ? " — " + x : ""}`); if (!c) fallos++; };
const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium" });
// Las pruebas funcionales entran a la demo sin las ofertas del embudo (las prueba embudo.mjs).
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
// Las llamadas a la API que la prueba hace a propósito con error (403, 422…) también salen en la consola del navegador
// («Failed to load resource»): se cuentan por página y solo se descuentan esas, una por una.
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
const stockLote = async (lote) => Number((await q1(`select coalesce(sum(cantidad), 0) u from movimientos where lote_id = $1`, [lote])).u);
const stockProd = async (prod) => Number((await q1(`select coalesce(sum(cantidad), 0) u from movimientos where producto_id = $1`, [prod])).u);
// En la emulación del celular, si algo se sale, el navegador agranda el viewport de diseño (innerWidth pasa de 390 a más):
// se compara con el ancho real de la pantalla.
const desborde = (p) => p.evaluate(() => Math.max(document.documentElement.scrollWidth, innerWidth) - screen.width);
// Elementos del contenido que se salen de la pantalla (cortados por un contenedor), salvo dentro de una tabla desplazable.
const cortados = (p) => p.evaluate(() => [...document.querySelectorAll("main *")].filter((el) => {
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.right <= screen.width + 1) return false;
  for (let a = el.parentElement; a; a = a.parentElement) if (/(auto|scroll)/.test(getComputedStyle(a).overflowX)) return false;
  return true;
}).slice(0, 3).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} (${Math.round(el.getBoundingClientRect().right)}px)`));
const EMP = (await q1(`select id, sede_id from (select e.id, (select id from sedes where empresa_id = e.id order by creado limit 1) sede_id from empresas e where e.demo limit 1) x`));

// Un conteo abierto de una corrida anterior que falló se cierra sin cambiar nada (un lote contado igual al sistema).
async function cerrarAbiertos(p) {
  for (const k of (await pool.query(`select id from conteos where empresa_id = $1 and estado = 'abierto'`, [EMP.id])).rows) {
    const l = await q1(`select cl.lote_id, coalesce((select unidades from v_stock_lotes s where s.lote_id = cl.lote_id), 0) u from conteo_lineas cl where conteo_id = $1 limit 1`, [k.id]);
    await api(p, `/api/inventario/conteos/${k.id}`, "PATCH", { modo: "fijar", cantidad: l.u, lote_id: l.lote_id });
    await api(p, `/api/inventario/conteos/${k.id}/cerrar`, "POST", {});
  }
}

// Producto con margen: fraccionable, con código de barras y al menos dos lotes vigentes con 20 o más unidades.
const P = await q1(`select p.id, p.nombre, p.ean, p.laboratorio, p.unidades_por_caja upc from productos p
  where p.empresa_id = $1 and p.activo and p.ean is not null and p.precio_unidad is not null and p.unidades_por_caja > 1 and coalesce(trim(p.laboratorio), '') <> ''
    and (select count(*) from v_stock_lotes s where s.producto_id = p.id and s.unidades >= 20 and s.vence > current_date + 30 and not s.bloqueado) >= 2
    and (select count(*) from productos o where o.empresa_id = p.empresa_id and o.ean = p.ean) = 1
  order by p.nombre limit 1`, [EMP.id]);
ok(!!P, "hay un producto con dos lotes con margen para la prueba", P?.nombre);
const [L1, L2] = (await pool.query(`select lote_id, lote, unidades from v_stock_lotes where producto_id = $1 and unidades >= 20 and vence > current_date + 30 and not bloqueado order by vence, lote limit 2`, [P.id])).rows;

// ───────────── Dueño, escritorio
const D = await entrar("Carlos");
{
  const { p } = D;
  await cerrarAbiertos(p);

  // Un lote vencido de prueba (los ajustes admiten lotes vencidos; la compra no).
  const vencido = `E2EV${Date.now().toString().slice(-7)}`;
  const hace10 = new Date(Date.now() - 10 * 864e5).toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
  const carga = await api(p, "/api/inventario", "POST", { tipo: "ajuste", motivo: "Carga de prueba e2e (lote vencido)", lineas: [{ producto_id: P.id, lote: vencido, vence: hace10, unidades: 12, costo_unidad: 450 }] });
  ok(carga.status === 201, "se carga un lote vencido de prueba", String(carga.status));
  const LV = (await q1(`select id from lotes where producto_id = $1 and lote = $2`, [P.id, vencido])).id;

  // 1) Baja por vencido desde la pantalla, con acta
  await ir(p, "/inventario");
  ok(await p.getByRole("link", { name: "Ajustar o dar de baja" }).count() === 1 && await p.getByRole("link", { name: /Conteo físico/ }).count() === 1, "Inventario enlaza a ajustes y al conteo físico");
  await p.getByRole("link", { name: "Ajustar o dar de baja" }).click();
  await p.waitForURL(/\/inventario\/ajustes/); await p.waitForLoadState("networkidle");
  await p.getByLabel(/^Vencido/).check();
  await p.getByRole("button", { name: "Agregar todos los lotes vencidos" }).click();
  const fila = p.locator("li", { has: p.locator("select option", { hasText: vencido }) });
  await fila.first().waitFor({ timeout: 10000 });
  ok(/salen 12 → quedan 0 und/.test(await fila.first().innerText()), "propone dar de baja las 12 unidades del lote vencido", await fila.first().innerText());
  await p.screenshot({ path: `${OUT}/ajuste-vencidos-1440.png`, fullPage: true });
  await p.getByRole("button", { name: "Dar de baja y generar acta" }).click();
  await p.getByRole("status").filter({ hasText: /Baja N\.º \d+ registrada/ }).waitFor({ timeout: 15000 });
  ok(await stockLote(LV) === 0, "el lote vencido queda en cero");
  const ajV = await q1(`select a.id, a.numero, a.motivo from ajustes a join ajuste_lineas al on al.ajuste_id = a.id where al.lote_id = $1 order by a.creado desc limit 1`, [LV]);
  ok(ajV?.motivo === "vencido", "la baja queda con motivo «Vencido»");
  ok(await p.getByRole("list", { name: "Ajustes registrados" }).getByText(`N.º ${ajV.numero}`, { exact: true }).waitFor({ timeout: 10000 }).then(() => true, () => false), "el historial muestra la baja sin recargar la pantalla");
  await p.getByRole("link", { name: "Ver e imprimir el acta" }).click();
  await p.waitForURL(/\/inventario\/actas\//); await p.waitForLoadState("networkidle");
  const acta = await p.locator("#documento").innerText();
  ok(/Acta de baja de productos/.test(acta) && new RegExp(`N\\.º ${String(ajV.numero).padStart(4, "0")}`).test(acta), "acta de baja con su número", acta.slice(0, 120));
  ok(/NIT 900000001-1/.test(acta) && acta.includes(vencido) && /Vencido/.test(acta) && /Carlos/.test(acta), "acta con NIT, lote, motivo y responsable");
  ok(/regente de farmacia/i.test(acta) && /Gestor de residuos/.test(acta) && /Costo total/.test(acta), "acta con firmas de la regente y del gestor de residuos y costo (dueño)");
  ok(/−12 und/.test(acta) && /\$5\.400/.test(acta), "acta con las unidades dadas de baja y su costo (12 × $450)");
  ok(await p.getByRole("button", { name: "Imprimir o guardar PDF" }).count() === 1, "acta con botón de imprimir");
  await p.emulateMedia({ media: "print" });
  ok(await p.locator("aside").evaluate((x) => getComputedStyle(x).visibility) === "hidden", "al imprimir solo sale el acta (sin menú)");
  await p.emulateMedia({ media: "screen" });
  await p.screenshot({ path: `${OUT}/acta-1440.png`, fullPage: true });

  // 2) Ajuste positivo y negativo («Diferencia de conteo») desde la pantalla
  const ajustar = async (sobran, unidades) => {
    await ir(p, "/inventario/ajustes");
    await p.getByLabel(/^Diferencia de conteo/).check();
    await p.fill("#buscar-ajuste", P.nombre.slice(0, 40));
    await p.locator('[aria-label="Resultados"] button', { hasText: P.nombre }).first().click();
    const linea = p.locator("li", { has: p.getByRole("button", { name: `Quitar ${P.nombre}` }) });
    await linea.locator("select").selectOption(L1.lote_id);
    await linea.locator('input[id^="sueltas-"]').fill(String(unidades));
    await linea.getByRole("radio", { name: sobran ? "Sobran" : "Faltan" }).click();
    await p.getByRole("button", { name: "Registrar ajuste" }).click();
    await p.getByRole("status").filter({ hasText: /Ajuste N\.º \d+ registrado/ }).waitFor({ timeout: 15000 });
  };
  const a0 = await stockLote(L1.lote_id);
  await ajustar(true, 3);
  ok(await stockLote(L1.lote_id) === a0 + 3, "ajuste positivo suma al lote", `${a0} → ${await stockLote(L1.lote_id)}`);
  await ajustar(false, 2);
  ok(await stockLote(L1.lote_id) === a0 + 1, "ajuste negativo resta del lote", `→ ${await stockLote(L1.lote_id)}`);
  const ult = (await pool.query(`select motivo, (select sum(unidades) from ajuste_lineas where ajuste_id = a.id)::int u from ajustes a where empresa_id = $1 order by creado desc limit 2`, [EMP.id])).rows;
  ok(ult[0].motivo === "conteo" && ult[0].u === -2 && ult[1].u === 3, "los dos ajustes quedan con motivo y signo");
  // Validaciones de la API
  const otroSinDetalle = await api(p, "/api/inventario/ajustes", "POST", { motivo: "otro", lineas: [{ lote_id: L1.lote_id, unidades: -1 }] });
  ok(otroSinDetalle.status === 400 && /detalle/.test(otroSinDetalle.j.error), "«Otro» exige el detalle", otroSinDetalle.j.error);
  const bajaSuma = await api(p, "/api/inventario/ajustes", "POST", { motivo: "perdida", lineas: [{ lote_id: L1.lote_id, unidades: 5 }] });
  ok(bajaSuma.status === 400 && /resta/.test(bajaSuma.j.error), "una baja no puede sumar", bajaSuma.j.error);
  const negativo = await api(p, "/api/inventario/ajustes", "POST", { motivo: "perdida", lineas: [{ lote_id: L1.lote_id, unidades: -1_000_000 }] });
  ok(negativo.status === 422 && /negativo/.test(negativo.j.error), "un ajuste no deja el lote en negativo", negativo.j.error);
  // Historial con filtro por motivo
  await ir(p, "/inventario/ajustes?motivo=vencido");
  const hist = await p.getByRole("list", { name: "Ajustes registrados" }).innerText();
  ok(hist.includes(`N.º ${ajV.numero}`) && !/Diferencia de conteo/.test(hist), "el historial filtra por motivo");
  await p.screenshot({ path: `${OUT}/ajustes-historial-1440.png`, fullPage: true });

  // 3) Kardex: venta + devolución + ajuste y el saldo cuadra con las existencias
  const v = await api(p, "/api/ventas", "POST", { idem_key: crypto.randomUUID(), tipo_doc: "pos", lineas: [{ producto_id: P.id, presentacion: "unidad", cantidad: 4 }], pagos: [{ medio: "efectivo", valor: 200000 }] });
  ok(v.status === 200, "venta para el kardex", String(v.status));
  const dv = await api(p, `/api/ventas/${v.j.venta.venta_id}/devolucion`, "POST", { motivo: "Prueba de kardex", lineas: [{ producto_id: P.id, presentacion: "unidad", cantidad: 1 }] });
  ok(dv.status === 200, "devolución para el kardex", String(dv.status));
  const aj = await api(p, "/api/inventario/ajustes", "POST", { motivo: "averia", lineas: [{ lote_id: L2.lote_id, unidades: -1 }] });
  ok(aj.status === 201 && aj.j.acta === true, "baja por avería (con acta)", String(aj.status));
  const k = await api(p, `/api/inventario/kardex?producto=${P.id}`);
  const movs = k.j.movimientos ?? [];
  ok(k.status === 200 && movs.at(-1)?.saldo === await stockProd(P.id), "kardex (API): el saldo final cuadra con las existencias", `${movs.at(-1)?.saldo} = ${await stockProd(P.id)}`);
  let acum = 0, cuadra = true; for (const m of movs) { acum += m.entrada - m.salida; if (acum !== m.saldo) cuadra = false; }
  ok(cuadra, "kardex: cada saldo es el acumulado de entradas menos salidas");
  const tipos = new Set(movs.map((m) => m.tipo));
  ok(["inicial", "venta", "devolucion", "ajuste"].every((t) => tipos.has(t)), "kardex con inicial, venta, devolución y ajuste", [...tipos].join(","));
  ok(movs.some((m) => m.tipo === "venta" && m.documento === `${v.j.venta.prefijo}${v.j.venta.numero}`), "la venta sale con prefijo y número");
  ok(movs.some((m) => m.tipo === "ajuste" && /Avería o rotura/.test(m.documento)), "el ajuste sale con su motivo");
  await ir(p, `/productos/${P.id}`);
  const est = await p.locator("#kardex").innerText();
  ok(new RegExp(`El saldo cuadra con las existencias actuales: ${(await stockProd(P.id)).toLocaleString("es-CO")} und`).test(est), "kardex (pantalla): cuadra con las existencias", est.match(/El saldo[^\n]*/)?.[0]);
  ok(/Venta/.test(est) && /Devolución/.test(est) && /Ajuste N\.º/.test(est), "la ficha muestra venta, devolución y ajuste");
  await p.screenshot({ path: `${OUT}/kardex-1440.png`, fullPage: true });
  await p.selectOption("#k-lote", L2.lote_id); await p.getByRole("button", { name: "Filtrar" }).click(); await p.waitForLoadState("networkidle");
  ok(new RegExp(`cuadra con las existencias actuales del lote: ${(await stockLote(L2.lote_id)).toLocaleString("es-CO")} und`).test(await p.locator("#kardex").innerText()), "kardex por lote cuadra con el lote");
  const csv = await p.request.get(`${B}/api/inventario/kardex?producto=${P.id}&formato=csv`);
  const txt = await csv.text();
  ok(csv.ok() && /text\/csv/.test(csv.headers()["content-type"]) && /Saldo \(und\)/.test(txt) && /Devolución/.test(txt), "kardex exporta CSV", csv.headers()["content-disposition"]);

  // 4) Conteo físico: diferencias y cierre que deja existencias = contadas
  await ir(p, "/inventario/conteos");
  await p.getByLabel("Un laboratorio").check();
  await p.selectOption("#filtro-conteo", { label: P.laboratorio.trim() });
  await p.getByRole("button", { name: "Empezar a contar" }).click();
  await p.waitForURL(/\/inventario\/conteos\/[0-9a-f-]{36}$/); await p.waitForLoadState("networkidle");
  const conteoId = p.url().split("/").pop();
  const s1 = await stockLote(L1.lote_id), s2 = await stockLote(L2.lote_id);
  // Escanear: el primer escaneo pregunta el lote; los siguientes suman al mismo
  await p.fill("#escaner", P.ean); await p.press("#escaner", "Enter");
  await p.getByRole("button", { name: new RegExp(`^Lote ${L1.lote}`) }).click();
  await p.getByRole("status").filter({ hasText: /→ 1 contadas/ }).waitFor({ timeout: 10000 });
  for (const n of [2, 3]) { await p.fill("#escaner", P.ean); await p.press("#escaner", "Enter"); await p.getByRole("status").filter({ hasText: new RegExp(`lote ${L1.lote} → ${n} contadas`) }).waitFor({ timeout: 10000 }); }
  ok(true, "cada escaneo suma 1 al lote elegido (3 escaneos → 3)");
  // Editar la cantidad de otro lote a mano
  const l2id = (await q1(`select id from conteo_lineas where conteo_id = $1 and lote_id = $2`, [conteoId, L2.lote_id])).id;
  await p.fill(`#contado-${l2id}`, String(s2 + 2)); await p.press(`#contado-${l2id}`, "Enter");
  await p.getByRole("status").filter({ hasText: new RegExp(`lote ${L2.lote}: ${s2 + 2} contadas`) }).waitFor({ timeout: 10000 });
  await p.getByRole("button", { name: /^Con diferencia/ }).click();
  const difs = await p.getByRole("list", { name: "Lotes" }).innerText();
  ok(new RegExp(`Faltan ${s1 - 3} und`).test(difs) && /Sobran 2 und/.test(difs) && /\$/.test(difs), "muestra las diferencias por lote en unidades y en dinero", difs.replace(/\n/g, " ").slice(0, 200));
  await p.screenshot({ path: `${OUT}/conteo-contando-1440.png`, fullPage: true });
  const otros = (await pool.query(`select lote_id, coalesce((select unidades from v_stock_lotes s where s.lote_id = cl.lote_id), 0) u from conteo_lineas cl where conteo_id = $1 and contado is null`, [conteoId])).rows;
  await p.getByRole("button", { name: "Cerrar conteo" }).click();
  await p.getByRole("button", { name: "Cerrar y ajustar el inventario" }).click();
  await p.getByRole("heading", { name: /Conteo N\.º \d+ · cerrado/ }).waitFor({ timeout: 20000 });
  ok(await stockLote(L1.lote_id) === 3 && await stockLote(L2.lote_id) === s2 + 2, "al cerrar, las existencias quedan iguales a lo contado", `${await stockLote(L1.lote_id)} y ${await stockLote(L2.lote_id)}`);
  let intactos = true; for (const o of otros) if (await stockLote(o.lote_id) !== o.u) intactos = false;
  ok(intactos, "los lotes sin contar no cambian", `${otros.length} lotes`);
  const kc = await q1(`select k.estado, a.motivo, (select count(*) from movimientos m where m.ref_id = a.id)::int movs from conteos k join ajustes a on a.id = k.ajuste_id where k.id = $1`, [conteoId]);
  ok(kc?.estado === "cerrado" && kc.motivo === "conteo" && kc.movs === 2, "un solo ajuste «Diferencia de conteo» con las dos diferencias", JSON.stringify(kc));
  await p.screenshot({ path: `${OUT}/conteo-cerrado-1440.png`, fullPage: true });
  // Cerrado = inmodificable
  const mod = await api(p, `/api/inventario/conteos/${conteoId}`, "PATCH", { modo: "sumar", cantidad: 1, lote_id: L1.lote_id });
  ok(mod.status === 422 && /cerrado/.test(mod.j.error), "un conteo cerrado no se puede modificar", `${mod.status} ${mod.j.error}`);
  const otraVez = await api(p, `/api/inventario/conteos/${conteoId}/cerrar`, "POST", {});
  ok(otraVez.status === 422 && /ya está cerrado/.test(otraVez.j.error), "un conteo cerrado no se vuelve a cerrar", `${otraVez.status}`);
  ok(await p.locator("#escaner").count() === 0, "la pantalla del conteo cerrado ya no deja contar");
  await p.getByRole("link", { name: "Informe para imprimir" }).click();
  await p.waitForURL(/\/informe$/); await p.waitForLoadState("networkidle");
  const inf = await p.locator("#documento").innerText();
  ok(/Informe de conteo físico/.test(inf) && /Cerrado/.test(inf) && inf.includes(L1.lote) && inf.includes(L2.lote), "informe del conteo imprimible con las diferencias");
  await p.screenshot({ path: `${OUT}/conteo-informe-1440.png`, fullPage: true });
}

// ───────────── Cajera: sin ajustes, ni por pantalla ni por API
{
  const { ctx, p, errs } = await entrar("Laura");
  await ir(p, "/inventario/ajustes"); await p.waitForURL(/\/inventario$/, { timeout: 15000 }).catch(() => {}); await p.waitForLoadState("networkidle");
  ok(/\/inventario$/.test(p.url()) && await p.getByRole("status").filter({ hasText: "no está disponible para tu usuario" }).count() === 1, "la cajera no entra a ajustes (vuelve a inventario con aviso)", p.url());
  ok(await p.getByRole("link", { name: "Ajustar o dar de baja" }).count() === 0, "la cajera no ve el botón de ajustar");
  await ir(p, "/inventario/conteos"); await p.waitForURL(/\/inventario$/, { timeout: 15000 }).catch(() => {}); await p.waitForLoadState("networkidle");
  ok(/\/inventario$/.test(p.url()) && await p.getByRole("status").filter({ hasText: "no está disponible para tu usuario" }).count() === 1, "la cajera no entra al conteo físico", p.url());
  const k = (await q1(`select id from conteos where empresa_id = $1 order by creado desc limit 1`, [EMP.id])).id;
  const pruebas = [
    ["POST", "/api/inventario/ajustes", { motivo: "perdida", lineas: [{ lote_id: L1.lote_id, unidades: -1 }] }],
    ["GET", `/api/inventario/lotes?producto=${P.id}`],
    ["GET", `/api/inventario/kardex?producto=${P.id}`],
    ["POST", "/api/inventario/conteos", { alcance: "todo" }],
    ["GET", `/api/inventario/conteos/${k}`],
    ["PATCH", `/api/inventario/conteos/${k}`, { modo: "sumar", cantidad: 1, lote_id: L1.lote_id }],
    ["POST", `/api/inventario/conteos/${k}/cerrar`, {}],
  ];
  for (const [m, u, c] of pruebas) { const r = await api(p, u, m, c); ok(r.status === 403, `la cajera recibe 403 en ${m} ${u.split("?")[0]}`, `${r.status} ${r.j.error ?? ""}`); }
  const reales = sinProvocados(p, errs);
  ok(reales.length === 0, "sin errores de consola (cajera)", reales.join(" | "));
  await ctx.close();
}

// ───────────── Bodega: ajusta sin ver costos y ve el kardex sin poder editar el producto
{
  const { ctx, p, errs } = await entrar("Andrés");
  await ir(p, "/inventario/ajustes");
  ok(await p.getByRole("heading", { name: "Ajustar o dar de baja" }).count() === 1, "la bodega entra a ajustes");
  const lo = await api(p, `/api/inventario/lotes?producto=${P.id}`);
  ok(lo.status === 200 && lo.j.lotes.every((l) => l.costo === null), "la bodega no recibe costos de los lotes");
  await ir(p, `/productos/${P.id}`);
  ok(await p.locator("#kardex").count() === 1 && await p.getByRole("button", { name: /Guardar/ }).count() === 0, "la bodega ve el kardex pero no edita el producto");
  await ir(p, `/inventario/actas/${(await q1(`select id from ajustes where empresa_id = $1 and motivo = 'vencido' order by creado desc limit 1`, [EMP.id])).id}`);
  ok(!/Costo total/.test(await p.locator("#documento").innerText()), "el acta de la bodega no muestra costos");
  ok(sinProvocados(p, errs).length === 0, "sin errores de consola (bodega)", sinProvocados(p, errs).join(" | "));
  await ctx.close();
}

// ───────────── Celular (iPhone 13): sin desbordes, con capturas
{
  const { ctx, p, errs } = await entrar("Carlos", { ...devices["iPhone 13"] });
  const acta = (await q1(`select id from ajustes where empresa_id = $1 and motivo = 'vencido' order by creado desc limit 1`, [EMP.id])).id;
  const cerrado = (await q1(`select id from conteos where empresa_id = $1 and estado = 'cerrado' order by creado desc limit 1`, [EMP.id])).id;
  // Un conteo abierto pequeño para ver la pantalla de contar en el celular (se cierra al final sin cambiar nada)
  const lab = (await q1(`select p.laboratorio, count(*) n from productos p join v_stock_lotes s on s.producto_id = p.id where p.empresa_id = $1 and s.unidades > 0 and coalesce(trim(p.laboratorio), '') <> '' group by 1 having count(*) between 3 and 12 order by 2 desc limit 1`, [EMP.id])).laboratorio;
  const ab = await api(p, "/api/inventario/conteos", "POST", { alcance: "laboratorio", filtro: lab.trim() });
  ok(ab.status === 201, "conteo pequeño para la vista móvil", String(ab.status));
  const pantallas = [["/inventario", "inventario"], ["/inventario/ajustes", "ajustes"], [`/inventario/actas/${acta}`, "acta"], ["/inventario/conteos", "conteos"],
    [`/inventario/conteos/${ab.j.id}`, "conteo-contando"], [`/inventario/conteos/${cerrado}`, "conteo-cerrado"], [`/inventario/conteos/${cerrado}/informe`, "conteo-informe"], [`/productos/${P.id}`, "kardex"]];
  for (const [ruta, nombre] of pantallas) {
    await ir(p, ruta);
    const d = await desborde(p);
    ok(d <= 0, `sin desborde horizontal en el celular: ${nombre}`, `${d}px`);
    const c = await cortados(p);
    ok(c.length === 0, `nada se sale de la pantalla en el celular: ${nombre}`, c.join(", "));
    await p.screenshot({ path: `${OUT}/${nombre}-iphone13.png` });
    const alto = await p.evaluate(() => document.documentElement.scrollHeight);
    await p.screenshot({ path: `${OUT}/${nombre}-iphone13-completa.png`, fullPage: true, clip: { x: 0, y: 0, width: 390, height: Math.min(alto, 2600) } });
  }
  // En el celular: escanear un producto del conteo pequeño
  const linea = await q1(`select cl.id, p.ean, p.nombre, (select count(*) from conteo_lineas x where x.conteo_id = cl.conteo_id and x.producto_id = cl.producto_id)::int lotes
    from conteo_lineas cl join productos p on p.id = cl.producto_id where cl.conteo_id = $1 and p.ean is not null order by 4, p.nombre limit 1`, [ab.j.id]);
  await ir(p, `/inventario/conteos/${ab.j.id}`);
  await p.fill("#escaner", linea.ean); await p.press("#escaner", "Enter");
  if (linea.lotes > 1) await p.locator('[aria-labelledby="elegir-lote"] button', { hasText: /^Lote/ }).first().click();
  await p.getByRole("status").filter({ hasText: /→ 1 contadas/ }).waitFor({ timeout: 10000 });
  ok(true, "en el celular el escaneo suma 1");
  await p.screenshot({ path: `${OUT}/conteo-escaneo-iphone13.png` });
  // Se cierra sin cambiar existencias: lo contado se iguala al sistema
  for (const l of (await pool.query(`select lote_id, coalesce((select unidades from v_stock_lotes s where s.lote_id = cl.lote_id), 0) u from conteo_lineas cl where conteo_id = $1 and contado is not null`, [ab.j.id])).rows)
    await api(p, `/api/inventario/conteos/${ab.j.id}`, "PATCH", { modo: "fijar", cantidad: l.u, lote_id: l.lote_id });
  const cierre = await api(p, `/api/inventario/conteos/${ab.j.id}/cerrar`, "POST", {});
  ok(cierre.status === 200 && cierre.j.con_diferencia === 0 && cierre.j.ajuste_id === null, "el conteo sin diferencias se cierra sin ajuste", JSON.stringify(cierre.j));
  ok(sinProvocados(p, errs).length === 0, "sin errores de consola (celular)", sinProvocados(p, errs).join(" | "));
  await ctx.close();
}
ok(sinProvocados(D.p, D.errs).length === 0, "sin errores de consola (dueño)", sinProvocados(D.p, D.errs).join(" | "));
await D.ctx.close();
await b.close(); await pool.end();
console.log(`\n${fallos} fallos`);
process.exit(fallos ? 1 : 0);
