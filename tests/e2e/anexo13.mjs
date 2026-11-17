// Control especial · informe mensual (Anexo 13), libro completo y fichas: pestañas sin tocar lo existente; el informe
// cuadra (inicial + entradas − salidas = final, saldo final = inventario), incluye en ceros los medicamentos sin
// movimiento, sale en mayúscula con N/A; Excel exige confirmar si hay avisos; impresión; libro completo con saldo que
// termina en la existencia real; la demo no guarda; la cajera no entra; celular sin desbordes; tarea programada sin error.
// Uso: servidor (REGENTA_DEMO=1, REGENTA_CRON_KEY) con la base sembrada → BASE=http://localhost:4503 node tests/e2e/anexo13.mjs
import { esXlsx, filasXlsx } from "../ayudas/xlsx.mjs";
import { esperarCarga } from "../ayudas/carga.mjs";
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
const EMP = "10000000-0000-4000-8000-00000000000a";
const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
const mesPasado = (() => { const [a, m] = hoy.split("-").map(Number); return m === 1 ? `${a - 1}-12` : `${a}-${String(m - 1).padStart(2, "0")}`; })();
const desborde = (p) => p.evaluate(() => document.documentElement.scrollWidth - innerWidth);

async function entrar(quien, opciones = { viewport: { width: 1440, height: 900 } }) {
  const ctx = await b.newContext(opciones);
  const p = await ctx.newPage();
  esperarCarga(p);
  const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
  await p.goto(B + "/entrar"); await p.getByRole("button", { name: new RegExp(quien) }).click(); await p.waitForURL(/\/(caja|inicio)/);
  return { ctx, p, errs };
}

const controlado = (await pool.query(`select id, nombre from productos where empresa_id = $1 and control_especial limit 1`, [EMP])).rows[0];
ok(!!controlado, "la demo trae un medicamento de control especial", controlado?.nombre);
// Un segundo medicamento marcado sin movimientos en el mes: debe salir en ceros.
const quieto = (await pool.query(`select p.id, p.nombre from productos p where p.empresa_id = $1 and not p.control_especial and not p.requiere_formula
  and not exists (select 1 from movimientos m where m.producto_id = p.id) order by p.nombre limit 1`, [EMP])).rows[0];
await pool.query(`update productos set control_especial = true, requiere_formula = true where id = $1`, [quieto.id]);

try {
  // ── 1. Dueño: pestañas en el libro existente, que sigue igual
  {
    const { ctx, p, errs } = await entrar("Carlos");
    await p.goto(B + "/control-especial");
    ok(await p.getByRole("navigation", { name: "Secciones del control especial" }).isVisible(), "el libro existente muestra las pestañas nuevas");
    ok(await p.getByRole("heading", { name: "Saldo por producto" }).isVisible() && await p.getByRole("heading", { name: "Ajustes de la venta con fórmula" }).isVisible(),
      "el libro existente conserva saldos y ajustes");
    ok((await (await p.request.get(B + "/api/control-especial")).json()).saldos?.length >= 1, "la API existente del libro sigue respondiendo");

    // ── 2. Informe del mes pasado (JSON): cuadre por fila, ceros, mayúscula y N/A
    const r = await p.request.get(B + `/api/control-especial/anexo13?mes=${mesPasado}`);
    const j = await r.json();
    ok(r.status() === 200 && j.mes === mesPasado, "API del informe responde para el mes pasado", String(r.status()));
    ok(j.filas.every((f) => f.inicial + f.entradas - f.salidas === f.final), "cada fila: saldo anterior + entradas − salidas = saldo final");
    const fq = j.filas.find((f) => f.id === quieto.id);
    ok(fq && fq.inicial === 0 && fq.entradas === 0 && fq.salidas === 0 && fq.final === 0 && fq.sin_movimiento, "el medicamento sin movimiento sale en ceros");
    const cols = j.tabla.columnas.map((c) => c[1]);
    ok(cols.includes("PRINCIPIO ACTIVO") && cols.includes("SALDO FINAL"), "columnas de la plantilla base en mayúscula", cols.join(" | "));
    const fila = j.tabla.datos[j.filas.findIndex((f) => f.id === quieto.id)];
    ok(fila && fila.cum === "N/A" && fila.saldo_final === 0 && /SIN MOVIMIENTO/.test(fila.observaciones), "texto vacío → N/A, número vacío → 0, observación «sin movimiento»", JSON.stringify(fila));
    ok(j.avisos.some((a) => a.nivel === "detiene" && /Ficha incompleta/.test(a.texto)), "la ficha incompleta detiene la exportación");

    // Saldo final del mes en curso = existencia real del inventario.
    const jh = await (await p.request.get(B + `/api/control-especial/anexo13?mes=${hoy.slice(0, 7)}`)).json();
    const stock = Number((await pool.query(`select coalesce(sum(cantidad), 0)::int u from movimientos where producto_id = $1`, [controlado.id])).rows[0].u);
    ok(jh.filas.find((f) => f.id === controlado.id)?.final === stock, "saldo final del mes en curso = existencia del inventario", `${jh.filas.find((f) => f.id === controlado.id)?.final} vs ${stock}`);
    ok(jh.avisos.some((a) => /mes aún no termina/.test(a.texto)), "el mes en curso avisa que no ha terminado");

    // ── 3. Excel: con avisos exige confirmar; confirmado, dos hojas
    const sin = await p.request.get(B + `/api/control-especial/anexo13?mes=${mesPasado}&formato=excel`);
    ok(sin.status() === 409 && (await sin.json()).avisos?.length > 0, "Excel con avisos sin confirmar → 409 con los avisos");
    const xl = await p.request.get(B + `/api/control-especial/anexo13?mes=${mesPasado}&formato=excel&confirmar=1`);
    ok(xl.status() === 200 && esXlsx(xl.headers()["content-type"], xl.headers()["content-disposition"]), "Excel confirmado (.xlsx)");
    const bytes = await xl.body();
    const h1 = filasXlsx(bytes, 1), h2 = filasXlsx(bytes, 2);
    ok(h1[0]?.includes("PRINCIPIO ACTIVO") && h1.length === j.filas.length + 1, "hoja Anexo 13: encabezado y una fila por medicamento", `${h1.length - 1} filas`);
    const nForm = Number((await pool.query(`select count(*)::int n from venta_formulas f join ventas v on v.id = f.venta_id
      where f.empresa_id = $1 and f.control and to_char(v.creado at time zone 'America/Bogota', 'YYYY-MM') = $2`, [EMP, mesPasado])).rows[0].n);
    ok(h2.length - 1 === nForm, "hoja Recetarios: una fila por fórmula de control del mes", `${h2.length - 1} vs ${nForm}`);

    // ── 4. Pantalla del informe, impresión y registro de envío en la demo
    await p.goto(B + `/control-especial/anexo-13?mes=${mesPasado}`);
    ok(await p.getByRole("heading", { name: "Vista previa" }).isVisible(), "pantalla del informe con vista previa");
    ok(await p.getByRole("heading", { name: "Revisión antes de enviar" }).isVisible(), "muestra la revisión antes de enviar");
    ok(await p.getByRole("button", { name: "Marcar como presentado" }).isDisabled(), "en la demo el registro de envío está deshabilitado");
    await p.screenshot({ path: `${OUT}/anexo13-informe.png`, fullPage: true });
    const pr = await p.request.post(B + "/api/control-especial/anexo13", { data: { mes: mesPasado, presentado: hoy, canal: "correo" } });
    ok(pr.status() === 422 && /demostración/.test((await pr.json()).error), "la API no guarda en la demo (422 con mensaje claro)", String(pr.status()));
    const futuro = await p.request.get(B + "/api/control-especial/anexo13?mes=2999-01");
    ok(futuro.status() === 400, "mes que aún no empieza → 400");
    await p.goto(B + `/control-especial/anexo-13/imprimir?mes=${mesPasado}`);
    ok(await p.getByRole("button", { name: "Imprimir o guardar PDF" }).isVisible() && await p.getByText("Relación de recetarios dispensados").isVisible(), "informe para imprimir con relación de recetarios");
    await p.screenshot({ path: `${OUT}/anexo13-imprimir.png`, fullPage: true });

    // ── 5. Libro completo: el saldo del último asiento = existencia real
    const lj = await (await p.request.get(B + `/api/control-especial/libro?desde=${hoy.slice(0, 8)}01&hasta=${hoy}&producto=${controlado.id}`)).json();
    const ultimo = lj.asientos.at(-1);
    ok(!ultimo || ultimo.saldo === stock, "libro completo: el saldo del último asiento es la existencia", `${ultimo?.saldo} vs ${stock}`);
    const lj2 = await (await p.request.get(B + `/api/control-especial/libro?desde=${hoy.slice(0, 4)}-01-01&hasta=${hoy}&producto=${controlado.id}`)).json();
    ok(lj2.asientos.length > 0 && lj2.asientos.some((a) => a.asiento === "dispensacion" && a.formula_numero), "libro completo con dispensaciones y su recetario");
    ok(lj2.asientos.every((a, i, xs) => i === 0 || a.saldo === xs[i - 1].saldo + a.entrada - a.salida), "saldo corrido sin saltos");
    const lx = await p.request.get(B + `/api/control-especial/libro?desde=${hoy.slice(0, 4)}-01-01&hasta=${hoy}&formato=excel`);
    ok(lx.status() === 200 && esXlsx(lx.headers()["content-type"], lx.headers()["content-disposition"]), "libro completo en Excel");
    await p.goto(B + `/control-especial/libro-completo?desde=${hoy.slice(0, 4)}-01-01&hasta=${hoy}`);
    ok(await p.getByRole("heading", { name: "Entradas, salidas y saldo" }).isVisible(), "pantalla del libro completo");

    // ── 6. Fichas y configuración
    await p.goto(B + "/control-especial/fichas");
    ok(await p.getByRole("heading", { name: "Fichas de los medicamentos" }).isVisible() && await p.getByText(quieto.nombre).first().isVisible(), "fichas con los medicamentos marcados");
    const fput = await p.request.put(B + "/api/control-especial/fichas", { data: { producto_id: quieto.id, principio_activo: "X", cum: "1-2-3" } });
    ok(fput.status() === 400 && /CUM/.test((await fput.json()).error), "CUM inválido rechazado antes de la base");
    const cput = await p.request.put(B + "/api/control-especial/configuracion", { data: { plantilla: [{ campo: "inventado" }] } });
    ok(cput.status() === 400 && /desconocido/.test((await cput.json()).error), "plantilla con campo desconocido rechazada");
    const cfg = await (await p.request.get(B + "/api/control-especial/configuracion")).json();
    ok(cfg.departamento === "Tolima" && cfg.campos?.length >= 20, "configuración de la demo y diccionario de campos");
    ok(errs.length === 0, "sin errores de consola (dueño)", errs.join(" | "));
    await ctx.close();
  }

  // ── 6b. Escrituras en una droguería real (la demo se vuelve real solo durante esta parte): ficha, configuración con
  //        plantilla propia, envío registrado (el aviso del plazo desaparece) y corrección que reemplaza
  {
    const { ctx, p, errs } = await entrar("Carlos"); // la entrada rápida solo existe en la demo: primero se entra
    await pool.query(`update empresas set demo = false where id = $1`, [EMP]);
    try {
      await p.goto(B + "/control-especial");
      const avisoAntes = await p.getByText(/al Fondo Rotatorio/).first().isVisible().catch(() => false);
      await p.goto(B + "/control-especial/fichas");
      const form = p.getByRole("form", { name: `Ficha de ${quieto.nombre}` });
      await form.getByLabel("Principio activo (DCI)").fill("Codeína");
      await form.getByLabel("Concentración").fill("30 mg");
      await form.getByLabel("Forma farmacéutica").fill("Tableta");
      await form.getByLabel("CUM").fill("00000000-02");
      await form.getByRole("button", { name: "Guardar ficha" }).click();
      await form.getByRole("status").waitFor({ timeout: 8000 }).catch(() => {});
      const fi = (await pool.query(`select principio_activo, cum from control_fichas where producto_id = $1`, [quieto.id])).rows[0];
      ok(fi?.principio_activo === "Codeína" && fi?.cum === "00000000-02", "la ficha se guarda desde la pantalla", JSON.stringify(fi));
      const cp = await p.request.put(B + "/api/control-especial/configuracion", { data: { departamento: "Tolima", fondo: "Fondo Rotatorio de Estupefacientes del Tolima", canal: "correo",
        plantilla: [{ campo: "medicamento", titulo: "Nombre comercial" }, { campo: "cum", titulo: "Código CUM" }, { campo: "saldo_final", titulo: "Existencia final" }] } });
      ok(cp.status() === 200, "configuración con plantilla propia guardada", String(cp.status()));
      const jt = await (await p.request.get(B + `/api/control-especial/anexo13?mes=${mesPasado}`)).json();
      ok(jt.tabla.columnas.map((c) => c[1]).join("|") === "NOMBRE COMERCIAL|CÓDIGO CUM|EXISTENCIA FINAL", "el informe sale con las columnas de la plantilla propia");
      const pr1 = await p.request.post(B + "/api/control-especial/anexo13", { data: { mes: mesPasado, presentado: hoy, canal: "correo", radicado: "E2E-1" } });
      const pr2 = await p.request.post(B + "/api/control-especial/anexo13", { data: { mes: mesPasado, presentado: hoy, canal: "plataforma", radicado: "E2E-2" } });
      const regs = (await pool.query(`select radicado, reemplaza, totales from control_informes where empresa_id = $1 order by id`, [EMP])).rows;
      ok(pr1.status() === 200 && pr2.status() === 200 && regs.length === 2 && regs[1].reemplaza != null, "envío registrado y su corrección reemplaza al anterior");
      ok(regs[0].totales?.productos === jt.totales.productos && regs[0].totales?.final === jt.totales.final, "se guardan los totales calculados por el servidor");
      await p.goto(B + "/control-especial");
      const avisoDespues = await p.getByText(/al Fondo Rotatorio/).first().isVisible().catch(() => false);
      ok(avisoAntes && !avisoDespues, "el recordatorio del plazo desaparece al registrar el envío", `${avisoAntes} → ${avisoDespues}`);
      await p.goto(B + `/control-especial/anexo-13?mes=${mesPasado}`);
      ok(await p.getByText(/Presentado el .* radicado E2E-2/).isVisible() && await p.getByText("reemplazado").isVisible(), "la pantalla muestra el envío vigente y el historial");
      ok(errs.length === 0, "sin errores de consola (escrituras)", errs.join(" | "));
    } finally {
      await ctx.close();
      await pool.query(`update empresas set demo = true where id = $1`, [EMP]);
      await pool.query(`delete from control_fichas where producto_id = $1`, [quieto.id]);
      await pool.query(`update control_config set plantilla = null where empresa_id = $1`, [EMP]);
      await pool.query(`alter table control_informes disable trigger control_informes_inmutables`);
      await pool.query(`delete from control_informes where empresa_id = $1 and reemplaza is not null`, [EMP]);
      await pool.query(`delete from control_informes where empresa_id = $1`, [EMP]);
      await pool.query(`alter table control_informes enable trigger control_informes_inmutables`);
    }
  }

  // ── 7. La cajera no entra
  {
    const { ctx, p, errs } = await entrar("Laura");
    for (const u of ["/api/control-especial/anexo13", "/api/control-especial/libro", "/api/control-especial/fichas", "/api/control-especial/configuracion"])
      ok((await p.request.get(B + u)).status() === 403, `cajera → 403 en ${u}`);
    await p.goto(B + "/control-especial/anexo-13");
    await p.waitForURL((u) => !u.pathname.startsWith("/control-especial"), { timeout: 10000 }).catch(() => {}); // la redirección puede llegar en el streaming
    ok(!p.url().includes("/control-especial") && !(await p.getByText("Vista previa").isVisible().catch(() => false)), "la cajera no entra a la pantalla del informe", p.url());
    ok(errs.length === 0, "sin errores de consola (cajera)", errs.join(" | "));
    await ctx.close();
  }

  // ── 8. Celular sin desbordes
  {
    const { ctx, p, errs } = await entrar("Carlos", { ...devices["iPhone 13"] });
    for (const u of ["/control-especial", `/control-especial/anexo-13?mes=${mesPasado}`, "/control-especial/libro-completo", "/control-especial/fichas"]) {
      await p.goto(B + u);
      ok(await desborde(p) <= 0, `sin desbordes a 390 px: ${u}`, String(await desborde(p)));
    }
    await p.screenshot({ path: `${OUT}/anexo13-fichas-celular.png`, fullPage: true });
    ok(errs.length === 0, "sin errores de consola (celular)", errs.join(" | "));
    await ctx.close();
  }

  // ── 9. Tarea programada: el paso del recordatorio corre sin error
  {
    const r = await fetch(B + "/api/tareas?operacion=1", { method: "POST", headers: { authorization: `Bearer ${process.env.REGENTA_CRON_KEY ?? "cron-prueba-0123456789abcdef0123456789"}` } });
    const j = await r.json().catch(() => ({}));
    ok(r.status === 200 && j.anexo13 && !j.anexo13.error, "tarea programada: paso anexo13 sin error", JSON.stringify(j.anexo13));
  }
} finally {
  await pool.query(`update productos set control_especial = false, requiere_formula = false where id = $1`, [quieto.id]);
  await b.close(); await pool.end();
}
console.log(fallos ? `\n${fallos} fallo(s)` : "\nTodo en verde");
process.exit(fallos ? 1 : 0);
