// Precios masivos, códigos alternos, etiquetas y cuarentena (Bloque 3-C, migración 036): +5 % a un laboratorio con
// redondeo a $50 (la vista previa es lo que se aplica y revertir deja todo exacto); margen objetivo sobre el costo sin IVA
// de la última compra; código alterno en la caja (con y sin internet) y duplicado → 409; etiquetas A4 y rollo sin
// desborde y con código de barras real; devolución a cuarentena → el lote no se vende y FEFO lo salta; liberar → se vende;
// dar de baja desde la cuarentena → acta; la cajera recibe 403; aislamiento entre empresas; celular sin desbordes; sin
// errores de consola. Capturas de escritorio (1440) y iPhone 13 en test-results/precios-lotes.
// Uso: servidor con la base recién sembrada → BASE=http://localhost:4533 DATABASE_URL=… REGENTA_SESSION_SECRET=… node tests/e2e/precios-lotes.mjs
import { chromium, devices } from "playwright-core";
import { mkdirSync } from "node:fs";
import pg from "pg";
import { SignJWT } from "jose";

const B = process.env.BASE ?? "http://localhost:4500";
const OUT = process.env.OUT ?? "test-results/precios-lotes";
mkdirSync(OUT, { recursive: true });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/regenta?host=/tmp" });
let fallos = 0;
const ok = (c, m, x = "") => { console.log(`${c ? "PASS" : "FAIL"} ${m}${x ? " — " + x : ""}`); if (!c) fallos++; };
const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium" });
{ const nc = b.newContext.bind(b); b.newContext = async (o) => { const c = await nc(o); await c.addInitScript(() => {
  try { sessionStorage.setItem("regenta_demo_v1", JSON.stringify({ hechos: [], ofertas: ["prueba", "prueba"], cerrada: true, inicio: Date.now() })); } catch {}
  window.print = () => { window.__impreso = (window.__impreso ?? 0) + 1; }; // también en los iframes de impresión: sin diálogo
}); return c; }; }

const vigilar = (p) => { const errs = []; p.on("pageerror", (e) => errs.push(`${new URL(p.url()).pathname}: ${e.message}`)); p.on("console", (m) => m.type() === "error" && errs.push(`${new URL(p.url()).pathname}: ${m.text()}`)); return errs; };
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
const filas = async (sql, params = []) => (await pool.query(sql, params)).rows;
const stockLote = async (lote) => Number((await q1(`select coalesce(sum(cantidad), 0) u from movimientos where lote_id = $1`, [lote])).u);
const desborde = (p) => p.evaluate(() => Math.max(document.documentElement.scrollWidth, innerWidth) - screen.width);
const cortados = (p) => p.evaluate(() => [...document.querySelectorAll("main *")].filter((el) => {
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.right <= screen.width + 1) return false;
  for (let a = el.parentElement; a; a = a.parentElement) if (/(auto|scroll)/.test(getComputedStyle(a).overflowX)) return false;
  return true;
}).slice(0, 3).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} (${Math.round(el.getBoundingClientRect().right)}px)`));
/** Ejecuta SQL como un usuario de la app (rol authenticated + claims) y confirma. */
async function comoUsuario(uid, sql, params = []) {
  const c = await pool.connect();
  try {
    await c.query("begin"); await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })]); await c.query("set local role authenticated");
    const r = (await c.query(sql, params)).rows; await c.query("commit"); return r;
  } catch (e) { await c.query("rollback"); throw e; } finally { c.release(); }
}

// Decodificación independiente de un EAN-13 dibujado (módulos 1/0 leídos de los rectángulos del SVG).
const EL = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const EG = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
const ER = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"];
const EP = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];
function leerEan13(m) {
  if (m.length !== 95 || m.slice(0, 3) !== "101" || m.slice(45, 50) !== "01010" || m.slice(92) !== "101") return null;
  let par = "", izq = "", der = "";
  for (let i = 0; i < 6; i++) { const s = m.slice(3 + i * 7, 10 + i * 7); const l = EL.indexOf(s), g = EG.indexOf(s); if (l < 0 && g < 0) return null; par += l >= 0 ? "L" : "G"; izq += l >= 0 ? l : g; }
  for (let i = 0; i < 6; i++) { const r = ER.indexOf(m.slice(50 + i * 7, 57 + i * 7)); if (r < 0) return null; der += r; }
  const d0 = EP.indexOf(par); if (d0 < 0) return null;
  const c = `${d0}${izq}${der}`;
  const s = [...c.slice(0, 12)].reduce((a, x, i) => a + Number(x) * (i % 2 ? 3 : 1), 0);
  return (10 - (s % 10)) % 10 === Number(c[12]) ? c : null;
}
/** Etiquetas de la vista previa: cuántas, si algo se sale de su recuadro, tamaño en mm y los códigos de barras leídos. */
const revisarEtiquetas = (p) => p.evaluate(() => [...document.querySelectorAll('[data-prueba="vista-etiquetas"] .rot')].map((et) => {
  const L = et.getBoundingClientRect();
  const fuera = [...et.querySelectorAll("*")].filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && (r.left < L.left - 0.5 || r.right > L.right + 0.5 || r.top < L.top - 0.5 || r.bottom > L.bottom + 0.5); }).map((e) => e.tagName + "." + e.getAttribute("class"));
  const svg = et.querySelector("svg[data-tipo]");
  let modulos = null;
  if (svg) {
    const g = svg.querySelector("g[data-modulos]"), n = Number(g.getAttribute("data-modulos")), arr = Array(n).fill("0");
    const sil = Math.min(...[...g.querySelectorAll("rect")].map((r) => Number(r.getAttribute("x"))));
    for (const r of g.querySelectorAll("rect")) for (let i = 0; i < Number(r.getAttribute("width")); i++) arr[Number(r.getAttribute("x")) - sil + i] = "1";
    modulos = arr.join("");
  }
  return { producto: et.getAttribute("data-producto"), fuera, ancho: L.width, alto: L.height, desbordeTexto: et.scrollHeight > et.clientHeight + 1 || et.scrollWidth > et.clientWidth + 1,
    tipo: svg?.getAttribute("data-tipo") ?? null, codigo: svg?.getAttribute("data-codigo") ?? null, modulos, texto: et.innerText };
}));

const EMP = await q1(`select e.id, (select id from sedes where empresa_id = e.id order by creado limit 1) sede_id from empresas e where e.demo limit 1`);
// Precios con margen sobre el costo SIN IVA: la droguería es responsable de IVA (la demo viene como no responsable,
// y entonces el IVA de la compra es costo: eso se prueba en compras.mjs).
await pool.query(`update empresas set responsable_iva = true where id = $1`, [EMP.id]);
const EB = await q1(`select id from empresas where not demo and nit = '900000002'`);
const DUENO = "00000000-0000-4000-8000-000000000001", DUENO_B = "00000000-0000-4000-8000-000000000004";
const R = Date.now().toString().slice(-8);
const vigentes = `(select count(*) from v_stock_lotes s where s.producto_id = p.id and s.unidades >= 10 and s.vence > current_date + 30 and not s.bloqueado)`;
// Un laboratorio con varios productos activos (todos con precio) para el +5 %.
const LAB = (await q1(`select laboratorio from productos where empresa_id = $1 and activo and coalesce(trim(laboratorio), '') <> '' group by 1
  having count(*) between 4 and 20 and min(precio_caja) > 0 and bool_or(precio_unidad is not null) order by count(*) desc, 1 limit 1`, [EMP.id]))?.laboratorio;
// Q: fraccionable con dos lotes con margen (código alterno, devolución, cuarentena). M: para el margen objetivo.
const Q = await q1(`select p.id, p.nombre, p.ean, p.unidades_por_caja upc, p.precio_unidad::float pu from productos p
  where p.empresa_id = $1 and p.activo and p.ean ~ '^\\d{13}$' and p.precio_unidad is not null and p.unidades_por_caja > 1 and not p.requiere_formula
    and p.laboratorio is distinct from $2 and ${vigentes} >= 2 and (select count(*) from productos o where o.empresa_id = p.empresa_id and o.ean = p.ean) = 1
  order by p.nombre limit 1`, [EMP.id, LAB]);
const M = await q1(`select p.id, p.nombre, p.ean, p.unidades_por_caja upc, p.iva::float iva from productos p
  where p.empresa_id = $1 and p.activo and p.ean is not null and p.iva = 19 and p.id <> $2 and p.laboratorio is distinct from $3 and not p.requiere_formula
  order by p.nombre limit 1`, [EMP.id, Q?.id, LAB]);
ok(!!(LAB && Q && M), "hay datos de la demo para la prueba", `${LAB} | ${Q?.nombre} | ${M?.nombre}`);
const [L1, L2] = await filas(`select lote_id, lote, unidades from v_stock_lotes where producto_id = $1 and unidades > 0 and (vence is null or vence >= current_date) and not bloqueado
  order by vence nulls last, lote_id limit 2`, [Q.id]);

// Compra de M a $1.000 la unidad SIN IVA (IVA 19 %): base del margen objetivo y de «lo recibido en la compra».
const PROV = (await q1(`insert into proveedores (empresa_id, nombre, plazo_dias) values ($1, $2, 30) returning id`, [EMP.id, `Proveedor precios E2E ${R}`])).id;
const COMPRA = (await comoUsuario(DUENO, `select registrar_compra($1) r`, [{ empresa_id: EMP.id, sede_id: EMP.sede_id, proveedor_id: PROV, numero_factura: `PL-${R}`, condicion: "credito",
  fecha_factura: new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" }), lineas: [{ producto_id: M.id, lote: `ML${R}`, vence: "2031-06-30", unidades: 12, costo: 1000, costo_por: "unidad", iva_pct: 19 }] }]))[0].r;
const NCOMPRA = (await q1(`select numero from compras where id = $1`, [COMPRA.id])).numero;

let CAMBIO = null;
// ───────────── Dueño, escritorio
const D = await entrar("Carlos");
{
  const { p } = D;
  // 1) +5 % a un laboratorio, redondeo a $50: vista previa = aplicado; revertir = exacto
  const antes = await filas(`select id, precio_caja::float pc, precio_unidad::float pu from productos where empresa_id = $1 and activo and laboratorio = $2 order by id`, [EMP.id, LAB]);
  await ir(p, "/productos/precios");
  await p.getByLabel("Un laboratorio").check();
  await p.locator("#f-lab").selectOption(LAB);
  await p.getByLabel("Subir un porcentaje").check();
  await p.fill("#regla-valor", "5");
  ok(await p.getByRole("radio", { name: "A $50" }).getAttribute("aria-checked") === "true", "redondeo a $50 por defecto");
  const [resp] = await Promise.all([p.waitForResponse((r) => r.url().endsWith("/api/precios/vista-previa")), p.getByRole("button", { name: "Ver vista previa" }).click()]);
  const previa = await resp.json();
  await p.getByRole("heading", { name: "3. Vista previa" }).waitFor();
  const cambian = previa.lineas.filter((l) => l.aplica);
  ok(previa.resumen.productos === antes.length && cambian.length > 0, "la vista previa trae todos los productos del laboratorio", `${previa.resumen.productos} de ${antes.length}`);
  ok(cambian.every((l) => { const a = antes.find((x) => x.id === l.producto_id); return Number(l.caja_despues) === Math.ceil((a.pc * 1.05) / 50) * 50; }), "cada caja sube 5 % redondeada hacia arriba a $50");
  ok(cambian.every((l) => l.unidad_despues === null || (Number(l.unidad_despues) % 50 === 0 && Number(l.unidad_despues) <= Number(l.caja_despues))), "el precio por unidad sube en proporción, redondeado y nunca mayor que la caja");
  ok((await p.locator('[data-prueba="cambian"]').innerText()).startsWith(String(cambian.length)), "la pantalla dice cuántos productos cambian");
  ok(await p.locator("tbody tr").count() === previa.lineas.length && /→/.test(await p.locator(`tr[data-producto="${cambian[0].producto_id}"] [data-campo="caja"]`).innerText()), "la tabla muestra antes → después");
  ok(/Margen promedio/.test(await p.locator("main").innerText()) && /%\s*→\s*[\d,]+ %/.test(await p.locator("dl").first().innerText()), "muestra el margen antes y después");
  await p.screenshot({ path: `${OUT}/precios-vista-previa-1440.png`, fullPage: true });
  ok(await q1(`select count(*)::int n from cambios_precio where empresa_id = $1`, [EMP.id]).then((r) => r.n) === 0, "la vista previa no cambia nada");
  await p.getByRole("button", { name: new RegExp(`^Aplicar a ${cambian.length} producto`) }).click();
  await p.getByRole("alertdialog").waitFor();
  await Promise.all([p.waitForURL(/\/productos\/precios\/[0-9a-f-]{36}\?aplicado=1/, { timeout: 20000 }), p.getByRole("button", { name: "Sí, aplicar" }).click()]);
  await p.waitForLoadState("networkidle");
  CAMBIO = p.url().match(/precios\/([0-9a-f-]{36})/)[1];
  ok(/Listo: cambió el precio de \d+ producto/.test(await p.getByRole("status").first().innerText()), "aviso de cambio aplicado");
  const aplicados = await filas(`select id, precio_caja::float pc, precio_unidad::float pu from productos where id = any($1) order by id`, [cambian.map((l) => l.producto_id)]);
  ok(aplicados.every((a) => { const l = cambian.find((x) => x.producto_id === a.id); return a.pc === Number(l.caja_despues) && a.pu === (l.unidad_despues === null ? null : Number(l.unidad_despues)); }), "lo aplicado es exactamente la vista previa");
  ok((await q1(`select count(*)::int n from auditoria where accion = 'cambio_precio' and entidad_id = any($1) and creado > now() - interval '5 minutes'`, [cambian.map((l) => l.producto_id)])).n >= cambian.length, "cada precio quedó en la auditoría");
  await p.screenshot({ path: `${OUT}/precios-detalle-1440.png`, fullPage: true });
  await p.getByRole("button", { name: "Revertir este cambio" }).click();
  await p.getByRole("button", { name: "Sí, revertir" }).click();
  await p.getByRole("status").filter({ hasText: /Revertido: \d+ producto/ }).waitFor({ timeout: 15000 });
  ok(/Revertido el/.test(await p.locator('[data-prueba="estado"]').innerText()), "el estado pasa a revertido sin recargar");
  const despues = await filas(`select id, precio_caja::float pc, precio_unidad::float pu from productos where empresa_id = $1 and activo and laboratorio = $2 order by id`, [EMP.id, LAB]);
  ok(JSON.stringify(despues) === JSON.stringify(antes), "revertir deja exactamente los precios de antes");
  const rev2 = await api(p, `/api/precios/${CAMBIO}/revertir`, "POST", {});
  ok(rev2.status === 422 && /ya se revirtió/.test(rev2.j.error), "no se revierte dos veces", `${rev2.status} ${rev2.j.error}`);
  await ir(p, "/productos/precios");
  ok(/revertido el/.test(await p.getByRole("list", { name: "Cambios de precio" }).innerText()), "el historial muestra el cambio revertido");

  // 2) Margen objetivo sobre el costo sin IVA de la última compra (M: $1.000 + IVA 19 %)
  await p.getByLabel("Productos que elijo").check();
  await p.fill("#f-buscar", M.ean);
  await p.getByRole("list", { name: "Productos elegidos" }).getByText(M.nombre).waitFor();
  await p.getByLabel("Margen objetivo").check();
  await p.fill("#regla-valor", "30");
  await p.getByRole("radio", { name: "A $100" }).click();
  const [r2] = await Promise.all([p.waitForResponse((r) => r.url().endsWith("/api/precios/vista-previa")), p.getByRole("button", { name: "Ver vista previa" }).click()]);
  const pm = (await r2.json()).lineas[0];
  const esperado = Math.ceil((1000 * M.upc / 0.7) * 1.19 / 100) * 100;
  ok(Number(pm.costo) === 1000 && pm.heredado === false, "usa el costo sin IVA de la última compra ($1.000, no $1.190)", String(pm.costo));
  ok(Number(pm.caja_despues) === esperado, "precio = costo × und ÷ (1 − 30 %) × IVA, redondeado a $100", `${pm.caja_despues} vs ${esperado}`);
  ok(Number(pm.margen_despues) >= 30 && Number(pm.margen_despues) < 31, "margen después ≈ 30 %", String(pm.margen_despues));
  ok((await p.locator(`tr[data-producto="${M.id}"]`).innerText()).includes("$1.000"), "la pantalla muestra el costo por unidad sin IVA");
  await p.getByRole("button", { name: /^Aplicar a 1 producto/ }).click();
  await Promise.all([p.waitForURL(/\/productos\/precios\/[0-9a-f-]{36}/, { timeout: 20000 }), p.getByRole("button", { name: "Sí, aplicar" }).click()]);
  ok(Number((await q1(`select precio_caja from productos where id = $1`, [M.id])).precio_caja) === esperado, "el precio con margen quedó aplicado");
  // Firma vieja (los precios cambiaron desde la vista previa) → la base lo rechaza
  const viejo = await api(p, "/api/precios", "POST", { filtro: { tipo: "laboratorio", valor: LAB }, regla: { tipo: "porcentaje", valor: 7 }, redondeo: 50, firma: previa.firma });
  ok(viejo.status === 422 && /vista previa/.test(viejo.j.error), "aplicar con una firma que no es la de su vista previa se rechaza", viejo.j.error);
  ok((await q1(`select count(*)::int n from cambios_precio where empresa_id = $1`, [EMP.id])).n === 2, "y no deja ningún cambio");

  // 3) Código alterno desde la ficha del producto; duplicado → 409
  const ALT = "29" + R + "071";
  await ir(p, `/productos/${Q.id}`);
  await p.fill("#codigo-alterno", ALT);
  await p.getByRole("button", { name: "Agregar código" }).click();
  await p.getByRole("list", { name: "Códigos alternos" }).getByText(ALT).waitFor({ timeout: 10000 });
  ok((await q1(`select count(*)::int n from producto_codigos where producto_id = $1 and codigo = $2`, [Q.id, ALT])).n === 1, "el código alterno queda guardado en el producto");
  await p.screenshot({ path: `${OUT}/producto-codigos-1440.png`, fullPage: true });
  const dup = await api(p, `/api/productos/${M.id}/codigos`, "POST", { codigo: ALT });
  ok(dup.status === 409 && dup.j.error.includes(Q.nombre), "código alterno duplicado en otro producto → 409 con el nombre", `${dup.status} ${dup.j.error}`);
  const dupEan = await api(p, `/api/productos/${Q.id}/codigos`, "POST", { codigo: M.ean });
  ok(dupEan.status === 409, "el código principal de otro producto → 409", `${dupEan.status} ${dupEan.j.error}`);
  const busq = await api(p, `/api/productos?q=${ALT}`);
  ok(busq.j.productos?.[0]?.id === Q.id && busq.j.productos[0].exacto === true, "la búsqueda encuentra el producto por el código alterno (exacto)");
  const imp = await api(p, "/api/productos/importar", "POST", { simular: true, filas: [{ nombre: "Nombre distinto en el archivo del proveedor", codigo_barras: ALT, precio_caja: 9999 }] });
  ok(imp.status === 200 && imp.j.resumen?.crear === 0 && imp.j.plan?.[0]?.accion === "actualizar", "la importación encuentra el producto por su código alterno (no crea otro)", JSON.stringify(imp.j.resumen ?? imp.j));
  globalThis.ALT = ALT;
}

// ───────────── Cajera: escanear el código alterno en la caja, con y sin internet; 403 en lo demás
{
  const { ctx, p, errs } = await entrar("Laura");
  await p.waitForLoadState("networkidle");
  await p.waitForFunction((alt) => { try { return JSON.parse(localStorage.getItem("regenta.catalogo") ?? "null")?.productos?.some((x) => (x.codigos ?? []).includes(alt)); } catch { return false; } }, globalThis.ALT, { timeout: 20000 });
  ok(true, "el catálogo sin internet trae los códigos alternos");
  const quitar = p.locator("#venta").getByRole("button", { name: `Quitar ${Q.nombre}` });
  await p.locator("#buscar").fill(globalThis.ALT); await p.keyboard.press("Enter");
  await quitar.waitFor({ timeout: 10000 }).catch(() => {});
  ok(await quitar.count() === 1, "escanear el código alterno en la caja agrega el producto");
  await quitar.click();
  await ctx.setOffline(true);
  await p.locator("#buscar").fill(globalThis.ALT); await p.keyboard.press("Enter");
  await quitar.waitFor({ timeout: 10000 }).catch(() => {});
  ok(await quitar.count() === 1, "sin internet, el código alterno también agrega el producto");
  await p.screenshot({ path: `${OUT}/caja-codigo-alterno-sin-internet-1440.png` });
  await quitar.click();
  await ctx.setOffline(false);
  const pruebas = [["GET", "/api/precios"], ["POST", "/api/precios", { filtro: { tipo: "iva", valor: "0" }, regla: { tipo: "porcentaje", valor: 5 }, redondeo: 50, firma: "x" }],
    ["POST", "/api/precios/vista-previa", { filtro: { tipo: "iva", valor: "0" }, regla: { tipo: "porcentaje", valor: 5 }, redondeo: 50 }], ["GET", `/api/precios/${CAMBIO}`],
    ["POST", `/api/precios/${CAMBIO}/revertir`, {}], ["GET", `/api/etiquetas?ids=${Q.id}`], ["GET", "/api/inventario/cuarentena"], ["POST", "/api/inventario/cuarentena", { lote_id: L2.lote_id, motivo: "intento" }],
    ["PATCH", "/api/inventario/cuarentena", { destino: "cuarentena" }], ["POST", "/api/inventario/cuarentena/liberar", { lote_id: L2.lote_id, motivo: "intento" }],
    ["POST", "/api/inventario/cuarentena/baja", { lote_id: L2.lote_id, motivo: "averia" }], ["GET", `/api/productos/${Q.id}/codigos`], ["POST", `/api/productos/${Q.id}/codigos`, { codigo: "CAJ-1" }],
    ["DELETE", `/api/productos/${Q.id}/codigos`, { codigo_id: 1 }]];
  for (const [m, u, c] of pruebas) { const r = await api(p, u, m, c); ok(r.status === 403, `la cajera recibe 403 en ${m} ${u.replace(/[0-9a-f-]{36}/g, ":id")}`, `${r.status} ${r.j.error ?? ""}`); }
  for (const ruta of ["/productos/precios", `/productos/precios/${CAMBIO}`, "/etiquetas", "/inventario/cuarentena"]) {
    await ir(p, ruta);
    ok(!new URL(p.url()).pathname.startsWith(ruta), `la cajera no entra a ${ruta.replace(/[0-9a-f-]{36}/, ":id")}`, p.url());
  }
  ok(sinProvocados(p, errs).filter((e) => !/ERR_INTERNET_DISCONNECTED|net::ERR/.test(e)).length === 0, "sin errores de consola (cajera)", sinProvocados(p, errs).join(" | "));
  await ctx.close();
}

// ───────────── Bodega: etiquetas y cuarentena sí; precios y configuración no
{
  const { ctx, p, errs } = await entrar("Andrés");
  ok((await api(p, "/api/precios")).status === 403 && (await api(p, "/api/precios/vista-previa", "POST", { filtro: { tipo: "iva", valor: "0" }, regla: { tipo: "porcentaje", valor: 5 }, redondeo: 50 })).status === 403, "la bodega no cambia precios (403)");
  ok((await api(p, "/api/inventario/cuarentena", "PATCH", { destino: "cuarentena" })).status === 403, "la bodega no cambia el destino de las devoluciones (403)");
  ok((await api(p, `/api/etiquetas?compra=${NCOMPRA}`)).status === 200 && (await api(p, "/api/inventario/cuarentena")).status === 200, "la bodega imprime etiquetas y ve la cuarentena");
  await ir(p, "/inventario/cuarentena");
  ok(/\/inventario\/cuarentena$/.test(p.url()) && await p.getByRole("heading", { name: "Devoluciones de clientes" }).count() === 0, "la bodega entra a la cuarentena sin la configuración");
  ok(sinProvocados(p, errs).length === 0, "sin errores de consola (bodega)", sinProvocados(p, errs).join(" | "));
  await ctx.close();
}

// ───────────── Dueño: etiquetas, devolución a cuarentena, liberar y dar de baja con acta
{
  const { p } = D;
  // 4) Etiquetas A4 y rollo: sin desborde, con código de barras legible
  await ir(p, "/etiquetas");
  const lab1 = await q1(`select id, ean from productos where empresa_id = $1 and activo and laboratorio = $2 and ean ~ '^\\d{13}$' order by length(nombre) desc limit 1`, [EMP.id, LAB]);
  for (const prodE of [Q, lab1]) {
    const n0 = await p.getByRole("list", { name: "Etiquetas a imprimir" }).locator("li").count().catch(() => 0);
    await p.fill("#buscar-etiqueta", prodE.ean);
    await p.waitForFunction((n) => (document.querySelector('[aria-label="Etiquetas a imprimir"]')?.children.length ?? 0) > n, n0, { timeout: 10000 });
  }
  await p.getByLabel(/Hoja A4/).check();
  await p.getByLabel(`Copias de ${Q.nombre}`).fill("2");
  await p.waitForFunction(() => document.querySelectorAll('[data-prueba="vista-etiquetas"] .rot').length === 3);
  const a4 = await revisarEtiquetas(p);
  ok(a4.length === 3, "A4: una etiqueta por copia", String(a4.length));
  ok(a4.every((e) => !e.fuera.length && !e.desbordeTexto), "A4: nada se sale de la etiqueta", JSON.stringify(a4.map((e) => e.fuera)));
  ok(a4.every((e) => Math.abs(e.ancho - 63.5 * 96 / 25.4) < 1.5 && Math.abs(e.alto - 38.1 * 96 / 25.4) < 1.5), "A4: etiquetas de 63,5 × 38,1 mm", `${a4[0].ancho}×${a4[0].alto}`);
  ok(a4.every((e) => e.tipo === "EAN-13" && leerEan13(e.modulos) === e.codigo), "A4: código de barras EAN-13 que se lee con su dígito de control", a4.map((e) => `${e.codigo}:${e.modulos ? leerEan13(e.modulos) : "-"}`).join(" "));
  ok(a4[0].codigo === Q.ean && /Unidad \$/.test(a4[0].texto) && /Caja x \d+ \$/.test(a4[0].texto), "A4: nombre, precio de la caja y de la unidad", a4[0].texto.replace(/\n/g, " | "));
  await p.screenshot({ path: `${OUT}/etiquetas-a4-1440.png`, fullPage: true });
  await p.getByRole("button", { name: "Imprimir 3 etiquetas" }).click();
  const doc = await p.locator('iframe[title="Etiquetas"]').last().getAttribute("srcdoc");
  ok(/@page\{size:A4;margin:0\}/.test(doc) && (doc.match(/class="rot rot-a4"/g) ?? []).length === 3, "imprime una hoja A4 con las 3 etiquetas");
  await p.getByLabel(/Rollo/).check();
  await p.waitForFunction(() => document.querySelectorAll('[data-prueba="vista-etiquetas"] .rot-rollo').length === 3);
  const rollo = await revisarEtiquetas(p);
  ok(rollo.every((e) => !e.fuera.length && !e.desbordeTexto), "rollo: nada se sale de la etiqueta de 50 × 25 mm", JSON.stringify(rollo.map((e) => e.fuera)));
  ok(rollo.every((e) => Math.abs(e.ancho - 50 * 96 / 25.4) < 1.5 && Math.abs(e.alto - 25 * 96 / 25.4) < 1.5), "rollo: 50 × 25 mm", `${rollo[0].ancho}×${rollo[0].alto}`);
  ok(rollo.every((e) => e.tipo === "EAN-13" && leerEan13(e.modulos) === e.codigo), "rollo: código de barras presente y legible");
  await p.screenshot({ path: `${OUT}/etiquetas-rollo-1440.png`, fullPage: true });
  await p.getByRole("button", { name: "Imprimir 3 etiquetas" }).click();
  const doc2 = await p.locator('iframe[title="Etiquetas"]').last().getAttribute("srcdoc");
  ok(/@page\{size:50mm 25mm;margin:0\}/.test(doc2), "el rollo se imprime en páginas de 50 × 25 mm");
  // Lo recibido en una compra, desde la ficha de la compra
  await ir(p, `/compras/${COMPRA.id}`);
  await Promise.all([p.waitForURL(/\/etiquetas\?compra=\d+/), p.getByRole("link", { name: "Imprimir etiquetas de lo recibido" }).click()]);
  await p.waitForLoadState("networkidle");
  ok(new RegExp(`compra N\\.º ${NCOMPRA}`).test(await p.getByRole("status").first().innerText()), "las etiquetas de la compra dicen su número");
  await p.waitForFunction(() => document.querySelectorAll('[data-prueba="vista-etiquetas"] .rot').length === 1);
  ok((await revisarEtiquetas(p))[0].producto === M.id, "trae lo recibido en la compra");
  ok((await api(p, "/api/etiquetas?compra=999999")).status === 404, "una compra que no existe → 404");

  // 5) Devolución a cuarentena: el lote no se vende y FEFO lo salta
  const v = await api(p, "/api/ventas", "POST", { idem_key: crypto.randomUUID(), tipo_doc: "pos", lineas: [{ producto_id: Q.id, presentacion: "unidad", cantidad: 1 }], pagos: [{ medio: "efectivo", valor: 100000 }] });
  const ven = v.j.venta?.venta_id;
  ok(v.status === 200 && (await q1(`select lote_id from venta_lineas where venta_id = $1`, [ven])).lote_id === L1.lote_id, "la venta toma el primer lote por FEFO", String(v.status));
  await ir(p, `/ventas/${ven}`);
  await p.getByRole("button", { name: "Devolver productos" }).click();
  await p.getByLabel(/Cantidad a devolver de/).first().fill("1");
  await p.fill("#dev-motivo", "Empaque abierto por el cliente");
  await p.getByLabel(/A cuarentena/).check();
  ok(/Todo el lote/.test(await p.locator('[aria-label="Devolución"]').innerText()), "avisa que el lote completo queda separado");
  await p.screenshot({ path: `${OUT}/devolucion-cuarentena-1440.png`, fullPage: true });
  await p.getByRole("button", { name: "Registrar devolución" }).click();
  await p.getByRole("heading", { name: "Devoluciones" }).waitFor({ timeout: 15000 });
  const lb = await q1(`select bloqueado, bloqueo_tipo from lotes where id = $1`, [L1.lote_id]);
  ok(lb.bloqueado && lb.bloqueo_tipo === "devolucion", "el lote queda separado como devolución en revisión");
  ok((await q1(`select destino from devoluciones where venta_id = $1`, [ven])).destino === "cuarentena", "la devolución guarda su destino");
  const v2 = await api(p, "/api/ventas", "POST", { idem_key: crypto.randomUUID(), tipo_doc: "pos", lineas: [{ producto_id: Q.id, presentacion: "unidad", cantidad: 1 }], pagos: [{ medio: "efectivo", valor: 100000 }] });
  ok(v2.status === 200 && (await q1(`select lote_id from venta_lineas where venta_id = $1`, [v2.j.venta.venta_id])).lote_id === L2.lote_id, "FEFO salta el lote en cuarentena y vende del siguiente");
  // 6) Liberar desde la pantalla → se vende otra vez
  await ir(p, "/inventario/cuarentena");
  const tarjeta = p.locator(`li[data-lote="${L1.lote_id}"]`);
  ok(/Devolución de cliente/.test(await tarjeta.innerText()) && /Empaque abierto/.test(await tarjeta.innerText()), "la cuarentena muestra el lote con su tipo y motivo");
  await p.screenshot({ path: `${OUT}/cuarentena-1440.png`, fullPage: true });
  await tarjeta.getByRole("button", { name: "Liberar para la venta" }).click();
  await tarjeta.getByLabel(/Qué se revisó/).fill("Empaque sellado, en buen estado");
  await tarjeta.getByRole("button", { name: "Liberar lote" }).click();
  await p.getByRole("status").filter({ hasText: /volvió a la venta/ }).waitFor({ timeout: 10000 });
  ok(await p.locator(`li[data-lote="${L1.lote_id}"]`).count() === 0, "el lote sale de la lista sin recargar");
  ok((await q1(`select bloqueado from lotes where id = $1`, [L1.lote_id])).bloqueado === false, "el lote queda liberado");
  const v3 = await api(p, "/api/ventas", "POST", { idem_key: crypto.randomUUID(), tipo_doc: "pos", lineas: [{ producto_id: Q.id, presentacion: "unidad", cantidad: 1 }], pagos: [{ medio: "efectivo", valor: 100000 }] });
  ok(v3.status === 200 && (await q1(`select lote_id from venta_lineas where venta_id = $1`, [v3.j.venta.venta_id])).lote_id === L1.lote_id, "liberado: se vende de nuevo (FEFO lo toma primero)");
  // 7) Poner en cuarentena desde la pantalla y dar de baja con acta
  await p.fill("#buscar-cuarentena", Q.ean);
  await p.locator("#lote-nuevo").waitFor();
  await p.locator("#lote-nuevo").selectOption(L1.lote_id);
  await p.fill("#motivo-nuevo", "Cadena de frío en duda");
  await p.getByRole("button", { name: "Poner en cuarentena" }).click();
  await p.getByRole("status").filter({ hasText: /quedó en cuarentena/ }).waitFor({ timeout: 10000 });
  ok((await q1(`select bloqueo_tipo from lotes where id = $1`, [L1.lote_id])).bloqueo_tipo === "cuarentena", "el lote queda en cuarentena");
  const quedan = await stockLote(L1.lote_id);
  const t2 = p.locator(`li[data-lote="${L1.lote_id}"]`);
  await t2.getByRole("button", { name: "Dar de baja" }).click();
  await t2.getByLabel("Motivo de la baja").selectOption("averia");
  await t2.getByRole("button", { name: "Dar de baja" }).last().click();
  await p.getByRole("status").filter({ hasText: /Baja N\.º \d+ registrada/ }).waitFor({ timeout: 10000 });
  ok(await stockLote(L1.lote_id) === 0 && quedan > 0, "la baja saca todo el lote", `${quedan} → 0`);
  const aj = await q1(`select a.id, a.numero, a.motivo, a.detalle from ajustes a join ajuste_lineas al on al.ajuste_id = a.id where al.lote_id = $1 order by a.creado desc limit 1`, [L1.lote_id]);
  ok(aj?.motivo === "averia" && /cuarentena/.test(aj.detalle), "la baja es un ajuste con motivo y su origen", aj?.detalle);
  await Promise.all([p.waitForURL(/\/inventario\/actas\//), p.getByRole("link", { name: "Ver e imprimir el acta" }).click()]);
  await p.waitForLoadState("networkidle");
  const acta = await p.locator("#documento").innerText();
  ok(/Acta de baja de productos/.test(acta) && acta.includes(L1.lote), "dar de baja desde la cuarentena genera el acta con el lote");
  // INVIMA: no se libera desde la cuarentena
  await pool.query(`update lotes set bloqueado = true, bloqueo_tipo = 'invima', bloqueo_motivo = 'Alerta INVIMA E2E' where id = $1`, [L2.lote_id]);
  await ir(p, "/inventario/cuarentena");
  const inv = p.locator(`li[data-lote="${L2.lote_id}"]`);
  ok(/Alerta del INVIMA/.test(await inv.innerText()) && await inv.getByRole("button", { name: "Liberar para la venta" }).count() === 0, "un lote del INVIMA no ofrece liberar");
  const lib = await api(p, "/api/inventario/cuarentena/liberar", "POST", { lote_id: L2.lote_id, motivo: "Intento por API" });
  ok(lib.status === 422 && /INVIMA/.test(lib.j.error), "ni por la API", lib.j.error);
  const destino = await api(p, "/api/inventario/cuarentena", "PATCH", { destino: "cuarentena" });
  ok(destino.status === 422 && /demostración/.test(destino.j.error), "en la demo el destino por defecto no se cambia", destino.j.error);
  await pool.query(`update lotes set bloqueado = false where id = $1`, [L2.lote_id]);
}

// ───────────── Aislamiento: el dueño de otra droguería no ve ni toca nada de A
{
  const jwt = await new SignJWT({ uid: DUENO_B, empresa: EB.id, nombre: "Dueño Vecina", rol: "dueno", v: 0 }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h")
    .sign(new TextEncoder().encode(process.env.REGENTA_SESSION_SECRET ?? "prueba-local-0123456789abcdef0123456789abcdef"));
  const ctx = await b.newContext();
  await ctx.addCookies([{ name: "regenta_sesion", value: jwt, url: B }]);
  const p = await ctx.newPage(); const errs = vigilar(p);
  await ir(p, "/productos/precios");
  ok(/\/productos\/precios$/.test(p.url()) && !(await p.locator("main").innerText()).includes(LAB), "B entra a sus precios y no ve el historial de A");
  ok((await api(p, "/api/precios")).j.cambios?.length === 0, "B no lista cambios de A");
  ok((await api(p, `/api/precios/${CAMBIO}`)).status === 404 && (await api(p, `/api/precios/${CAMBIO}/revertir`, "POST", {})).status === 404, "B no lee ni revierte un cambio de A (404)");
  ok((await api(p, `/api/productos/${Q.id}/codigos`)).status === 404 && (await api(p, `/api/productos/${Q.id}/codigos`, "POST", { codigo: "B-ATAQUE" })).status === 404, "B no ve ni agrega códigos a un producto de A");
  ok((await api(p, `/api/productos?q=${globalThis.ALT}`)).j.productos.length === 0, "B no encuentra productos de A por su código alterno");
  ok((await api(p, `/api/etiquetas?ids=${Q.id}`)).j.productos.length === 0 && (await api(p, `/api/etiquetas?compra=${NCOMPRA}`)).status === 404, "B no imprime etiquetas de A");
  ok((await api(p, "/api/inventario/cuarentena")).j.lotes.length === 0, "B no ve la cuarentena de A");
  for (const [u, c] of [["/api/inventario/cuarentena", { lote_id: L2.lote_id, motivo: "ataque" }], ["/api/inventario/cuarentena/liberar", { lote_id: L2.lote_id, motivo: "ataque" }], ["/api/inventario/cuarentena/baja", { lote_id: L2.lote_id, motivo: "averia" }]]) {
    ok((await api(p, u, "POST", c)).status === 404, `B no toca lotes de A: ${u}`);
  }
  const prev = await api(p, "/api/precios/vista-previa", "POST", { filtro: { tipo: "productos", valor: [Q.id] }, regla: { tipo: "porcentaje", valor: 5 }, redondeo: 50 });
  ok(prev.status === 200 && prev.j.resumen.productos === 0, "la vista previa de B no incluye productos de A");
  ok((await q1(`select bloqueado from lotes where id = $1`, [L2.lote_id])).bloqueado === false, "el lote de A sigue igual");
  ok(sinProvocados(p, errs).filter((e) => !/status of 404/.test(e)).length === 0, "sin errores de consola (dueño B)", sinProvocados(p, errs).join(" | "));
  await ctx.close();
}

// ───────────── Celular (iPhone 13): sin desbordes
{
  const { ctx, p, errs } = await entrar("Carlos", { ...devices["iPhone 13"] });
  const ventaQ = (await q1(`select v.id from ventas v join venta_lineas l on l.venta_id = v.id where l.producto_id = $1 and v.estado = 'cerrada' and v.empresa_id = $2 order by v.creado desc limit 1`, [Q.id, EMP.id])).id;
  await pool.query(`update lotes set bloqueado = true, bloqueo_tipo = 'cuarentena', bloqueo_motivo = 'Revisión de un producto con un nombre bastante largo para ver el celular' where id = $1`, [L2.lote_id]);
  const pantallas = [["/productos/precios", "precios"], [`/productos/precios/${CAMBIO}`, "precios-detalle"], [`/etiquetas?compra=${NCOMPRA}`, "etiquetas"], ["/inventario/cuarentena", "cuarentena"],
    [`/productos/${Q.id}`, "producto-codigos"], [`/ventas/${ventaQ}`, "venta-devolver"]];
  for (const [ruta, nombre] of pantallas) {
    await ir(p, ruta);
    if (nombre === "precios") {
      await p.getByLabel("Un laboratorio").check(); await p.locator("#f-lab").selectOption(LAB); await p.fill("#regla-valor", "3");
      await p.getByRole("button", { name: "Ver vista previa" }).click(); await p.getByRole("heading", { name: "3. Vista previa" }).waitFor();
    }
    if (nombre === "venta-devolver") { await p.getByRole("button", { name: "Devolver productos" }).click(); await p.getByLabel(/A cuarentena/).check(); }
    if (nombre === "cuarentena") await p.locator(`li[data-lote="${L2.lote_id}"]`).getByRole("button", { name: "Dar de baja" }).click();
    const d = await desborde(p);
    ok(d <= 0, `sin desborde horizontal en el celular: ${nombre}`, `${d}px`);
    const c = await cortados(p);
    ok(c.length === 0, `nada se sale de la pantalla en el celular: ${nombre}`, c.join(", "));
    await p.screenshot({ path: `${OUT}/${nombre}-iphone13.png` });
    const alto = await p.evaluate(() => document.documentElement.scrollHeight);
    await p.screenshot({ path: `${OUT}/${nombre}-iphone13-completa.png`, fullPage: true, clip: { x: 0, y: 0, width: 390, height: Math.min(alto, 3200) } });
    if (nombre === "etiquetas") {
      await p.getByLabel(/Rollo/).check();
      ok((await desborde(p)) <= 0, "sin desborde en el celular: etiquetas en rollo");
      await p.screenshot({ path: `${OUT}/etiquetas-rollo-iphone13.png`, fullPage: true });
    }
  }
  await pool.query(`update lotes set bloqueado = false where id = $1`, [L2.lote_id]);
  ok(sinProvocados(p, errs).length === 0, "sin errores de consola (celular)", sinProvocados(p, errs).join(" | "));
  await ctx.close();
}

ok(sinProvocados(D.p, D.errs).length === 0, "sin errores de consola (dueño)", sinProvocados(D.p, D.errs).join(" | "));
await b.close(); await pool.end();
console.log(`\n${fallos} fallos`);
process.exit(fallos ? 1 : 0);
