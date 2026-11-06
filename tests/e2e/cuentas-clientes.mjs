// Clientes con cuenta (fiado controlado) y cartera por cliente: cupo de $200.000 → la cajera fía ~$150.000; otra venta de
// ~$80.000 se bloquea por cupo (4xx en la API y mensaje claro en la caja); el dueño la autoriza con motivo y queda en la
// auditoría; un recibo de $170.000 se reparte entre 2 facturas (la que vence antes primero); con 2 cajas activas el abono
// en efectivo de la caja 2 entra solo a su turno; anular el recibo restituye saldos; la mora mayor al límite bloquea el
// fiado; el estado de cuenta cuadra con v_cartera; la cajera sin turno no recibe abonos; aislamiento entre empresas;
// celular sin desbordes y sin errores de consola. Capturas de escritorio (1440) e iPhone 13.
// Uso: servidor con la base sembrada → BASE=http://localhost:4513 DATABASE_URL=… node tests/e2e/cuentas-clientes.mjs
import { chromium, devices } from "playwright-core";
import { mkdirSync } from "node:fs";
import pg from "pg";

const B = process.env.BASE ?? "http://localhost:4500";
const OUT = process.env.OUT ?? "test-results/cuentas-clientes";
mkdirSync(OUT, { recursive: true });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/regenta?host=/tmp" });
let fallos = 0;
const ok = (c, m, x = "") => { console.log(`${c ? "PASS" : "FAIL"} ${m}${x ? " — " + x : ""}`); if (!c) fallos++; };
const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium" });
{ const nc = b.newContext.bind(b); b.newContext = async (o) => { const c = await nc(o); await c.addInitScript(() => { try { sessionStorage.setItem("regenta_demo_v1", JSON.stringify({ hechos: [], ofertas: ["prueba", "prueba"], cerrada: true, inicio: Date.now() })); } catch {} }); return c; }; }

const vigilar = (p) => { const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => m.type() === "error" && errs.push(m.text())); return errs; };
async function entrar(quien, opciones = { viewport: { width: 1440, height: 900 } }, caja = null) {
  const ctx = await b.newContext(opciones);
  if (caja) await ctx.addCookies([{ name: "regenta_caja", value: caja, url: B }]);
  const p = await ctx.newPage();
  const errs = vigilar(p);
  await p.goto(B + "/entrar"); await p.getByRole("button", { name: new RegExp(quien) }).click(); await p.waitForURL(/\/(caja|inicio)/);
  return { ctx, p, errs };
}
const ir = async (p, ruta) => { await p.goto(B + ruta); await p.waitForLoadState("networkidle"); };
const api = async (p, url, metodo = "GET", cuerpo) => {
  const r = await p.evaluate(async ([u, m, c]) => {
    const r = await fetch(u, { method: m, headers: c === undefined ? {} : { "content-type": "application/json" }, body: c === undefined ? undefined : JSON.stringify(c) });
    const t = await r.text(); let j = {}; try { j = JSON.parse(t); } catch { j = { texto: t }; }
    return { status: r.status, j };
  }, [url, metodo, cuerpo]);
  if (r.status >= 400) p.__provocados = (p.__provocados ?? 0) + 1;
  return r;
};
const sinProvocados = (p, errs) => { let n = p.__provocados ?? 0; return errs.filter((e) => !(n > 0 && /Failed to load resource: the server responded with a status of 4\d\d/.test(e) && n--)); };
const q1 = async (sql, params = []) => (await pool.query(sql, params)).rows[0];
/** Consulta como un usuario de la app (RLS y auth.uid() como en el servidor). */
async function comoBD(uid, sql, params = []) {
  const c = await pool.connect();
  try {
    await c.query("begin"); await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })]); await c.query("set local role authenticated");
    const r = (await c.query(sql, params)).rows; await c.query("commit"); return r;
  } catch (e) { await c.query("rollback").catch(() => {}); throw e; } finally { c.release(); }
}
const desborde = (p) => p.evaluate(() => Math.max(document.documentElement.scrollWidth, innerWidth) - screen.width);
const cortados = (p) => p.evaluate(() => [...document.querySelectorAll("main *")].filter((el) => {
  const r = el.getBoundingClientRect();
  if (r.width === 0 || r.right <= screen.width + 1) return false;
  for (let a = el.parentElement; a; a = a.parentElement) if (/(auto|scroll)/.test(getComputedStyle(a).overflowX)) return false;
  return true;
}).slice(0, 3).map((el) => `${el.tagName.toLowerCase()}.${String(el.className).slice(0, 40)} (${Math.round(el.getBoundingClientRect().right)}px)`));
const $ = (n) => "$" + Math.round(n).toLocaleString("es-CO");

const U = { carlos: "00000000-0000-4000-8000-000000000001", laura: "00000000-0000-4000-8000-000000000002" };
const EMP = await q1(`select id, (select id from sedes where empresa_id = e.id order by creado limit 1) sede from empresas e where e.demo limit 1`);
const C1 = (await q1(`select id from cajas where empresa_id = $1 and activa order by nombre, id limit 1`, [EMP.id])).id;
// Producto con margen: se vende por unidad, sin fórmula, con existencias vigentes para ~$230.000 o más.
const P = await q1(`select p.id, p.nombre, p.precio_unidad::float pu from productos p
  where p.empresa_id = $1 and p.activo and p.precio_unidad between 300 and 3000 and not p.requiere_formula
    and (select coalesce(sum(s.unidades), 0) from v_stock_vigente s where s.producto_id = p.id) * p.precio_unidad >= 400000
  order by p.precio_unidad desc limit 1`, [EMP.id]);
ok(!!P, "hay un producto con existencias para la prueba", P ? `${P.nombre} ${$(P.pu)}` : "");
const n150 = Math.floor(150000 / P.pu), n80 = Math.ceil(80000 / P.pu);
const fiado = (cliente, cantidad, extra = {}) => ({ idem_key: crypto.randomUUID(), tipo_doc: "factura", cliente_id: cliente, condicion: "credito", pagos: [],
  lineas: [{ producto_id: P.id, presentacion: "unidad", cantidad }], ...extra });

// Caja 2 de prueba (la demo trae una) y limpieza de corridas anteriores: turnos abiertos de las dos cajas.
const C2 = (await q1(`insert into cajas (empresa_id, sede_id, nombre) values ($1, $2, $3) returning id`, [EMP.id, EMP.sede, `Caja E2E ${Date.now().toString().slice(-6)}`])).id;
const sufijo = Date.now().toString().slice(-7);

// ───────────── Dueño: cliente nuevo y su cupo desde la ficha
const D = await entrar("Carlos", { viewport: { width: 1440, height: 900 } }, C1);
let cli;
{
  const { p } = D;
  for (const t of (await pool.query(`select id from turnos where caja_id = $1 and estado = 'abierto'`, [C1])).rows)
    await api(p, "/api/turnos", "POST", { accion: "cerrar", turno: t.id, contado: 0 });
  const r = await api(p, "/api/clientes", "POST", { tipo_doc: "CC", numero_doc: `77${sufijo}`, nombre: `Cliente Cupo E2E ${sufijo}`, email: `cupo${sufijo}@prueba.example`, telefono: "3001234567", autoriza_datos: true });
  cli = r.j.cliente?.id;
  ok(r.status === 201 && !!cli, "el dueño crea el cliente", String(r.status));
  await ir(p, `/clientes?q=${sufijo}`);
  await Promise.all([p.waitForURL(new RegExp(`/clientes/${cli}`)), p.getByRole("link", { name: `Cliente Cupo E2E ${sufijo}` }).click()]);
  await p.waitForLoadState("networkidle");
  await p.getByRole("heading", { name: `Cliente Cupo E2E ${sufijo}` }).waitFor();
  ok(await p.getByText("Sin cupo: la cajera no le fía").count() === 1, "la ficha muestra que sin cupo no se fía");
  await p.getByRole("button", { name: "Con cupo" }).click();
  await p.locator("#cr-cupo").fill("200000");
  await p.locator("#cr-plazo").selectOption("30");
  await p.locator("#cr-notas").fill("Paga los viernes");
  await p.getByRole("button", { name: "Guardar crédito" }).click();
  await p.getByText("Crédito del cliente guardado").waitFor();
  ok(await p.getByText(/Disponible \$200\.000 de \$200\.000/).count() === 1, "la ficha aplica el cupo que confirma el servidor");
  const au = await q1(`select datos from auditoria where accion = 'credito_cliente' and entidad_id = $1 order by id desc limit 1`, [cli]);
  ok(Number(au?.datos?.despues?.cupo) === 200000 && au?.datos?.antes?.cupo === null, "el cambio de cupo queda en la auditoría con antes y después");
}

// ───────────── Cajera: fía dentro del cupo; pasarse se bloquea
const L = await entrar("Laura", { viewport: { width: 1440, height: 900 } }, C1);
let f1, f2;
{
  const { p } = L;
  await ir(p, "/caja");
  await p.getByRole("button", { name: "Factura electrónica", exact: true }).click();
  await p.locator("#cf-buscar").fill(`Cupo E2E ${sufijo}`);
  await p.getByRole("button", { name: new RegExp(`Cliente Cupo E2E ${sufijo}`) }).click();
  await p.getByText(/Cupo disponible/).waitFor();
  ok(await p.getByText(/Cupo disponible \$200\.000 de \$200\.000/).count() === 1, "la caja muestra el cupo disponible del cliente");
  const r1 = await api(p, "/api/ventas", "POST", fiado(cli, n150, { plazo_dias: 15 }));
  f1 = r1.j.venta;
  ok(r1.status === 200 && f1?.credito === true && f1.autorizado === false, "la cajera fía ~$150.000 dentro del cupo", `${r1.status} ${$(f1?.total ?? 0)} ${r1.j.error ?? ""}`);
  const r2 = await api(p, "/api/ventas", "POST", fiado(cli, n80));
  ok(r2.status === 422 && /supera el cupo disponible/.test(r2.j.error) && /solo el dueño o el administrador/.test(r2.j.error), "otros ~$80.000: la API lo rechaza por cupo (422) con mensaje claro", `${r2.status} ${r2.j.error}`);
  const cr = await api(p, `/api/clientes/${cli}/credito?valor=${Math.round(n80 * P.pu)}`);
  ok(cr.status === 200 && cr.j.puede_fiar === false && cr.j.requiere_motivo === false && /supera el cupo/.test(cr.j.motivo) && Math.round(cr.j.cupo_disponible) === 200000 - Math.round(Number(f1.total)),
    "contrato de la caja: {puede_fiar, cupo_disponible, motivo}", JSON.stringify(cr.j).slice(0, 160));
  ok((await api(p, `/api/clientes/${cli}/credito`, "PATCH", { cupo_credito: 9e9, plazo_dias_defecto: 30, credito_bloqueado: false })).status === 403, "la cajera no cambia el cupo (403)");
  ok((await api(p, "/api/cartera?formato=csv")).status === 403, "la cajera no descarga la cartera (403)");
}

// ───────────── Dueño: autoriza pasarse del cupo con motivo (auditoría) y la caja lo explica
{
  const { p } = D;
  const sin = await api(p, "/api/ventas", "POST", fiado(cli, n80));
  ok(sin.status === 422 && /escribe el motivo/.test(sin.j.error), "el dueño sin motivo tampoco pasa del cupo", sin.j.error);
  const con = await api(p, "/api/ventas", "POST", fiado(cli, n80, { motivo_credito: "Cliente de años, paga el viernes" }));
  f2 = con.j.venta;
  ok(con.status === 200 && f2?.autorizado === true, "con motivo, el dueño autoriza la venta sobre el cupo", `${con.status} ${con.j.error ?? ""}`);
  const au = await q1(`select datos, usuario_id from auditoria where accion = 'credito_autorizado' and entidad_id = $1`, [f2?.venta_id]);
  ok(au?.datos?.motivo === "Cliente de años, paga el viernes" && au.usuario_id === U.carlos && /supera el cupo/.test(au.datos.razon), "la autorización queda en la auditoría (quién, motivo y razón)");
  // En la caja: con el cupo agotado, fiar sale con un mensaje claro.
  await ir(p, "/caja");
  await p.getByRole("button", { name: "Factura electrónica", exact: true }).click();
  await p.locator("#cf-buscar").fill(`Cupo E2E ${sufijo}`);
  await p.getByRole("button", { name: new RegExp(`Cliente Cupo E2E ${sufijo}`) }).click();
  await p.getByText(/No se le puede fiar/).waitFor();
  ok(await p.getByText(/No se le puede fiar: Cupo agotado.*Puedes autorizarlo con un motivo/).count() === 1, "la caja avisa al dueño que el cupo está agotado");
  await p.locator("#buscar").fill(P.nombre.split(" ").slice(0, 2).join(" "));
  await p.waitForSelector('[aria-label="Resultados"] [role="option"]');
  await p.locator('[aria-label="Resultados"] [role="option"]', { hasText: P.nombre }).first().getByRole("button").first().click();
  await p.keyboard.press("F9");
  await p.getByRole("button", { name: "Crédito", exact: true }).click();
  await p.locator("#motivo-credito").waitFor();
  ok(await p.getByLabel("Motivo de la autorización").count() === 1, "a crédito sobre el cupo, la caja pide el motivo en la pantalla");
  await p.getByRole("button", { name: /Facturar a crédito/ }).click();
  const alerta = p.getByRole("alert").filter({ hasText: "Escribe el motivo de la autorización" });
  await alerta.waitFor({ timeout: 10000 }).catch(() => {});
  ok(await alerta.count() === 1, "sin motivo no se factura: la caja lo pide (sin llamar a la API)");
  await p.screenshot({ path: `${OUT}/caja-cupo-1440.png` });
}

// ───────────── Cajera en la caja 2: sin turno no recibe; con turno, el recibo de $170.000 reparte y entra a SU turno
const L2 = await entrar("Laura", { viewport: { width: 1440, height: 900 } }, C2);
let rc;
{
  const { p } = L2;
  const sinTurno = await api(p, "/api/recibos", "POST", { cliente_id: cli, medio: "efectivo", valor: 170000 });
  ok(sinTurno.status === 422 && /Abre el turno/.test(sinTurno.j.error), "la cajera sin turno no recibe abonos", `${sinTurno.status} ${sinTurno.j.error}`);
  await ir(p, "/turno");
  await p.getByRole("heading", { name: /Abrir turno/ }).waitFor();
  ok(await p.getByRole("button", { name: "Recibir abono" }).count() === 0, "sin turno, Turno no ofrece recibir abonos a la cajera");
  const t2 = await api(p, "/api/turnos", "POST", { accion: "abrir", base: 0 });
  const t1 = await api(D.p, "/api/turnos", "POST", { accion: "abrir", base: 0 });
  ok(t2.status === 200 && t1.status === 200, "turnos abiertos en las dos cajas", `${t2.status} ${t1.status}`);
  await ir(p, "/turno");
  await p.getByRole("button", { name: "Recibir abono" }).click();
  await p.locator("#ra-buscar").fill(`Cupo E2E ${sufijo}`);
  await p.getByRole("button", { name: new RegExp(`Cliente Cupo E2E ${sufijo}`) }).click();
  const deuda = Number(f1.total) + Number(f2.total);
  ok(await p.getByText(`Debe ${$(deuda)}`, { exact: false }).count() >= 1 || await p.locator("form[aria-label='Pago del cliente']").getByText($(deuda)).count() === 1, "muestra el saldo del cliente", $(deuda));
  await p.locator("#ra-valor").fill("170000");
  await p.locator("#ra-medio").selectOption("efectivo");
  await p.screenshot({ path: `${OUT}/turno-recibir-1440.png` });
  await p.getByRole("button", { name: /^Recibir \$170\.000 e imprimir recibo/ }).click();
  await p.getByRole("heading", { name: /Recibo de caja RC-\d+/ }).waitFor();
  rc = await q1(`select id, numero, aplicado, turno_id, caja_id from recibos_caja where cliente_id = $1 order by id desc limit 1`, [cli]);
  const ap = rc?.aplicado ?? [];
  ok(ap.length === 2 && ap[0].venta_id === f1.venta_id && Number(ap[0].valor) === Number(f1.total) && ap[1].venta_id === f2.venta_id && Number(ap[1].valor) === 170000 - Number(f1.total),
    "el recibo de $170.000 paga primero la factura que vence antes y el resto va a la otra", JSON.stringify(ap.map((a) => [a.factura, a.valor])));
  ok(rc?.turno_id === t2.j.turno && rc?.caja_id === C2, "el recibo queda en la caja 2 y en su turno");
  ok(await p.getByText(`Queda debiendo ${$(deuda - 170000)}.`).count() === 1, "la pantalla confirma lo que queda debiendo");
  const r2 = (await api(p, "/api/turnos")).j.turno.resumen, r1 = (await api(D.p, "/api/turnos")).j.turno.resumen;
  ok(Number(r2.abonos_efectivo) === 170000 && Number(r2.efectivo_esperado) === 170000, "el efectivo del abono entra al turno de la caja 2", JSON.stringify({ a: r2.abonos_efectivo, e: r2.efectivo_esperado }));
  ok(Number(r1.abonos_efectivo) === 0, "y no se duplica en el turno de la caja 1", String(r1.abonos_efectivo));
  await ir(p, "/turno");
  ok(await p.getByText("Abonos en efectivo").count() === 1, "Turno muestra los abonos en efectivo del turno");
  // Tirilla del recibo (80 mm)
  const t = await p.context().newPage();
  await t.goto(`${B}/tiquete/recibo/${rc.id}`); await t.waitForLoadState("networkidle");
  ok(await t.getByText(`RECIBO DE CAJA RC-${rc.numero}`).count() === 1 && await t.getByText(`Factura ${f1.prefijo}${f1.numero}`).count() === 1, "la tirilla del recibo muestra número y facturas");
  await t.screenshot({ path: `${OUT}/recibo-tirilla.png`, fullPage: true });
  await t.close();
}

// ───────────── Dueño: estado de cuenta cuadra con v_cartera; anular el recibo restituye
{
  const { p } = D;
  const saldoVista = async () => Number((await comoBD(U.carlos, `select coalesce(sum(saldo), 0)::float s from v_cartera where cliente_id = $1`, [cli]))[0].s);
  await ir(p, `/clientes/${cli}`);
  const ficha = Number(await p.locator("tfoot [data-saldo]").getAttribute("data-saldo"));
  ok(ficha === await saldoVista() && ficha === Number(f1.total) + Number(f2.total) - 170000, "el estado de cuenta cuadra con v_cartera", `${ficha}`);
  ok((await p.getByRole("link", { name: "Enviar por WhatsApp" }).getAttribute("href")).startsWith("https://wa.me/573001234567?text="), "WhatsApp con el celular del cliente y el estado en el texto");
  await p.screenshot({ path: `${OUT}/ficha-1440.png`, fullPage: true });
  const ec = await p.context().newPage();
  await ec.goto(`${B}/tiquete/estado-cuenta/${cli}`); await ec.waitForLoadState("networkidle");
  ok(await ec.getByText("ESTADO DE CUENTA", { exact: true }).count() === 1 && await ec.title() === "Estado de cuenta · Regenta" && await ec.getByText(`Saldo${$(ficha)}`).count() + await ec.locator(".fila.fuerte", { hasText: $(ficha) }).count() >= 1, "estado de cuenta imprimible con el saldo");
  await ec.screenshot({ path: `${OUT}/estado-cuenta-tirilla.png`, fullPage: true });
  await ec.close();
  const tAntes = Number((await api(L2.p, "/api/turnos")).j.turno.resumen.efectivo_esperado);
  await p.getByRole("button", { name: `Anular el recibo RC-${rc.numero}` }).click();
  await p.getByRole("textbox", { name: "Motivo de la anulación" }).fill("Se registró en el cliente equivocado");
  await Promise.all([p.waitForURL(/anulado=/), p.getByRole("button", { name: "Anular recibo" }).click()]);
  await p.waitForLoadState("networkidle");
  ok(await p.getByText(`Recibo RC-${rc.numero} anulado`).count() === 1, "la ficha confirma la anulación");
  ok(await saldoVista() === Number(f1.total) + Number(f2.total), "anular el recibo restituye los saldos");
  const tDesp = Number((await api(L2.p, "/api/turnos")).j.turno.resumen.efectivo_esperado);
  ok(tAntes - tDesp === 170000, "y el efectivo esperado del turno baja lo anulado", `${tAntes} → ${tDesp}`);
  ok(Number(await p.locator("tfoot [data-saldo]").getAttribute("data-saldo")) === await saldoVista(), "tras anular, el estado de cuenta sigue cuadrando");
  ok((await api(L.p, `/api/recibos/${rc.id}`, "DELETE", { motivo: "prueba cajera" })).status === 403, "la cajera no anula recibos (403)");

  // Cartera por cliente: edades, filtro con enlace normal y CSV
  await ir(p, "/cartera?ver=clientes");
  ok(await p.locator("tr", { hasText: `Cliente Cupo E2E ${sufijo}` }).count() === 1, "la cartera agrupada por cliente lo muestra");
  await Promise.all([p.waitForURL(/edad=e0/), p.locator('a[href*="edad=e0"]').first().click()]);
  await p.waitForLoadState("networkidle");
  ok(await p.locator("tr", { hasText: `Cliente Cupo E2E ${sufijo}` }).count() === 1 && await p.getByText(/Filtrado por 0–30 días/).count() === 1, "filtro por edad 0–30 (enlace normal)");
  await Promise.all([p.waitForURL(/edad=e91/), p.locator('a[href*="edad=e91"]').first().click()]);
  await p.waitForLoadState("networkidle");
  ok(await p.locator("tr", { hasText: `Cliente Cupo E2E ${sufijo}` }).count() === 0, "en más de 90 días no aparece");
  await p.screenshot({ path: `${OUT}/cartera-clientes-1440.png`, fullPage: true });
  const csv = await p.evaluate(async () => { const r = await fetch("/api/cartera?formato=csv"); const by = new Uint8Array(await r.arrayBuffer()); return { s: r.status, bom: [...by.slice(0, 3)].join(","), t: new TextDecoder().decode(by), ct: r.headers.get("content-type") }; });
  ok(csv.s === 200 && csv.bom === "239,187,191" && csv.t.includes("Cliente;Documento;Teléfono;Facturas;Saldo;0-30 días") && csv.t.includes(`Cliente Cupo E2E ${sufijo}`), "CSV de la cartera por cliente (BOM y ;)");
  const mora = await api(p, "/api/cartera", "PATCH", { dias_mora_bloqueo: 10 });
  ok(mora.status === 422 && /demostración/.test(mora.j.error), "en la demo el límite de mora no se cambia (como las demás opciones generales)");
}

// ───────────── Mora mayor al límite bloquea el fiado
{
  await api(D.p, `/api/clientes/${cli}/credito`, "PATCH", { cupo_credito: 10000000, plazo_dias_defecto: 30, credito_bloqueado: false, notas: "Paga los viernes" });
  const c = await pool.connect();
  try {
    await c.query("begin");
    await c.query("alter table ventas disable trigger ventas_inmutables");
    await c.query("update ventas set vence_pago = current_date - 20 where id = $1", [f1.venta_id]);
    await c.query("alter table ventas enable trigger ventas_inmutables");
    await c.query("update empresas set dias_mora_bloqueo = 10 where id = $1", [EMP.id]);
    await c.query("commit");
  } finally { c.release(); }
  try {
    const cr = await api(L.p, `/api/clientes/${cli}/credito?valor=1000`);
    ok(cr.j.puede_fiar === false && /Mora de 20 días/.test(cr.j.motivo), "con mora de 20 días y límite de 10, no se le fía", cr.j.motivo);
    const v = await api(L.p, "/api/ventas", "POST", fiado(cli, 1));
    ok(v.status === 422 && /Mora de 20 días/.test(v.j.error), "la cajera no puede fiarle (422)", v.j.error);
    await ir(L.p, "/caja");
    await L.p.getByRole("button", { name: "Factura electrónica", exact: true }).click();
    await L.p.locator("#cf-buscar").fill(`Cupo E2E ${sufijo}`);
    await L.p.getByRole("button", { name: new RegExp(`Cliente Cupo E2E ${sufijo}`) }).click();
    await L.p.getByText(/No se le puede fiar/).waitFor();
    ok(await L.p.getByText(/No se le puede fiar: Mora de 20 días: pasa el límite de 10 días/).count() === 1, "la caja muestra la mora como motivo");
  } finally { await pool.query(`update empresas set dias_mora_bloqueo = null where id = $1`, [EMP.id]); }
}

// ───────────── Crédito en la caja, por la pantalla: la cajera fía dentro del cupo; bloqueado → motivo y sin «Crédito»;
// el dueño se pasa del cupo escribiendo el motivo (queda en la auditoría). Cliente propio para no tocar los saldos de arriba.
{
  const r = await api(D.p, "/api/clientes", "POST", { tipo_doc: "CC", numero_doc: `78${sufijo}`, nombre: `Cliente Caja E2E ${sufijo}`, email: `caja${sufijo}@prueba.example`, autoriza_datos: true });
  const cli2 = r.j.cliente?.id;
  ok(r.status === 201 && !!cli2, "cliente para fiar desde la caja", String(r.status));
  const credito = (d) => api(D.p, `/api/clientes/${cli2}/credito`, "PATCH", { plazo_dias_defecto: 30, notas: null, ...d });
  ok((await credito({ cupo_credito: 5000000, credito_bloqueado: false })).status === 200, "cupo de $5.000.000");
  const elegir = async (p) => {
    await ir(p, "/caja");
    await p.getByRole("button", { name: "Factura electrónica", exact: true }).click();
    await p.locator("#cf-buscar").fill(`Caja E2E ${sufijo}`);
    await p.getByRole("button", { name: new RegExp(`Cliente Caja E2E ${sufijo}`) }).click();
  };
  const agregarP = async (p) => {
    await p.locator("#buscar").fill(P.nombre.split(" ").slice(0, 2).join(" "));
    await p.waitForSelector('[aria-label="Resultados"] [role="option"]');
    // Por unidad (el último botón): tras las ventas de arriba puede no quedar una caja completa y la línea no se cobraría.
    await p.locator('[aria-label="Resultados"] [role="option"]', { hasText: P.nombre }).first().getByRole("button").last().click();
  };
  // Cajera: dentro del cupo ve «Crédito» y factura a crédito.
  const LC = await entrar("Laura", { viewport: { width: 1440, height: 900 } }, C1);
  await elegir(LC.p);
  await LC.p.getByText(/Cupo disponible \$5\.000\.000/).waitFor();
  await agregarP(LC.p);
  await LC.p.getByRole("button", { name: "Crédito", exact: true }).waitFor();
  await LC.p.getByRole("button", { name: "Crédito", exact: true }).click();
  ok(await LC.p.locator("#motivo-credito").count() === 0, "dentro del cupo la cajera no necesita motivo");
  await LC.p.keyboard.press("F9");
  await LC.p.screenshot({ path: `${OUT}/caja-credito-cajera-1440.png` });
  await LC.p.getByRole("button", { name: /Facturar a crédito/ }).click();
  await LC.p.waitForSelector("text=Factura electrónica registrada", { timeout: 15000 });
  ok(await LC.p.getByText(/A crédito · vence el/).count() === 1, "la cajera fía por la pantalla dentro del cupo");
  const v1 = await q1(`select v.id, v.condicion, v.usuario_id::text u, v.plazo_dias from ventas v where v.cliente_id = $1 order by v.creado desc limit 1`, [cli2]);
  ok(v1?.condicion === "credito" && v1.u === U.laura && v1.plazo_dias === 30, "la venta queda a crédito, a nombre de la cajera y con el plazo del cliente", JSON.stringify(v1));
  ok(!(await q1(`select 1 x from auditoria where accion = 'credito_autorizado' and entidad_id = $1`, [v1?.id]))?.x, "sin autorización (no hacía falta)");
  // Bloqueado: la cajera ve el motivo y no le aparece «Crédito».
  ok((await credito({ cupo_credito: 5000000, credito_bloqueado: true })).status === 200, "el dueño bloquea el crédito del cliente");
  await elegir(LC.p);
  await LC.p.getByText(/No se le puede fiar/).waitFor();
  ok(await LC.p.getByText("No se le puede fiar: El crédito de este cliente está bloqueado.").count() === 1, "cliente bloqueado: la cajera ve el motivo en español");
  await agregarP(LC.p);
  ok(await LC.p.getByRole("button", { name: "Crédito", exact: true }).count() === 0, "y no le aparece «Crédito»");
  await LC.p.screenshot({ path: `${OUT}/caja-bloqueado-cajera-1440.png` });
  ok(sinProvocados(LC.p, LC.errs).length === 0, "sin errores de consola (cajera, crédito en la caja)", LC.errs.join(" | "));
  await LC.ctx.close();
  // Dueño: cupo de $1.000 (ya lo pasó): escribe el motivo en la pantalla y factura.
  ok((await credito({ cupo_credito: 1000, credito_bloqueado: false })).status === 200, "cupo de $1.000");
  const DC = await entrar("Carlos", { viewport: { width: 1440, height: 900 } }, C1);
  await elegir(DC.p);
  await DC.p.getByText(/No se le puede fiar/).waitFor();
  await agregarP(DC.p);
  await DC.p.getByRole("button", { name: "Crédito", exact: true }).click();
  await DC.p.locator("#motivo-credito").fill("Cliente conocido, paga el lunes");
  await DC.p.keyboard.press("F9");
  await DC.p.screenshot({ path: `${OUT}/caja-motivo-duenio-1440.png` });
  await DC.p.getByRole("button", { name: /Facturar a crédito/ }).click();
  await DC.p.waitForSelector("text=Factura electrónica registrada", { timeout: 15000 });
  const v2 = await q1(`select id from ventas where cliente_id = $1 order by creado desc limit 1`, [cli2]);
  const au = await q1(`select datos, usuario_id from auditoria where accion = 'credito_autorizado' and entidad_id = $1`, [v2?.id]);
  ok(v2?.id !== v1?.id && au?.datos?.motivo === "Cliente conocido, paga el lunes" && au.usuario_id === U.carlos && /supera el cupo/.test(au.datos.razon),
    "el dueño se pasa del cupo escribiendo el motivo y queda en la auditoría", JSON.stringify(au?.datos ?? {}).slice(0, 160));
  ok(sinProvocados(DC.p, DC.errs).length === 0, "sin errores de consola (dueño, motivo en la caja)", DC.errs.join(" | "));
  await DC.ctx.close();
}

// ───────────── Aislamiento y permisos
{
  const ajeno = (await q1(`insert into clientes (empresa_id, tipo_doc, numero_doc, nombre) select id, 'CC', $1, 'Cliente de otra droguería' from empresas where not demo limit 1 returning id`, [`66${sufijo}`]))?.id;
  if (ajeno) {
    ok((await api(D.p, `/api/clientes/${ajeno}/credito`)).status === 404, "el crédito de un cliente de otra droguería no se ve (404)");
    ok((await api(D.p, "/api/recibos", "POST", { cliente_id: ajeno, medio: "efectivo", valor: 1000 })).status === 404, "no se reciben pagos de clientes de otra droguería (404)");
    ok((await api(D.p, `/api/clientes/${ajeno}/credito`, "PATCH", { cupo_credito: 1000, plazo_dias_defecto: null, credito_bloqueado: false })).status === 404, "ni se les cambia el cupo (404)");
    // Con loading.tsx la página llega por streaming (200): se comprueba que muestra «no encontrada» y nada del cliente.
    await D.p.goto(`${B}/clientes/${ajeno}`); await D.p.waitForLoadState("networkidle");
    const texto = await D.p.locator("body").innerText();
    ok(!texto.includes("Cliente de otra droguería") && /no (existe|se encontr)|404/i.test(texto), "la ficha de un cliente ajeno no se muestra (no encontrada)", texto.slice(0, 80).replace(/\s+/g, " "));
  } else ok(false, "hay otra droguería para probar el aislamiento");
  const A = await entrar("Andrés");
  ok((await api(A.p, `/api/clientes/${cli}/credito`)).status === 403 && (await api(A.p, "/api/recibos?q=a")).status === 403, "bodega no ve créditos ni recibe pagos (403)");
  ok(sinProvocados(A.p, A.errs).length === 0, "sin errores de consola (bodega)", A.errs.join(" | "));
  await A.ctx.close();
}

// ───────────── Celular (iPhone 13): ficha, cartera por cliente, turno con «Recibir abono» y caja con el cliente
{
  const M = await entrar("Carlos", { ...devices["iPhone 13"] }, C1);
  for (const [ruta, nombre] of [[`/clientes/${cli}`, "ficha"], ["/cartera?ver=clientes", "cartera-clientes"], ["/clientes", "clientes"], ["/turno", "turno"]]) {
    await ir(M.p, ruta);
    if (nombre === "turno") await M.p.getByRole("button", { name: "Recibir abono" }).click().catch(() => {});
    const d = await desborde(M.p), cc = await cortados(M.p);
    ok(d <= 0 && cc.length === 0, `celular sin desbordes: ${nombre}`, `${d}px ${cc.join(", ")}`);
    await M.p.screenshot({ path: `${OUT}/${nombre}-iphone13.png`, fullPage: true });
  }
  ok(sinProvocados(M.p, M.errs).length === 0, "sin errores de consola (celular)", M.errs.join(" | "));
  await M.ctx.close();
}

// Cierre: turnos de la prueba cerrados y la caja 2 desactivada (las demás suites esperan una sola caja).
for (const ctx of [L2, D]) {
  const t = (await api(ctx.p, "/api/turnos")).j.turno;
  if (t) await api(ctx.p, "/api/turnos", "POST", { accion: "cerrar", turno: t.id, contado: Number(t.resumen.efectivo_esperado) });
}
await pool.query(`update cajas set activa = false where id = $1`, [C2]);
for (const [n, x] of [["dueño", D], ["cajera", L], ["cajera caja 2", L2]]) ok(sinProvocados(x.p, x.errs).length === 0, `sin errores de consola (${n})`, x.errs.join(" | "));
await b.close(); await pool.end();
console.log(`\n${fallos} fallos`);
process.exit(fallos ? 1 : 0);
