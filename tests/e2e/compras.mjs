// Compras, proveedores y cuentas por pagar: compra a crédito con 3 líneas (bonificada, IVA 19 %, descuento, precio nuevo)
// con totales al centavo y cuadre contra la factura; stock y kardex suben; costo del lote sin IVA y promedio ponderado al
// repetir lote; factura repetida → 409; la bodega recibe sin ver costos y el dueño completa; pagos parcial y total (saldo
// 0); efectivo sin turno → error, con turno → egreso en el turno; devolución + nota crédito; anular con pagos bloqueado y
// sin pagos revierte el stock; acta de recepción; cajera 403 en todo; aislamiento entre empresas; celular sin desbordes y
// sin errores de consola. Capturas de escritorio (1440) y iPhone 13 en test-results/compras.
// Uso: servidor con la base sembrada → BASE=http://localhost:4511 DATABASE_URL=… REGENTA_SESSION_SECRET=… node tests/e2e/compras.mjs
import { chromium, devices } from "playwright-core";
import { mkdirSync } from "node:fs";
import pg from "pg";
import { SignJWT } from "jose";

const B = process.env.BASE ?? "http://localhost:4500";
const OUT = process.env.OUT ?? "test-results/compras";
mkdirSync(OUT, { recursive: true });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/regenta?host=/tmp" });
let fallos = 0;
const ok = (c, m, x = "") => { console.log(`${c ? "PASS" : "FAIL"} ${m}${x ? " — " + x : ""}`); if (!c) fallos++; };
const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium" });
{ const nc = b.newContext.bind(b); b.newContext = async (o) => { const c = await nc(o); await c.addInitScript(() => { try { sessionStorage.setItem("regenta_demo_v1", JSON.stringify({ hechos: [], ofertas: ["prueba", "prueba"], cerrada: true, inicio: Date.now() })); } catch {} }); return c; }; }

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
const stockLote = async (lote) => Number((await q1(`select coalesce(sum(cantidad), 0) u from movimientos where lote_id = $1`, [lote])).u);
const saldo = async (compra) => Number((await q1(`select coalesce((select saldo from v_cuentas_por_pagar where compra_id = $1), -1) s`, [compra])).s);
const costoLote = async (lote) => Number((await q1(`select costo_unidad from lote_costos where lote_id = $1`, [lote]))?.costo_unidad);
const desborde = (p) => p.evaluate(() => Math.max(document.documentElement.scrollWidth, innerWidth) - screen.width);
const cortados = (p) => p.evaluate(() => [...document.querySelectorAll("main *")].filter((el) => {
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.right <= screen.width + 1) return false;
  for (let a = el.parentElement; a; a = a.parentElement) if (/(auto|scroll)/.test(getComputedStyle(a).overflowX)) return false;
  return true;
}).slice(0, 3).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} (${Math.round(el.getBoundingClientRect().right)}px)`));

const EMP = await q1(`select e.id, (select id from sedes where empresa_id = e.id order by creado limit 1) sede_id from empresas e where e.demo limit 1`);
// Esta prueba revisa el IVA descontable de las compras: la droguería es responsable de IVA (la demo viene como no
// responsable; ese caso se prueba al final).
await pool.query(`update empresas set responsable_iva = true where id = $1`, [EMP.id]);
const EB = await q1(`select id from empresas where not demo and nit = '900000002'`);
const DUENO_B = "00000000-0000-4000-8000-000000000004";
const R = Date.now().toString().slice(-7);
const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
const en30 = new Date(Date.now() + 30 * 864e5).toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
const VENCE = "2030-12-31";
// Tres productos distintos con código de barras único (el lector los agrega directo); el primero se vende por caja.
const prods = (await pool.query(`select p.id, p.nombre, p.ean, p.unidades_por_caja upc, p.precio_caja::float, p.iva::float from productos p
  where p.empresa_id = $1 and p.activo and p.ean is not null and not p.control_especial and (select count(*) from productos o where o.empresa_id = p.empresa_id and o.ean = p.ean) = 1
  order by (p.unidades_por_caja > 1) desc, p.nombre limit 40`, [EMP.id])).rows;
const P1 = prods.find((x) => x.upc > 1), P2 = prods.find((x) => x.id !== P1.id && x.upc > 1) ?? prods[1], P3 = prods.find((x) => x.id !== P1.id && x.id !== P2.id);
ok(!!(P1 && P2 && P3), "hay tres productos con código de barras para la prueba", [P1?.nombre, P2?.nombre, P3?.nombre].join(" | "));
const PROV = `Distribuidora E2E ${R}`, FACT = `FE-${R}`;

async function agregar(p, prod) {
  const antes = await p.locator('input[id^="lote-"]').count();
  await p.fill("#buscar-recibir", prod.ean);
  await p.locator('input[id^="lote-"]').nth(antes).waitFor();
  return (await p.locator('input[id^="lote-"]').nth(antes).getAttribute("id")).slice(5);
}

// ───────────── Dueño: compra a crédito con 3 líneas desde la pantalla
const D = await entrar("Carlos");
let C1, C2, CB, L1, L3;
{
  const { p } = D;
  await ir(p, "/inventario/recibir");
  ok(/\/compras\/nueva$/.test(p.url()), "«Recibir mercancía» lleva a la compra nueva", p.url());
  await p.fill("#proveedor", PROV);
  await p.getByText("Proveedor nuevo: se crea al guardar.").waitFor();
  await p.fill("#nit-nuevo", "900123456");
  await p.fill("#factura", FACT);
  await p.getByText("A crédito", { exact: true }).click();
  await p.fill("#vence-pago", en30);
  // Línea 1: 2 cajas a $10.000,50 la caja (sin IVA), IVA 0, precio de venta nuevo
  const k1 = await agregar(p, P1);
  await p.fill(`#lote-${k1}`, `C1${R}`); await p.fill(`#vence-${k1}`, VENCE); await p.fill(`#cajas-${k1}`, "2");
  await p.fill(`#costo-${k1}`, "10.000,50"); await p.selectOption(`#costo-por-${k1}`, "caja"); await p.selectOption(`#iva-${k1}`, "0");
  await p.fill(`#precio-${k1}`, String(P1.precio_caja + 1000));
  // Línea 2: 10 unidades a $1.234,56 c/u, 5 % de descuento, IVA 19 %
  const k2 = await agregar(p, P2);
  await p.fill(`#lote-${k2}`, `C2${R}`); await p.fill(`#vence-${k2}`, VENCE); await p.fill(`#sueltas-${k2}`, "10");
  await p.fill(`#costo-${k2}`, "1234,56"); if (await p.locator(`#costo-por-${k2}`).count()) await p.selectOption(`#costo-por-${k2}`, "unidad");
  await p.fill(`#desc-${k2}`, "5"); await p.selectOption(`#iva-${k2}`, "19");
  // Línea 3: 5 pagadas + 1 bonificada a $3.000
  const k3 = await agregar(p, P3);
  await p.fill(`#lote-${k3}`, `C3${R}`); await p.fill(`#vence-${k3}`, VENCE); await p.fill(`#sueltas-${k3}`, "5"); await p.fill(`#bonif-${k3}`, "1");
  await p.fill(`#costo-${k3}`, "3000"); if (await p.locator(`#costo-por-${k3}`).count()) await p.selectOption(`#costo-por-${k3}`, "unidad"); await p.selectOption(`#iva-${k3}`, "0");
  ok(await p.getByText("Entran 6 unidades (1 bonificadas)").count() === 1, "la línea bonificada suma pagadas + bonificadas");
  ok(Number(await p.locator("[data-total]").getAttribute("data-total")) === 48957.7, "total calculado al centavo antes de guardar", await p.locator("[data-total]").innerText());
  ok(await p.getByText(/margen [\d,]+ % con el precio nuevo/).count() === 1, "muestra el margen con el precio de venta nuevo");
  await p.fill("#total-papel", "49.000");
  ok(await p.getByRole("note").filter({ hasText: "Diferencia con la factura: $42,30" }).count() === 1, "la diferencia con la factura se ve antes de guardar");
  ok(await p.getByRole("button", { name: "Guardar con diferencia" }).count() === 1, "el botón avisa que hay diferencia");
  await p.fill("#total-papel", "48.957,70");
  ok(await p.getByRole("note").filter({ hasText: "Cuadra con la factura." }).count() === 1, "cuadra con el total de la factura");
  await p.screenshot({ path: `${OUT}/compra-nueva-1440.png`, fullPage: true });
  await p.getByRole("button", { name: "Guardar compra" }).click();
  await p.getByRole("status").filter({ hasText: /Compra N\.º \d+ guardada/ }).waitFor({ timeout: 15000 });
  C1 = await q1(`select c.*, c.subtotal::float sub, c.descuento::float des, c.iva::float iv, c.total::float tot, c.diferencia::float dif from compras c join proveedores p on p.id = c.proveedor_id where p.nombre = $1 and c.numero_factura = $2`, [PROV, FACT]);
  ok(!!C1 && C1.estado === "registrada" && C1.condicion === "credito", "la compra queda registrada a crédito", C1?.estado);
  ok(C1.sub === 47346.6 && C1.des === 617.28 && C1.iv === 2228.38 && C1.tot === 48957.7 && C1.dif === 0, "totales al centavo: subtotal, descuento, IVA y total", `${C1.sub} ${C1.des} ${C1.iv} ${C1.tot} ${C1.dif}`);
  ok((await q1(`select vence_pago::text v from compras where id = $1`, [C1.id])).v === en30, "el vencimiento del pago queda guardado");
  const lotes = (await pool.query(`select l.id, l.lote, cl.unidades, cl.bonificadas from compra_lineas cl join lotes l on l.id = cl.lote_id where cl.compra_id = $1 order by cl.id`, [C1.id])).rows;
  [L1, , L3] = lotes.map((x) => x.id);
  ok(await stockLote(lotes[0].id) === 2 * P1.upc && await stockLote(lotes[1].id) === 10 && await stockLote(lotes[2].id) === 6, "el stock de cada lote sube (con las bonificadas)");
  ok(await costoLote(lotes[0].id) === Math.round((10000.5 / P1.upc) * 10000) / 10000, "costo del lote por unidad, sin IVA (caja ÷ unidades)", String(await costoLote(lotes[0].id)));
  ok(await costoLote(lotes[1].id) === 1172.832, "el costo del lote con IVA 19 % se guarda SIN IVA y con el descuento", String(await costoLote(lotes[1].id)));
  ok(await costoLote(lotes[2].id) === 2500, "la bonificada prorratea el costo (15.000 ÷ 6)", String(await costoLote(lotes[2].id)));
  ok((await q1(`select bool_and(not heredado) b from lote_costos where lote_id = any($1)`, [lotes.map((x) => x.id)])).b, "los costos nuevos no quedan como heredados");
  const nuevoPrecio = await q1(`select precio_caja::float pc from productos where id = $1`, [P1.id]);
  ok(nuevoPrecio.pc === P1.precio_caja + 1000, "el precio de venta nuevo queda en el producto");
  ok(!!(await q1(`select 1 x from auditoria where entidad = 'productos' and entidad_id = $1 and accion = 'cambio_precio' and creado > now() - interval '5 minutes'`, [P1.id])), "el cambio de precio queda auditado");
  const k = await api(p, `/api/inventario/kardex?producto=${P1.id}`);
  const mov = k.j.movimientos?.at(-1);
  ok(mov?.tipo === "compra" && new RegExp(`Compra N\\.º ${C1.numero} · ${PROV} · factura ${FACT}`).test(mov.documento) && mov.entrada === 2 * P1.upc, "el kardex muestra la compra con proveedor y factura", mov?.documento);
  await p.getByRole("link", { name: "Ver la compra" }).click();
  await p.waitForURL(/\/compras\/[0-9a-f-]{36}$/); await p.waitForLoadState("networkidle");
  ok(await p.getByRole("heading", { name: new RegExp(`Compra N\\.º ${C1.numero}`) }).count() === 1 && /\$48\.957,70/.test(await p.locator("main").innerText()), "el detalle muestra la compra y su total");
  await p.screenshot({ path: `${OUT}/compra-detalle-1440.png`, fullPage: true });

  // Mismo lote de nuevo (en minúsculas): promedio ponderado (6 × 2.500 + 4 × 3.500) ÷ 10 = 2.900
  const prov = C1.proveedor_id;
  const r2 = await api(p, "/api/compras", "POST", { idem_key: crypto.randomUUID(), proveedor_id: prov, numero_factura: `FE2-${R}`, fecha_factura: hoy, condicion: "credito", vence_pago: en30,
    lineas: [{ producto_id: P3.id, lote: `c3${R}`.toLowerCase(), vence: VENCE, unidades: 4, costo: 3500, costo_por: "unidad", iva_pct: 0 }] });
  ok(r2.status === 201 && r2.j.estado === "registrada", "segunda compra del mismo lote", `${r2.status} ${r2.j.error ?? ""}`);
  C2 = r2.j.id;
  ok(await costoLote(L3) === 2900, "promedio ponderado al repetir el lote", String(await costoLote(L3)));
  ok(await stockLote(L3) === 10, "el lote suma las dos compras");
  // Idempotencia: el mismo envío no duplica
  const idem = crypto.randomUUID();
  const cuerpo = { idem_key: idem, proveedor_id: prov, numero_factura: `FE3-${R}`, fecha_factura: hoy, condicion: "contado", lineas: [{ producto_id: P3.id, lote: `I${R}`, vence: VENCE, unidades: 1, costo: 100, costo_por: "unidad", iva_pct: 0 }] };
  const a = await api(p, "/api/compras", "POST", cuerpo), bb = await api(p, "/api/compras", "POST", cuerpo);
  ok(a.status === 201 && bb.status === 200 && a.j.id === bb.j.id && bb.j.repetida, "reenviar la misma compra no la duplica");
  // Factura repetida del mismo proveedor → 409
  const dup = await api(p, "/api/compras", "POST", { ...cuerpo, idem_key: crypto.randomUUID(), numero_factura: FACT.toLowerCase(), lineas: [{ ...cuerpo.lineas[0], lote: `D${R}` }] });
  ok(dup.status === 409 && /ya está registrada/.test(dup.j.error), "la misma factura del mismo proveedor → 409", `${dup.status} ${dup.j.error}`);
  const malCosto = await api(p, "/api/compras", "POST", { ...cuerpo, idem_key: crypto.randomUUID(), numero_factura: `X-${R}`, lineas: [{ ...cuerpo.lineas[0], costo: 10.555 }] });
  ok(malCosto.status === 400 && /decimales/.test(malCosto.j.error), "el costo admite máximo dos decimales", malCosto.j.error);
}

// ───────────── Bodega: recibe sin ver costos; el dueño completa
{
  const { ctx, p, errs } = await entrar("Andrés");
  await ir(p, "/compras/nueva");
  ok(await p.getByRole("heading", { name: "Recibir mercancía" }).count() === 1, "la bodega entra a recibir mercancía");
  await p.fill("#proveedor", PROV);
  await p.fill("#factura", `BOD-${R}`);
  const k = await agregar(p, P2);
  await p.fill(`#lote-${k}`, `B${R}`); await p.fill(`#vence-${k}`, VENCE); await p.fill(`#sueltas-${k}`, "8");
  ok(await p.locator('input[id^="costo-"]').count() === 0 && await p.locator("#total-papel").count() === 0 && await p.getByText("A crédito").count() === 0, "la bodega no ve costos, total ni condición de pago");
  await p.screenshot({ path: `${OUT}/bodega-recibe-1440.png`, fullPage: true });
  await p.getByRole("button", { name: "Guardar compra" }).click();
  await p.getByRole("status").filter({ hasText: /Quedó por costear/ }).waitFor({ timeout: 15000 });
  CB = (await q1(`select id, estado from compras where numero_factura = $1`, [`BOD-${R}`]));
  ok(CB?.estado === "por_costear", "la compra de la bodega queda por costear");
  const det = await api(p, `/api/compras/${CB.id}`);
  ok(det.status === 200 && det.j.compra.total === undefined && det.j.lineas.every((l) => l.costo === null && l.total === null), "la API no le entrega dinero a la bodega");
  const lista = await api(p, "/api/compras");
  ok(lista.status === 200 && lista.j.compras.every((x) => x.total === null && x.saldo === null), "la lista de compras de la bodega no trae dinero");
  ok((await api(p, "/api/cuentas-por-pagar")).status === 403, "la bodega no ve las cuentas por pagar (403)");
  ok((await api(p, "/api/compras/pagos", "POST", { proveedor_id: C1.proveedor_id, medio: "transferencia", valor: 1 })).status === 403, "la bodega no registra pagos (403)");
  ok((await api(p, `/api/compras/${CB.id}`, "PATCH", { lineas: [] })).status === 403, "la bodega no completa costos (403)");
  await ir(p, "/cuentas-por-pagar");
  ok(/\/compras$/.test(new URL(p.url()).pathname), "la bodega no entra a Cuentas por pagar", p.url());
  await ir(p, `/compras/${CB.id}`);
  ok(!/\$/.test(await p.locator("main").innerText()), "el detalle de la bodega no muestra valores");
  await ir(p, `/tiquete/recepcion/${CB.id}`);
  ok(/Acta de recepción de mercancía/.test(await p.locator("#documento").innerText()), "la bodega imprime el acta de recepción");
  ok(sinProvocados(p, errs).length === 0, "sin errores de consola (bodega)", sinProvocados(p, errs).join(" | "));
  await ctx.close();
}
{
  const { p } = D;
  await ir(p, "/inventario");
  ok(await p.getByRole("link", { name: new RegExp(`Costear compra N\\.º \\d+ · ${PROV}`) }).count() === 1, "Inventario → «Costos por completar» enlaza a la compra por costear");
  await Promise.all([p.waitForURL(/\/compras\/[0-9a-f-]{36}$/), p.getByRole("link", { name: new RegExp(`Costear compra N\\.º \\d+ · ${PROV}`) }).click()]);
  await p.waitForLoadState("networkidle");
  const linea = (await q1(`select id from compra_lineas where compra_id = $1`, [CB.id])).id;
  await p.fill(`#costo-${linea}`, "1500");
  if (await p.locator(`#costo-por-${linea}`).isEnabled()) await p.selectOption(`#costo-por-${linea}`, "unidad");
  await p.selectOption(`#iva-${linea}`, "19");
  await p.locator("label", { hasText: "A crédito" }).click();
  await p.fill("#vence-pago", en30);
  await p.fill("#total-papel", "14280");
  ok(await p.getByRole("note").filter({ hasText: "Cuadra con la factura." }).count() === 1, "al costear también se cuadra con la factura");
  await p.screenshot({ path: `${OUT}/completar-costos-1440.png`, fullPage: true });
  await p.getByRole("button", { name: "Guardar costos" }).click();
  await p.getByRole("status").filter({ hasText: "Costos guardados" }).waitFor({ timeout: 15000 });
  const cb = await q1(`select estado, total::float t from compras where id = $1`, [CB.id]);
  ok(cb.estado === "registrada" && cb.t === 14280, "el dueño completa los costos: registrada con su total", JSON.stringify(cb));
  ok(await saldo(CB.id) === 14280, "al costear nace la cuenta por pagar");
}

// ───────────── Pagos: parcial (pantalla) y total; efectivo sin turno y con turno
{
  const { p } = D;
  await ir(p, "/cuentas-por-pagar");
  await p.getByRole("button", { name: `Pagar factura ${FACT} de ${PROV}` }).click();
  await p.fill(`#valor-${C1.id}`, "20.000");
  await p.selectOption(`#medio-${C1.id}`, "transferencia");
  await p.fill(`#ref-${C1.id}`, "TRF-1");
  await p.screenshot({ path: `${OUT}/cuentas-por-pagar-1440.png`, fullPage: true });
  await p.getByRole("button", { name: "Confirmar pago" }).click();
  await p.getByRole("status").filter({ hasText: "Pago de $20.000 registrado" }).waitFor({ timeout: 15000 });
  ok(await saldo(C1.id) === 28957.7, "pago parcial: el saldo baja", String(await saldo(C1.id)));
  ok(/\$28\.957,70/.test(await p.locator("main").innerText()), "la pantalla muestra el saldo nuevo sin recargar");
  const total = await api(p, "/api/compras/pagos", "POST", { proveedor_id: C1.proveedor_id, compras: [C1.id], medio: "consignacion", valor: 28957.7, idem_key: crypto.randomUUID() });
  ok(total.status === 201 && await saldo(C1.id) === 0, "pago total: saldo 0", `${total.status} ${await saldo(C1.id)}`);
  const demas = await api(p, "/api/compras/pagos", "POST", { proveedor_id: C1.proveedor_id, compras: [C1.id], medio: "transferencia", valor: 1 });
  ok(demas.status === 422 && /supera/.test(demas.j.error), "no se paga más de lo que se debe", demas.j.error);
  // Efectivo desde la caja: sin turno abierto → error; con turno → egreso del turno
  const e0 = await api(p, "/api/turnos");
  if (e0.j.turno) await api(p, "/api/turnos", "POST", { accion: "cerrar", turno: e0.j.turno.id, contado: 0 });
  const sin = await api(p, "/api/compras/pagos", "POST", { proveedor_id: C1.proveedor_id, compras: [CB.id], medio: "efectivo", valor: 5000 });
  ok(sin.status === 422 && /abre primero el turno/.test(sin.j.error), "pago en efectivo sin turno abierto → error", sin.j.error);
  const ab = await api(p, "/api/turnos", "POST", { accion: "abrir", base: 0 });
  ok(ab.status === 200, "se abre el turno", String(ab.status));
  const con = await api(p, "/api/compras/pagos", "POST", { proveedor_id: C1.proveedor_id, compras: [CB.id], medio: "efectivo", valor: 5000, idem_key: crypto.randomUUID() });
  ok(con.status === 201 && con.j.egreso_caja, "con turno el pago en efectivo sale de la caja", `${con.status} ${con.j.error ?? ""}`);
  const t = await api(p, "/api/turnos");
  ok(Number(t.j.turno?.resumen?.egresos) === 5000 && Number(t.j.turno?.resumen?.efectivo_esperado) === -5000, "el egreso aparece en el resumen del turno", JSON.stringify(t.j.turno?.resumen));
  ok(!!(await q1(`select 1 x from movimientos_caja where turno_id = $1 and tipo = 'egreso' and concepto like $2`, [t.j.turno.id, `Pago a proveedor ${PROV}%`])), "el egreso dice a qué proveedor se pagó");
  await api(p, "/api/turnos", "POST", { accion: "cerrar", turno: t.j.turno.id, contado: 0 });
  ok(await saldo(CB.id) === 9280, "el saldo de la compra baja con el pago en efectivo", String(await saldo(CB.id)));
}

// ───────────── Devolución al proveedor + nota crédito; anular
{
  const { p } = D;
  const lb = await q1(`select cl.id, cl.lote_id from compra_lineas cl where cl.compra_id = $1`, [CB.id]);
  const s0 = await stockLote(lb.lote_id);
  await ir(p, `/compras/${CB.id}`);
  await p.getByRole("button", { name: "Devolver al proveedor" }).click();
  await p.fill(`#devolver-${lb.id}`, "2");
  await p.fill("#motivo-dev", "Empaque roto");
  await p.getByRole("button", { name: "Registrar devolución" }).click();
  await p.getByRole("status").filter({ hasText: "Devolución registrada" }).waitFor({ timeout: 15000 });
  ok(await stockLote(lb.lote_id) === s0 - 2, "la devolución saca las unidades del lote");
  ok(await saldo(CB.id) === 9280, "sin la nota crédito el saldo no cambia");
  const dev = await q1(`select id, valor::float v from devoluciones_proveedor where compra_id = $1`, [CB.id]);
  ok(dev.v === 3570, "la devolución vale lo de la factura (2 × 1.500 + IVA)", String(dev.v));
  const kd = await api(p, `/api/inventario/kardex?producto=${P2.id}&lote=${lb.lote_id}`);
  ok(kd.j.movimientos.some((m) => m.tipo === "ajuste" && /Devolución N\.º \d+ al proveedor/.test(m.documento) && m.salida === 2), "el kardex muestra la devolución al proveedor");
  await p.getByRole("button", { name: "Registrar nota crédito" }).click();
  await p.fill(`#nc-${dev.id}`, `NC-${R}`);
  await p.getByRole("button", { name: "Guardar nota crédito" }).click();
  await p.getByRole("status").filter({ hasText: "Nota crédito registrada" }).waitFor({ timeout: 15000 });
  ok(await saldo(CB.id) === 5710, "con la nota crédito el saldo baja", String(await saldo(CB.id)));
  ok(/Nota crédito NC-/.test(await p.getByRole("list", { name: "Devoluciones de la compra" }).innerText()), "la pantalla muestra la nota crédito sin recargar");
  await p.screenshot({ path: `${OUT}/devolucion-1440.png`, fullPage: true });
  // Anular con pagos: bloqueado
  const bloqueada = await api(p, `/api/compras/${C1.id}`, "DELETE", { motivo: "Prueba con pagos" });
  ok(bloqueada.status === 422 && /pagos/.test(bloqueada.j.error), "no se anula una compra con pagos", bloqueada.j.error);
  // Anular sin pagos desde la pantalla: el stock vuelve y el costo del lote vuelve al de antes
  const s3 = await stockLote(L3);
  await ir(p, `/compras/${C2}`);
  await p.getByRole("button", { name: "Anular compra" }).click();
  await p.fill("#motivo-anular", "Factura registrada por error");
  await p.getByRole("button", { name: "Confirmar anulación", exact: true }).click();
  await p.getByRole("status").filter({ hasText: "Compra anulada" }).waitFor({ timeout: 15000 });
  ok(await stockLote(L3) === s3 - 4, "anular sin pagos revierte el stock", `${s3} → ${await stockLote(L3)}`);
  ok(await costoLote(L3) === 2500, "el costo del lote vuelve al de antes de la compra anulada", String(await costoLote(L3)));
  ok((await q1(`select estado, motivo_anulacion from compras where id = $1`, [C2])).estado === "anulada" && !!(await q1(`select 1 x from auditoria where entidad_id = $1 and accion = 'anular_compra'`, [C2])), "la compra queda anulada y auditada");
  // Acta de recepción
  await ir(p, `/tiquete/recepcion/${C1.id}`);
  const acta = await p.locator("#documento").innerText();
  ok(/Acta de recepción de mercancía/.test(acta) && acta.includes(`C1${R}`) && /Registro INVIMA/.test(acta) && /No conforme/.test(acta) && /Recibe/.test(acta) && acta.includes(FACT), "acta con lote, vencimiento, INVIMA, conforme/no conforme y firma de quien recibe");
  ok(!/\$/.test(acta) && !/obligatori/i.test(acta), "el acta no lleva costos ni afirma ser obligatoria");
  ok(await p.getByRole("button", { name: "Imprimir o guardar PDF" }).count() === 1, "acta con botón de imprimir");
  await p.screenshot({ path: `${OUT}/acta-recepcion-1440.png`, fullPage: true });
  // Proveedores y lista de compras
  await ir(p, "/proveedores");
  ok(new RegExp(PROV).test(await p.getByRole("table", { name: "Proveedores" }).innerText()), "el proveedor nuevo está en la lista");
  await p.screenshot({ path: `${OUT}/proveedores-1440.png`, fullPage: true });
  await Promise.all([p.waitForURL(/\/proveedores\/[0-9a-f-]{36}$/), p.getByRole("link", { name: PROV }).click()]);
  await p.waitForLoadState("networkidle");
  const ficha = await p.locator("main").innerText();
  ok(/\$5\.710/.test(ficha) && /NIT 900123456-/.test(ficha) && /Historial de compras/.test(ficha), "ficha del proveedor con saldo, NIT con DV e historial");
  await p.screenshot({ path: `${OUT}/proveedor-ficha-1440.png`, fullPage: true });
  await ir(p, `/compras?estado=anulada&q=${encodeURIComponent(PROV)}`);
  ok((await p.getByRole("table", { name: "Compras registradas" }).locator("tbody tr").count()) === 1, "la lista filtra por estado y búsqueda");
  await ir(p, "/compras");
  await p.screenshot({ path: `${OUT}/compras-1440.png`, fullPage: true });
  const csv = await p.request.get(`${B}/api/cuentas-por-pagar?formato=csv`);
  const txt = await csv.text();
  ok(csv.ok() && /text\/csv/.test(csv.headers()["content-type"]) && txt.startsWith("﻿") && /Proveedor;NIT;Factura/.test(txt) && txt.includes(`BOD-${R}`) && /5710/.test(txt.replace(/,00/g, "")), "cuentas por pagar en CSV (BOM y punto y coma)");
}

// ───────────── Cajera: 403 en todas las rutas y sin pantallas
{
  const { ctx, p, errs } = await entrar("Laura");
  const pruebas = [["GET", "/api/compras"], ["POST", "/api/compras", { numero_factura: "X" }], ["GET", `/api/compras/${C1.id}`], ["PATCH", `/api/compras/${CB.id}`, { lineas: [] }],
    ["DELETE", `/api/compras/${C1.id}`, { motivo: "nada" }], ["POST", "/api/compras/pagos", { proveedor_id: C1.proveedor_id }], ["DELETE", "/api/compras/pagos", { id: C1.id, motivo: "nada" }],
    ["POST", "/api/compras/devoluciones", { compra_id: C1.id }], ["PATCH", "/api/compras/devoluciones", { id: C1.id }], ["GET", "/api/proveedores"], ["POST", "/api/proveedores", { nombre: "X" }],
    ["PATCH", "/api/proveedores", { id: C1.proveedor_id }], ["GET", "/api/cuentas-por-pagar"], ["GET", "/api/cuentas-por-pagar?formato=csv"]];
  for (const [m, u, c] of pruebas) { const r = await api(p, u, m, c); ok(r.status === 403, `la cajera recibe 403 en ${m} ${u}`, `${r.status} ${r.j.error ?? ""}`); }
  for (const ruta of ["/compras", "/compras/nueva", `/compras/${C1.id}`, "/proveedores", `/proveedores/${C1.proveedor_id}`, "/cuentas-por-pagar", `/tiquete/recepcion/${C1.id}`, "/inventario/recibir"]) {
    await ir(p, ruta);
    ok(!new URL(p.url()).pathname.startsWith(ruta.split("?")[0]) || /\/inicio|\/caja/.test(p.url()), `la cajera no entra a ${ruta}`, p.url());
  }
  ok(sinProvocados(p, errs).length === 0, "sin errores de consola (cajera)", sinProvocados(p, errs).join(" | "));
  await ctx.close();
}

// ───────────── Aislamiento: el dueño de otra droguería no ve ni toca nada de A
{
  const jwt = await new SignJWT({ uid: DUENO_B, empresa: EB.id, nombre: "Dueño Vecina", rol: "dueno", v: 0 }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h")
    .sign(new TextEncoder().encode(process.env.REGENTA_SESSION_SECRET ?? "prueba-local-0123456789abcdef0123456789abcdef"));
  const ctx = await b.newContext();
  await ctx.addCookies([{ name: "regenta_sesion", value: jwt, url: B }]);
  const p = await ctx.newPage(); const errs = vigilar(p);
  await ir(p, "/compras");
  ok(/\/compras$/.test(p.url()) && !(await p.locator("main").innerText()).includes(PROV), "el dueño de B entra a sus compras y no ve las de A", p.url());
  ok((await api(p, `/api/compras/${C1.id}`)).status === 404, "B no lee una compra de A (404)");
  ok((await api(p, "/api/compras")).j.compras.length === 0, "B no lista compras de A");
  ok((await api(p, `/api/proveedores?id=${C1.proveedor_id}`)).status === 404, "B no lee un proveedor de A (404)");
  ok(!(await api(p, "/api/proveedores")).j.proveedores.some((x) => x.id === C1.proveedor_id), "B no lista proveedores de A");
  ok((await api(p, "/api/cuentas-por-pagar")).j.cuentas.length === 0, "B no ve cuentas por pagar de A");
  ok((await api(p, `/api/compras/${CB.id}`, "DELETE", { motivo: "ataque" })).status === 404, "B no anula una compra de A");
  ok((await api(p, `/api/compras/${CB.id}`, "PATCH", { lineas: [{ linea_id: 1, costo: 1, costo_por: "unidad" }] })).status === 404, "B no costea una compra de A");
  const pg2 = await api(p, "/api/compras/pagos", "POST", { proveedor_id: C1.proveedor_id, medio: "transferencia", valor: 1 });
  ok(pg2.status === 422 && /Proveedor no válido/.test(pg2.j.error), "B no paga a un proveedor de A", pg2.j.error);
  const dv = await api(p, "/api/compras/devoluciones", "POST", { compra_id: CB.id, motivo: "ataque", lineas: [{ compra_linea_id: 1, unidades: 1 }] });
  ok(dv.status === 422 && /Compra no válida/.test(dv.j.error), "B no devuelve mercancía de A", dv.j.error);
  const ed = await api(p, "/api/proveedores", "PATCH", { id: C1.proveedor_id, nombre: "Hackeado" });
  ok(ed.status === 404 && (await q1(`select nombre from proveedores where id = $1`, [C1.proveedor_id])).nombre === PROV, "B no edita un proveedor de A");
  // /tiquete tiene loading.tsx (límite de Suspense contra el React 418): notFound() llega por streaming con estado 200, como
  // en el panel. Se comprueba el contenido: página no encontrada y ningún dato de A.
  await p.goto(B + `/tiquete/recepcion/${C1.id}`); await p.waitForLoadState("networkidle");
  const actaAjena = await p.locator("body").innerText();
  ok(/404|no (existe|se encontr)/i.test(actaAjena) && !actaAjena.includes(PROV) && !actaAjena.includes(FACT), "B no abre el acta de A (no encontrada)", actaAjena.slice(0, 80).replace(/\s+/g, " "));
  ok(sinProvocados(p, errs).filter((e) => !/status of 404/.test(e)).length === 0, "sin errores de consola (dueño B)", sinProvocados(p, errs).join(" | "));
  await ctx.close();
}

// ───────────── Celular (iPhone 13): sin desbordes
{
  const { ctx, p, errs } = await entrar("Carlos", { ...devices["iPhone 13"] });
  const pantallas = [["/compras", "compras"], [`/compras/${C1.id}`, "compra-detalle"], [`/compras/${CB.id}`, "compra-devolucion"], ["/proveedores", "proveedores"],
    [`/proveedores/${C1.proveedor_id}`, "proveedor-ficha"], ["/cuentas-por-pagar", "cuentas-por-pagar"], [`/tiquete/recepcion/${C1.id}`, "acta-recepcion"], ["/compras/nueva", "compra-nueva"]];
  for (const [ruta, nombre] of pantallas) {
    await ir(p, ruta);
    if (nombre === "compra-nueva") { await p.fill("#proveedor", PROV); const k = await agregar(p, P1); await p.fill(`#costo-${k}`, "1000"); await p.fill(`#cajas-${k}`, "1"); await p.fill("#total-papel", "999"); }
    const d = await desborde(p);
    ok(d <= 0, `sin desborde horizontal en el celular: ${nombre}`, `${d}px`);
    const c = await cortados(p);
    ok(c.length === 0, `nada se sale de la pantalla en el celular: ${nombre}`, c.join(", "));
    await p.screenshot({ path: `${OUT}/${nombre}-iphone13.png` });
    const alto = await p.evaluate(() => document.documentElement.scrollHeight);
    await p.screenshot({ path: `${OUT}/${nombre}-iphone13-completa.png`, fullPage: true, clip: { x: 0, y: 0, width: 390, height: Math.min(alto, 3200) } });
  }
  // Una compra pequeña de contado y pagada al guardar, desde el celular
  await ir(p, "/compras/nueva");
  await p.fill("#proveedor", PROV); await p.fill("#factura", `CEL-${R}`);
  const k = await agregar(p, P3);
  await p.fill(`#lote-${k}`, `M${R}`); await p.fill(`#vence-${k}`, VENCE); await p.fill(`#sueltas-${k}`, "2"); await p.fill(`#costo-${k}`, "800");
  if (await p.locator(`#costo-por-${k}`).count()) await p.selectOption(`#costo-por-${k}`, "unidad");
  await p.selectOption(`#iva-${k}`, "0");
  await p.getByText("De contado", { exact: true }).click();
  await p.locator("#ya-pague").check();
  await p.selectOption("#medio-pago", "nequi");
  await p.getByRole("button", { name: "Guardar compra" }).click();
  await p.getByRole("status").filter({ hasText: /guardada/ }).waitFor({ timeout: 15000 });
  const cel = await q1(`select id from compras where numero_factura = $1`, [`CEL-${R}`]);
  ok(!!cel && await saldo(cel.id) === 0, "compra de contado pagada al guardar: saldo 0");
  ok(sinProvocados(p, errs).length === 0, "sin errores de consola (celular)", sinProvocados(p, errs).join(" | "));
  await ctx.close();
}
// No responsable de IVA: el IVA de la compra es costo (E.T. art. 488). Mismo total de la factura; sin IVA descontable.
{
  await pool.query(`update empresas set responsable_iva = false where id = $1`, [EMP.id]);
  const r = await D.p.request.post(B + "/api/compras", { headers: { origin: B }, data: { idem_key: crypto.randomUUID(), proveedor_id: (await q1(`select id from proveedores where empresa_id = $1 limit 1`, [EMP.id])).id,
    numero_factura: `NR-${R}`, fecha_factura: hoy, condicion: "credito", vence_pago: en30,
    lineas: [{ producto_id: prods[0].id, lote: `NR${R}`, vence: VENCE, unidades: 10, bonificadas: 0, costo: 1000, costo_por: "unidad", descuento_pct: 0, iva_pct: 19 }] } });
  const j = await r.json();
  const k = await q1(`select c.iva::float, c.total::float, cl.costo_lote::float, cl.iva_pct::float from compras c join compra_lineas cl on cl.compra_id = c.id where c.id = $1`, [j.id]);
  ok(r.status() === 201 && k?.total === 11900 && k.iva === 0 && k.iva_pct === 0 && Math.abs(k.costo_lote - 1190) < 0.01, "no responsable: el IVA de la compra va al costo (total igual, IVA descontable 0)", JSON.stringify(k));
  await pool.query(`update empresas set responsable_iva = true where id = $1`, [EMP.id]);
}
ok(sinProvocados(D.p, D.errs).length === 0, "sin errores de consola (dueño)", sinProvocados(D.p, D.errs).join(" | "));
await D.ctx.close();
await b.close(); await pool.end();
console.log(`\n${fallos} fallos`);
process.exit(fallos ? 1 : 0);
