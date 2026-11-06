// Control especial y venta con fórmula: el dueño marca el producto; la caja no cobra sin los datos de la fórmula (ni por
// la pantalla ni llamando a la API); con datos, la venta queda en el libro con su lote; la venta con fórmula sin control
// pide confirmar; la anulación aparece como reintegro; CSV e informe; permisos; sin internet se bloquea; celular sin
// desbordes; capturas.
// Uso: servidor (REGENTA_DEMO=1) con la base sembrada → BASE=http://localhost:4503 node tests/e2e/control-especial.mjs
import { chromium, devices } from "playwright-core";
import { mkdirSync } from "node:fs";
import pg from "pg";

const B = process.env.BASE ?? "http://localhost:4500";
const OUT = process.env.OUT ?? "test-results";
mkdirSync(OUT, { recursive: true });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/regenta?host=/tmp" });
const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium" });
{ const nc = b.newContext.bind(b); b.newContext = async (o) => { const c = await nc({ locale: "es-CO", timezoneId: "America/Bogota", ...o }); await c.addInitScript(() => { try { sessionStorage.setItem("regenta_demo_v1", JSON.stringify({ hechos: [], ofertas: ["prueba", "prueba"], cerrada: true, inicio: Date.now() })); } catch {} }); return c; }; }
let fallos = 0;
const ok = (c, m, x = "") => { console.log(`${c ? "PASS" : "FAIL"} ${m}${x ? " — " + x : ""}`); if (!c) fallos++; };
const hace = (n) => new Date(Date.now() - n * 864e5).toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
const EMP = "10000000-0000-4000-8000-00000000000a";
const CONTROL = "winadeine tabletas 325/8"; // se marca en la prueba (la demo trae marcado otro Winadeine)
const FORMULA = "amoxicilina tableta 875"; // la demo lo trae como «venta con fórmula»
const PACIENTE = `Paciente E2E ${Date.now().toString().slice(-6)}`;

async function entrar(quien, opciones = { viewport: { width: 1440, height: 900 } }) {
  const ctx = await b.newContext(opciones);
  const p = await ctx.newPage();
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
  await p.goto(B + "/entrar"); await p.getByRole("button", { name: new RegExp(quien) }).click(); await p.waitForURL(/\/(caja|inicio)/);
  return { ctx, p, errs };
}
async function agregar(p, texto) {
  await p.locator("#buscar").fill(texto);
  await p.waitForSelector('[aria-label="Resultados"] [role="option"]');
  await p.locator("#buscar").press("Enter");
  await p.locator("#formula").waitFor({ timeout: 5000 }).catch(() => {});
}
const desborde = (p) => p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
const api = (p, cuerpo) => p.request.post(B + "/api/ventas", { data: cuerpo }).then(async (r) => ({ s: r.status(), j: await r.json().catch(() => ({})) }));

// Punto de partida conocido: el producto de la prueba sin marcas.
await pool.query(`update productos set control_especial = false, requiere_formula = false where empresa_id = $1 and nombre ilike 'Winadeine tabletas 325/8%'`, [EMP]);
const prodControl = (await pool.query(`select id, precio_caja::int from productos where empresa_id = $1 and nombre ilike 'Winadeine tabletas 325/8%'`, [EMP])).rows[0];
const prodFormula = (await pool.query(`select id, precio_caja::int, precio_unidad::int, requiere_formula, control_especial from productos where empresa_id = $1 and nombre ilike 'Amoxicilina tableta 875%'`, [EMP])).rows[0];
ok(prodControl && prodFormula?.requiere_formula && !prodFormula.control_especial, "la demo trae un producto «con fórmula» y otro para marcar");

// ── 1. El dueño marca el producto como control especial desde la ficha
{
  const { ctx, p, errs } = await entrar("Carlos");
  await p.goto(B + `/productos/${prodControl.id}`); await p.waitForLoadState("networkidle");
  await p.getByText("Medicamento de control especial").click();
  ok(await p.locator("#requiere_formula").isChecked() && await p.locator("#requiere_formula").isDisabled(), "control especial marca (y fija) la venta con fórmula");
  await p.getByRole("button", { name: "Guardar cambios" }).click(); await p.waitForURL(/\/productos$/);
  const m = (await pool.query(`select control_especial, requiere_formula from productos where id = $1`, [prodControl.id])).rows[0];
  ok(m.control_especial && m.requiere_formula, "queda marcado en la base");
  const a = (await pool.query(`select count(*)::int n from auditoria where entidad_id = $1 and accion = 'cambio_formula' and usuario_id is not null`, [prodControl.id])).rows[0].n;
  ok(a >= 1, "el cambio de marca queda en la auditoría con el usuario");
  await p.goto(B + "/productos?q=winadeine"); await p.waitForLoadState("networkidle");
  ok(await p.getByText("Control especial").first().isVisible(), "el listado de productos muestra la marca");
  ok(await p.getByRole("link", { name: "Libro de control especial" }).isVisible(), "Productos enlaza el libro de control especial");
  ok(errs.length === 0, "sin errores de consola (dueño, ficha)", errs.join(" | "));
  await ctx.close();
}

// ── 2. Cajera: sin datos no cobra (pantalla y API); con datos sí, y queda en el libro
let ventaControl;
{
  const { ctx, p, errs } = await entrar("Laura");
  await p.waitForLoadState("networkidle");
  await agregar(p, CONTROL);
  const aside = p.locator('aside[aria-label="Venta actual"]');
  ok(await p.locator("#formula").isVisible(), "al agregar un producto de control especial aparece el panel de la fórmula");
  ok(await aside.getByText("Control especial").first().isVisible(), "la tirilla marca el producto como control especial");
  ok(await aside.getByRole("button", { name: /Cobrar/ }).isDisabled(), "sin los datos de la fórmula no se puede cobrar");
  await p.keyboard.press("F9");
  const foco = await p.evaluate(() => document.activeElement?.id ?? "");
  ok(/^f-/.test(foco), "F9 lleva al primer dato que falta de la fórmula", foco);
  ok(await p.locator("#recibido").count() === 0, "F9 no abre el cobro con la fórmula incompleta");

  // API directa: el servidor no confía en el navegador
  const base = { tipo_doc: "pos", lineas: [{ producto_id: prodControl.id, presentacion: "caja", cantidad: 1 }], pagos: [{ medio: "efectivo", valor: 200000 }] };
  const completa = { verificada: true, paciente_tipo_doc: "CC", paciente_doc: "1.098.765.432", paciente_nombre: PACIENTE, medico_nombre: "Jorge Restrepo Gómez", medico_registro: "RM 73-1458", formula_numero: "F-E2E-1", formula_fecha: hace(3) };
  const sin = await api(p, { ...base, idem_key: crypto.randomUUID() });
  ok(sin.s === 400 && /paciente/i.test(sin.j.error), "API sin fórmula → 400", `${sin.s} ${sin.j.error}`);
  const solo = await api(p, { ...base, idem_key: crypto.randomUUID(), formula: { verificada: true } });
  ok(solo.s === 400, "API con solo «verificada» en control especial → 400", `${solo.s} ${solo.j.error}`);
  const vieja = await api(p, { ...base, idem_key: crypto.randomUUID(), formula: { ...completa, formula_fecha: hace(45) } });
  ok(vieja.s === 400 && /vigente/.test(vieja.j.error) && /configurado por tu droguería/.test(vieja.j.error), "API con fórmula de 45 días → 400 (no vigente)", vieja.j.error);
  const futura = await api(p, { ...base, idem_key: crypto.randomUUID(), formula: { ...completa, formula_fecha: hace(-2) } });
  ok(futura.s === 400 && /posterior a hoy/.test(futura.j.error), "API con fecha futura → 400", futura.j.error);
  const nada = (await pool.query(`select count(*)::int n from venta_formulas f join ventas v on v.id = f.venta_id where v.creado > now() - interval '5 minutes' and f.paciente_nombre = $1`, [PACIENTE])).rows[0].n;
  ok(nada === 0, "ningún intento bloqueado dejó venta ni registro");

  // Pantalla: completar y cobrar con el teclado
  await p.locator("#f-doc").fill("1.098.765.432");
  await p.locator("#f-paciente").fill(PACIENTE);
  await p.locator("#f-medico").fill("Jorge Restrepo Gómez");
  await p.locator("#f-registro").fill("rm 73-1458");
  await p.locator("#f-numero").fill("f-e2e-2");
  await p.locator("#f-fecha").fill(hace(45));
  ok(/no está vigente/.test(await p.locator("#formula").innerText()), "la caja avisa que la fórmula de 45 días no está vigente");
  ok(await aside.getByRole("button", { name: /Cobrar/ }).isDisabled(), "y no deja cobrar");
  await p.locator("#f-fecha").fill(hace(3));
  ok(await p.getByText("Fórmula completa").isVisible(), "con todos los datos la fórmula queda completa");
  await p.locator("#formula").scrollIntoViewIfNeeded();
  await p.screenshot({ path: `${OUT}/control-caja-1440.png` });
  await p.locator("#buscar").focus();
  await p.keyboard.press("F9"); await p.waitForSelector("#recibido"); await p.fill("#recibido", "200000");
  await p.keyboard.press("Enter");
  await p.getByText(/Nueva venta/).waitFor();
  ok(await p.getByText(/la dispensación quedó en el libro/).isVisible(), "tras cobrar, la caja confirma el registro en el libro");
  ventaControl = (await pool.query(`select v.id, v.prefijo || v.numero numero, f.paciente_doc, f.medico_registro, f.formula_numero from venta_formulas f join ventas v on v.id = f.venta_id where f.paciente_nombre = $1`, [PACIENTE])).rows[0];
  ok(ventaControl?.paciente_doc === "1098765432" && ventaControl.medico_registro === "RM 73-1458" && ventaControl.formula_numero === "F-E2E-2", "la fórmula queda guardada (documento sin puntos, en mayúsculas)", JSON.stringify(ventaControl));
  const libro = (await pool.query(`select l.tipo, l.salida, lo.lote, l.prefijo || l.numero venta from v_libro_control l join lotes lo on lo.id = l.lote_id where l.venta_id = $1`, [ventaControl?.id])).rows;
  ok(libro.length >= 1 && libro.every((x) => x.tipo === "dispensacion" && x.lote && x.venta === ventaControl.numero) && libro.reduce((a, x) => a + x.salida, 0) === 10,
    "el libro tiene la dispensación con lote, venta y 10 unidades (1 caja)", JSON.stringify(libro));

  // ── 3. Venta con fórmula (sin control): aviso y confirmación
  await p.keyboard.press("Enter"); // nueva venta
  await agregar(p, FORMULA);
  ok(await p.getByText("Requiere fórmula médica").first().isVisible(), "un producto «con fórmula» muestra el aviso «requiere fórmula médica»");
  ok(await p.locator("#f-doc").count() === 0, "sin control especial no pide los datos del paciente (configuración por defecto)");
  ok(await aside.getByRole("button", { name: /Cobrar/ }).isDisabled(), "sin confirmar la verificación no se cobra");
  const sinConf = await api(p, { idem_key: crypto.randomUUID(), tipo_doc: "pos", lineas: [{ producto_id: prodFormula.id, presentacion: "unidad", cantidad: 1 }], pagos: [{ medio: "efectivo", valor: 100000 }] });
  ok(sinConf.s === 400 && /verificaste/.test(sinConf.j.error), "API sin confirmar la fórmula → 400", `${sinConf.s} ${sinConf.j.error}`);
  await p.keyboard.press("F9");
  ok(await p.evaluate(() => document.activeElement?.id) === "f-verificada", "F9 lleva a la confirmación");
  await p.keyboard.press("Space");
  ok(await p.getByText("Fórmula verificada.").isVisible(), "la confirmación queda marcada");
  await p.locator("#buscar").focus();
  await p.keyboard.press("F9"); await p.waitForSelector("#recibido"); await p.fill("#recibido", "200000");
  await p.keyboard.press("Enter"); await p.getByText(/Nueva venta/).waitFor();
  const vf = (await pool.query(`select f.control, f.verificada, f.paciente_doc, v.id from venta_formulas f join ventas v on v.id = f.venta_id where f.producto_id = $1 order by f.id desc limit 1`, [prodFormula.id])).rows[0];
  ok(vf && vf.control === false && vf.verificada === true && vf.paciente_doc === null, "la venta con fórmula guarda la confirmación (no entra al libro de control)");
  await p.keyboard.press("Enter");

  // ── 4. Permisos: la cajera vende pero no ve el libro
  const r403 = await p.request.get(B + "/api/control-especial");
  ok(r403.status() === 403, "API del libro para la cajera → 403", String(r403.status()));
  const csv403 = await p.request.get(B + "/api/control-especial?formato=csv");
  ok(csv403.status() === 403, "CSV del libro para la cajera → 403");
  await p.goto(B + "/control-especial"); await p.waitForLoadState("networkidle");
  ok(!p.url().includes("/control-especial"), "la cajera no entra a la pantalla del libro", p.url());
  ok(errs.length === 0, "sin errores de consola (cajera)", errs.join(" | "));
  if (vf) { const c2 = await entrar("Carlos"); await c2.p.request.delete(B + `/api/ventas/${vf.id}`, { data: { motivo: "Prueba automática" } }); await c2.ctx.close(); } // devuelve las unidades
  await ctx.close();
}

// ── 5. Dueño: anula la venta (reintegro), ve el libro, exporta CSV e informe
{
  const { ctx, p, errs } = await entrar("Carlos");
  await p.goto(B + `/ventas/${ventaControl.id}`); await p.waitForLoadState("networkidle");
  ok(await p.getByText(PACIENTE).isVisible(), "el detalle de la venta muestra la fórmula al dueño");
  await p.getByRole("button", { name: /Anular/ }).click();
  await p.fill("#motivo", "Error de digitación E2E");
  await p.getByRole("button", { name: "Confirmar anulación" }).click();
  await p.getByText(/Venta anulada/).waitFor();
  const l = (await pool.query(`select tipo, sum(salida)::int salida, sum(reintegro)::int reintegro, max(motivo) motivo from v_libro_control where venta_id = $1 group by tipo order by tipo`, [ventaControl.id])).rows;
  ok(l.length === 2 && l[0].salida === 10 && l[1].tipo === "reintegro" && l[1].reintegro === 10 && /Error de digitación E2E/.test(l[1].motivo), "la anulación queda como reintegro y la dispensación no se borra", JSON.stringify(l));

  await p.goto(B + "/control-especial"); await p.waitForLoadState("networkidle");
  ok(await p.getByRole("heading", { name: "Libro de control especial" }).isVisible(), "el dueño ve el libro");
  const tabla = p.locator('section[aria-labelledby="libro-titulo"]');
  ok(await tabla.getByText(PACIENTE).count() >= 2, "el libro lista la dispensación y el reintegro del paciente");
  ok(await tabla.getByText(ventaControl.numero).count() >= 2, "con el número de la venta");
  ok(await p.getByText("Saldo por producto").isVisible(), "muestra el saldo por producto para cuadrar");
  ok(await p.getByText(/Gloria Inés Martínez/).count() === 0, "el periodo por defecto es el mes en curso");
  await p.goto(B + `/control-especial?desde=${hace(29)}&hasta=${hace(0)}`); await p.waitForLoadState("networkidle");
  ok(await p.getByText(/Gloria Inés Martínez/).count() > 0, "con 30 días aparecen también las dispensaciones de la demo");
  await p.screenshot({ path: `${OUT}/control-libro-1440.png`, fullPage: true });
  const csv = await p.request.get(B + "/api/control-especial?formato=csv");
  const texto = await csv.text();
  ok(csv.status() === 200 && /text\/csv/.test(csv.headers()["content-type"]) && /attachment/.test(csv.headers()["content-disposition"]), "exporta CSV para Excel");
  ok(texto.includes(PACIENTE) && texto.includes("Reintegro") && texto.includes("Dispensación") && texto.includes(ventaControl.numero), "el CSV trae paciente, venta, dispensación y reintegro");
  ok(texto.split("\r\n")[0].includes("Registro profesional") && texto.split("\r\n")[0].includes("Lote"), "con columnas de lote y registro profesional");
  const saldos = await (await p.request.get(B + "/api/control-especial?formato=csv&tipo=saldos")).text();
  ok(/Saldo inicial;Entradas;Salidas;Saldo final/.test(saldos), "exporta los saldos");
  const j = await (await p.request.get(B + `/api/control-especial?producto=${prodControl.id}`)).json();
  const s = j.saldos?.[0];
  ok(s && s.inicial + s.entradas - s.salidas === s.final, "el saldo cuadra: inicial + entradas − salidas = final", JSON.stringify(s));
  const inf = await ctx.newPage();
  await inf.goto(B + "/control-especial/informe"); await inf.waitForLoadState("networkidle");
  ok(await inf.getByRole("heading", { name: "Libro de control especial" }).isVisible() && await inf.getByText(PACIENTE).count() >= 2, "el informe imprimible lista el libro");
  ok(await inf.getByRole("button", { name: /Imprimir/ }).isVisible(), "con botón de imprimir o guardar PDF");
  await inf.screenshot({ path: `${OUT}/control-informe-1440.png`, fullPage: true });
  // Ajustes: en la demo no se guardan (mensaje claro, sin error interno)
  await p.locator("#vigencia").fill("20"); await p.getByRole("button", { name: "Guardar ajustes" }).click();
  const aviso = p.getByRole("alert").filter({ hasText: /demostración/ });
  await aviso.waitFor({ timeout: 5000 }).catch(() => {});
  ok(await aviso.isVisible(), "en la demo los ajustes no se guardan y lo dice");
  ok(errs.filter((e) => !/status of 422/.test(e)).length === 0, "sin errores de consola (dueño)", errs.join(" | "));
  await ctx.close();
}

// ── 6. Sin internet: los productos que exigen registrar la fórmula se bloquean
{
  const { ctx, p, errs } = await entrar("Laura");
  await p.waitForFunction(() => { try { return (JSON.parse(localStorage.getItem("regenta.catalogo") ?? "null")?.v ?? 0) >= 2; } /* 2 = marcas de fórmula; 3 (036) = además códigos alternos */ catch { return false; } }, null, { timeout: 20000 });
  await p.waitForLoadState("networkidle");
  await agregar(p, CONTROL);
  await ctx.setOffline(true);
  await p.getByText(/Sin internet no se puede registrar esta fórmula/).waitFor({ timeout: 5000 }).catch(() => {});
  ok(await p.getByText(/Sin internet no se puede registrar esta fórmula/).isVisible(), "sin internet el panel avisa que no se puede vender");
  ok(await p.locator('aside[aria-label="Venta actual"]').getByRole("button", { name: /Cobrar/ }).isDisabled(), "y la caja no cobra ese producto");
  const local = await p.evaluate(() => JSON.parse(localStorage.getItem("regenta.catalogo")).productos.find((x) => x.control_especial));
  ok(!!local, "el catálogo guardado conoce las marcas para trabajar sin internet");
  await ctx.setOffline(false);
  ok(errs.length === 0, "sin errores de consola (sin internet)", errs.join(" | "));
  await ctx.close();
}

// ── 7. Celular (iPhone 13): panel de la caja y libro sin desbordes
{
  const { ctx, p, errs } = await entrar("Laura", { ...devices["iPhone 13"] });
  await p.waitForLoadState("networkidle");
  await agregar(p, CONTROL);
  await p.getByRole("button", { name: "Completar fórmula" }).click();
  await p.waitForTimeout(500);
  ok(/^f-/.test(await p.evaluate(() => document.activeElement?.id ?? "")), "en el celular «Completar fórmula» lleva al panel");
  await p.locator("#f-doc").fill("52345678"); await p.locator("#f-paciente").fill("Gloria Inés Martínez");
  ok(await desborde(p) <= 0, "caja con el panel sin desbordes a 390 px", String(await desborde(p)));
  await p.locator("#formula").screenshot({ path: `${OUT}/control-caja-iphone13-panel.png` });
  await p.screenshot({ path: `${OUT}/control-caja-iphone13.png` });
  ok(errs.length === 0, "sin errores de consola (celular, cajera)", errs.join(" | "));
  await ctx.close();
  const d = await entrar("Carlos", { ...devices["iPhone 13"] });
  await d.p.goto(B + "/control-especial"); await d.p.waitForLoadState("networkidle");
  ok(await desborde(d.p) <= 0, "libro sin desbordes a 390 px", String(await desborde(d.p)));
  await d.p.screenshot({ path: `${OUT}/control-libro-iphone13.png`, fullPage: true });
  ok(d.errs.length === 0, "sin errores de consola (celular, dueño)", d.errs.join(" | "));
  await d.ctx.close();
}

await b.close(); await pool.end();
console.log(`\n${fallos} fallos`);
process.exit(fallos ? 1 : 0);
