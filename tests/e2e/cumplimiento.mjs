// Cumplimiento (frente B): Documentos electrónicos (POS, factura, notas crédito de anulación y de devolución con su estado
// DIAN, filtros, búsqueda, reenvío de un rechazado, CSV) y planilla de temperatura y humedad (registro, fuera de rango con
// acción obligatoria, corrección sin borrar, rangos configurables, informe mensual, CSV). Permisos de la cajera y la bodega,
// sin errores de consola y sin desbordes en el celular. Capturas en OUT (escritorio 1440 e iPhone 13).
// Uso: servidor con la base sembrada → BASE=http://localhost:4502 DATABASE_URL=… node tests/e2e/cumplimiento.mjs
import { chromium, devices } from "playwright-core";
import { mkdirSync } from "node:fs";
import pg from "pg";

const B = process.env.BASE ?? "http://localhost:4500";
const OUT = process.env.OUT ?? "test-results/cumplimiento";
mkdirSync(OUT, { recursive: true });
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/regenta?host=/tmp" });
let fallos = 0;
const ok = (c, m, x = "") => { console.log(`${c ? "PASS" : "FAIL"} ${m}${x ? " — " + x : ""}`); if (!c) fallos++; };
const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium" });
// Las pruebas funcionales entran a la demo sin las ofertas del embudo (las prueba embudo.mjs).
{ const nc = b.newContext.bind(b); b.newContext = async (o) => { const c = await nc(o); await c.addInitScript(() => { try { sessionStorage.setItem("regenta_demo_v1", JSON.stringify({ hechos: [], ofertas: ["prueba", "prueba"], cerrada: true, inicio: Date.now() })); } catch {} }); return c; }; }

async function entrar(quien, opts = { viewport: { width: 1440, height: 900 } }) {
  const ctx = await b.newContext(opts); const p = await ctx.newPage(); const errs = [];
  p.on("pageerror", (e) => errs.push(e.message));
  // Los 4xx provocados a propósito (permisos, duplicados) no son errores de la página.
  p.on("console", (m) => m.type() === "error" && !/status of 4(03|22)/.test(m.text()) && errs.push(m.text()));
  await p.goto(B + "/entrar"); await p.getByRole("button", { name: new RegExp(quien) }).click(); await p.waitForURL(/\/(caja|inicio)/);
  return { ctx, p, errs };
}
const api = (p, url, metodo, cuerpo) => p.evaluate(async ([u, m, c]) => { const r = await fetch(u, { method: m, headers: { "content-type": "application/json" }, body: c === undefined ? undefined : JSON.stringify(c) }); return { status: r.status, j: await r.json().catch(() => ({})) }; }, [url, metodo, cuerpo]);
const sobra = (p) => p.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
const mes = hoy.slice(0, 7);
const emp = (await pool.query(`select id from empresas where demo limit 1`)).rows[0].id;

// La planilla de la demo empieza vacía en cada corrida (solo en esta base local: los registros son inmutables para la app).
await pool.query("begin");
await pool.query("alter table temperatura_registros disable trigger user");
await pool.query("delete from temperatura_registros where empresa_id = $1", [emp]);
await pool.query("alter table temperatura_registros enable trigger user");
await pool.query("delete from temperatura_rangos where empresa_id = $1", [emp]);
await pool.query("commit");

// ───────────────────────── Documentos electrónicos ─────────────────────────
const docDe = async (venta, nc = false) => (await pool.query(`select prefijo || numero n, estado, simulado from documentos_dian where venta_id = $1 and (tipo = 'nota_credito') = $2 order by creado desc limit 1`, [venta, nc])).rows[0];
{
  const { ctx, p, errs } = await entrar("Carlos");
  const prod = (await pool.query(`select s.producto_id id from v_stock_vigente s join productos p on p.id = s.producto_id where s.empresa_id = $1 and p.precio_unidad is not null and p.activo
    group by 1 having sum(s.unidades) >= 30 order by sum(s.unidades) desc limit 1`, [emp])).rows[0].id;
  const cliente = (await pool.query(`select id from clientes where empresa_id = $1 and email is not null and nombre ilike '%salud vital%' limit 1`, [emp])).rows[0].id;
  const vender = async (extra = {}) => {
    const r = await api(p, "/api/ventas", "POST", { idem_key: crypto.randomUUID(), tipo_doc: "pos", lineas: [{ producto_id: prod, presentacion: "unidad", cantidad: 2 }], pagos: [{ medio: "efectivo", valor: 200000 }], ...extra });
    return r.j.venta?.venta_id;
  };
  const vPos = await vender();
  const vFac = await vender({ tipo_doc: "factura", cliente_id: cliente });
  const vAnul = await vender();
  const vDev = await vender();
  ok(vPos && vFac && vAnul && vDev, "se hacen en la demo una venta POS, una factura y dos ventas más");
  const anula = await api(p, `/api/ventas/${vAnul}`, "DELETE", { motivo: "Prueba de anulación" });
  const dev = await api(p, `/api/ventas/${vDev}/devolucion`, "POST", { motivo: "Prueba de devolución", lineas: [{ producto_id: prod, presentacion: "unidad", cantidad: 1 }] });
  ok(anula.status === 200 && dev.status === 200, "anulación y devolución registradas", `${anula.status} ${dev.status}`);
  const D = { pos: await docDe(vPos), fac: await docDe(vFac), ncA: await docDe(vAnul, true), ncD: await docDe(vDev, true) };
  ok(D.pos && D.fac && D.ncA && D.ncD, "cada operación tiene su documento DIAN", Object.values(D).map((d) => d?.n).join(", "));
  // Rechazo forzado (en la base local) para probar el reenvío.
  await pool.query(`update documentos_dian set estado = 'rechazado', ultimo_error = 'Rechazo DIAN 99: el correo del adquirente no es válido (prueba)' where venta_id = $1 and tipo = 'factura'`, [vFac]);

  await p.goto(B + `/documentos?desde=${hoy}&hasta=${hoy}`); await p.waitForLoadState("networkidle");
  ok(await p.getByRole("heading", { name: "Documentos electrónicos", level: 1 }).waitFor({ timeout: 10000 }).then(() => true, () => false), "el dueño entra a Documentos electrónicos");
  const fila = (n) => p.locator(`tr[data-doc="${n}"]`);
  const texto = async (n) => (await fila(n).count()) ? (await fila(n).innerText()).replace(/\s+/g, " ") : "";
  const t = { pos: await texto(D.pos.n), fac: await texto(D.fac.n), ncA: await texto(D.ncA.n), ncD: await texto(D.ncD.n) };
  ok(/Tiquete POS/.test(t.pos) && /Simulado/.test(t.pos), "el tiquete POS aparece con su estado (simulado en la demo)", t.pos.slice(0, 120));
  ok(/Factura/.test(t.fac) && /Rechazado/.test(t.fac) && /correo del adquirente/.test(t.fac) && /Salud Vital/.test(t.fac), "la factura rechazada muestra estado, motivo legible y cliente", t.fac.slice(0, 200));
  ok(/Nota crédito · anulación/.test(t.ncA), "la nota crédito de anulación aparece", t.ncA.slice(0, 120));
  ok(/Nota crédito · devolución/.test(t.ncD) && /−\$/.test(t.ncD), "la nota crédito de devolución aparece con su valor negativo", t.ncD.slice(0, 120));
  ok(await fila(D.pos.n).getByRole("link", { name: "Ver venta" }).getAttribute("href") === `/ventas/${vPos}`, "enlace a la venta");
  ok(await fila(D.pos.n).getByRole("link", { name: "Comprobante" }).getAttribute("href") === `/tiquete/${vPos}`, "enlace al comprobante");
  await fila(D.pos.n).locator("summary", { hasText: "CUDE" }).click();
  ok(/emisión simulada/i.test(await fila(D.pos.n).innerText()), "muestra el CUDE y aclara que la emisión es simulada");

  // Contadores = base
  const cuenta = (await pool.query(`select count(*) filter (where d.estado = 'aceptado' and not d.simulado)::int a, count(*) filter (where d.estado = 'aceptado' and d.simulado)::int s, count(*) filter (where d.estado in ('pendiente','enviando'))::int p, count(*) filter (where d.estado = 'rechazado')::int r
    from documentos_dian d join ventas v on v.id = d.venta_id where d.empresa_id = $1 and ((case when d.tipo = 'nota_credito' then d.creado else v.creado end) at time zone 'America/Bogota')::date = $2::date`, [emp, hoy])).rows[0];
  // Aceptados = aceptados de verdad por la DIAN; los simulados van en su propio contador.
  const textos = await p.getByRole("region", { name: "Por estado" }).getByRole("link").allInnerTexts();
  const valor = (t) => { const x = textos.find((y) => y.startsWith(t)); return x ? Number(x.split("\n")[1]?.replace(/\D/g, "")) : 0; };
  const contadores = [valor("Aceptados"), valor("Simulados"), valor("Enviando"), valor("Rechazados")];
  ok(contadores[0] === cuenta.a && contadores[1] === cuenta.s && contadores[2] === cuenta.p && contadores[3] === cuenta.r, "los contadores cuadran con la base", `${contadores} vs ${cuenta.a},${cuenta.s},${cuenta.p},${cuenta.r}`);

  // Filtro por tipo
  await p.locator('select[name="tipo"]').selectOption("factura");
  await Promise.all([p.waitForURL(/tipo=factura/, { waitUntil: "commit" }), p.getByRole("button", { name: "Buscar", exact: true }).click()]);
  await p.waitForLoadState("networkidle");
  const tipos = await p.locator("tbody tr").allInnerTexts();
  ok(tipos.length > 0 && tipos.every((x) => /Factura/.test(x) && !/Tiquete POS/.test(x)), "filtro por tipo: solo facturas", String(tipos.length));
  // Contador como filtro
  await p.goto(B + `/documentos?desde=${hoy}&hasta=${hoy}`); await p.waitForLoadState("networkidle");
  await Promise.all([p.waitForURL(/estado=rechazado/, { waitUntil: "commit" }), p.getByRole("region", { name: "Por estado" }).getByRole("link", { name: /^Rechazados/ }).click()]);
  await p.waitForLoadState("networkidle");
  const rech = await p.locator("tbody tr").allInnerTexts();
  ok(rech.length === cuenta.r && rech.every((x) => /Rechazado/.test(x)), "el contador de rechazados filtra", `${rech.length}`);
  // Búsqueda por número y por cliente
  await p.goto(B + `/documentos?desde=${hoy}&hasta=${hoy}&q=${D.pos.n}`);
  ok((await p.locator("tbody tr").count()) === 1 && (await fila(D.pos.n).count()) === 1, "búsqueda por número");
  await p.goto(B + `/documentos?desde=${hoy}&hasta=${hoy}`);
  await p.locator('input[name="q"]').fill("salud vital"); await p.getByRole("button", { name: "Buscar", exact: true }).click();
  await p.waitForURL(/q=salud/);
  ok((await fila(D.fac.n).count()) === 1 && (await p.locator("tbody tr").allInnerTexts()).every((x) => /Salud Vital/.test(x)), "búsqueda por cliente");
  // Estado vacío
  await p.goto(B + `/documentos?desde=2021-01-04&hasta=2021-01-05`);
  ok(await p.getByText("No hay documentos en estas fechas").waitFor({ timeout: 10000 }).then(() => true, () => false), "estado vacío con orientación");

  // Reenviar el rechazado
  await p.goto(B + `/documentos?desde=${hoy}&hasta=${hoy}&estado=rechazado`); await p.waitForLoadState("networkidle");
  await p.getByRole("button", { name: `Reenviar ${D.fac.n} a la DIAN`, exact: true }).click();
  let tras = await docDe(vFac);
  for (let i = 0; i < 40 && tras.estado !== "aceptado"; i++) { await p.waitForTimeout(500); tras = await docDe(vFac); }
  await p.waitForLoadState("networkidle");
  ok(tras.estado === "aceptado", "reenviar desde la lista: la factura queda aceptada", tras.estado);
  const aud = (await pool.query(`select count(*)::int n from auditoria where empresa_id = $1 and accion = 'reenviar_dian' and entidad_id = $2`, [emp, vFac])).rows[0].n;
  ok(aud === 1, "el reenvío queda en la auditoría");

  // CSV
  const r = await p.request.get(B + `/api/documentos?desde=${hoy}&hasta=${hoy}`);
  const cuerpo = await r.text();
  ok(r.ok() && cuerpo.charCodeAt(0) === 0xfeff && cuerpo.slice(1).split("\r\n")[0] === "Fecha;Tipo;Número;Venta;Cliente;Documento del cliente;Total;Estado DIAN;Emisión simulada;CUFE/CUDE;Motivo del rechazo", "exporta a CSV para Excel", cuerpo.split("\r\n")[0]);
  ok([D.pos.n, D.fac.n, D.ncA.n, D.ncD.n].every((n) => cuerpo.includes(n)), "el CSV trae los cuatro documentos");
  ok((r.headers()["content-disposition"] ?? "").includes(`regenta-documentos-${hoy}-a-${hoy}.csv`), "el CSV trae nombre con el rango");

  await p.goto(B + `/documentos?desde=${hoy}&hasta=${hoy}`); await p.waitForLoadState("networkidle");
  await p.screenshot({ path: `${OUT}/documentos-escritorio.png` });
  // Acceso desde Ventas
  await p.goto(B + "/ventas");
  ok(await p.getByRole("main").getByRole("link", { name: "Documentos DIAN" }).getAttribute("href") === "/documentos", "Ventas lleva a Documentos");
  ok(errs.length === 0, "sin errores de consola (documentos)", errs.join(" | "));
  await ctx.close();
}

// ───────────────────────── Permisos de la cajera ─────────────────────────
{
  const { ctx, p } = await entrar("Laura");
  await p.goto(B + "/documentos"); await p.waitForURL(/\/inicio/, { timeout: 10000 }).catch(() => {});
  ok(!p.url().includes("/documentos"), "la cajera no entra a Documentos", p.url());
  ok((await p.request.get(B + "/api/documentos")).status() === 403, "la cajera recibe 403 en la API de documentos");
  await p.goto(B + "/temperatura"); await p.waitForURL(/\/inicio/, { timeout: 10000 }).catch(() => {});
  ok(!p.url().includes("/temperatura"), "la cajera no entra a la planilla de temperatura", p.url());
  ok((await p.request.get(B + `/api/temperatura?mes=${mes}`)).status() === 403, "la cajera no exporta la planilla");
  ok((await api(p, "/api/temperatura", "POST", { jornada: "manana", area: "general", temperatura: 20, humedad: 50 })).status === 403, "la cajera no registra temperatura (403)");
  await ctx.close();
}

// ───────────────────────── Temperatura y humedad ─────────────────────────
const slot = async (area, jornada) => (await pool.query(`select id, temperatura::float t, humedad::float h, fuera_rango, accion, anula_id, motivo from temperatura_registros
  where empresa_id = $1 and fecha = $2 and area = $3 and jornada = $4 order by creado`, [emp, hoy, area, jornada])).rows;
{
  // Rangos: en la demo compartida quedan fijos (038); como droguería normal, el dueño los cambia en la pantalla.
  const { ctx, p, errs } = await entrar("Carlos");
  await p.goto(B + "/temperatura"); await p.waitForLoadState("networkidle");
  ok(await p.getByText(/En la demo quedan fijos/).count() === 1 && await p.getByRole("button", { name: /Cambiar rango/ }).count() === 0, "en la demo los rangos se ven fijos, sin botón para cambiarlos");
  const rd = await api(p, "/api/temperatura", "PATCH", { area: "general", temp_min: 15, temp_max: 50, hum_min: 30, hum_max: 70 });
  ok(rd.status === 422 && /En la demo los rangos quedan fijos/.test(rd.j?.error ?? ""), "y la API tampoco deja cambiarlos en la demo", `${rd.status} ${JSON.stringify(rd.j)}`);
  await pool.query("update empresas set demo = false where id = $1", [emp]);
  await p.goto(B + "/temperatura"); await p.waitForLoadState("networkidle");
  ok(await p.getByText(/rango configurado por tu droguería/i).first().waitFor({ timeout: 10000 }).then(() => true, () => false), "la pantalla habla del rango configurado por la droguería");
  await p.getByRole("button", { name: "Cambiar rango de Almacenamiento general" }).click();
  await p.fill("#r-tmax", "28");
  await p.getByRole("button", { name: "Guardar rango" }).click();
  await p.getByText("Rango guardado").waitFor({ timeout: 10000 });
  const rg = (await pool.query(`select temp_min::float, temp_max::float, hum_min::float, hum_max::float from temperatura_rangos where empresa_id = $1 and area = 'general'`, [emp])).rows[0];
  ok(rg?.temp_max === 28 && rg.temp_min === 15 && rg.hum_max === 70, "el dueño configura el rango del almacenamiento general", JSON.stringify(rg));
  ok(errs.length === 0, "sin errores de consola (rangos)", errs.join(" | "));
  await pool.query("update empresas set demo = true where id = $1", [emp]);
  await ctx.close();
}
{
  const { ctx, p, errs } = await entrar("Andrés");
  await p.goto(B + "/inventario");
  ok(await p.getByRole("link", { name: "Temperatura y humedad" }).getAttribute("href") === "/temperatura", "Inventario lleva a la planilla");
  await p.goto(B + "/temperatura"); await p.waitForLoadState("networkidle");
  const form = p.getByRole("region", { name: "Registrar" });
  // Registro normal
  await form.getByRole("button", { name: "General", exact: true }).click();
  await form.getByRole("button", { name: "Mañana", exact: true }).click();
  await p.fill("#t-temp", "22,5"); await p.fill("#t-hum", "55");
  ok(await form.getByRole("alert").count() === 0, "dentro del rango no hay alerta");
  await form.getByRole("button", { name: "Guardar registro" }).click();
  await form.getByText("Registro guardado.").waitFor({ timeout: 10000 });
  let g = await slot("general", "manana");
  ok(g.length === 1 && g[0].t === 22.5 && g[0].h === 55 && !g[0].fuera_rango, "registro normal guardado", JSON.stringify(g));
  const celda = p.getByRole("region", { name: "Planilla del mes" }).getByRole("button", { name: /22,5 grados/ });
  ok(await celda.waitFor({ timeout: 10000 }).then(() => true, () => false), "la planilla del mes muestra el valor");

  // Fuera de rango: exige acción correctiva
  await form.getByRole("button", { name: "Nevera", exact: true }).click();
  await form.getByRole("button", { name: "Tarde", exact: true }).click();
  await p.fill("#t-temp", "11");
  const alerta = form.locator('[role="alert"]', { hasText: "Fuera del rango configurado por tu droguería" });
  ok(await alerta.isVisible(), "alerta inmediata fuera de rango");
  await form.getByRole("button", { name: "Guardar registro" }).click();
  ok(await form.getByText(/Escribe la acción correctiva/).isVisible(), "sin acción correctiva no se guarda");
  ok((await slot("frio", "tarde")).length === 0, "nada quedó guardado sin la acción");
  const sinAccion = await api(p, "/api/temperatura", "POST", { jornada: "tarde", area: "frio", temperatura: 11 });
  ok(sinAccion.status === 422 && /acción correctiva/.test(sinAccion.j.error), "la base también exige la acción (API)", `${sinAccion.status} ${sinAccion.j.error}`);
  await p.fill("#t-accion", "Se pasaron las insulinas a la nevera de respaldo y se avisó a la regente");
  await form.getByRole("button", { name: "Guardar registro" }).click();
  await form.getByText(/guardado fuera de rango/).waitFor({ timeout: 10000 });
  const f = await slot("frio", "tarde");
  ok(f.length === 1 && f[0].fuera_rango && /insulinas/.test(f[0].accion), "fuera de rango guardado con su acción", JSON.stringify(f));

  // Duplicado: la misma jornada no se registra dos veces
  const dup = await api(p, "/api/temperatura", "POST", { jornada: "manana", area: "general", temperatura: 21, humedad: 50 });
  ok(dup.status === 422 && /Corregir/.test(dup.j.error), "una jornada por área: el duplicado se rechaza", `${dup.status} ${dup.j.error}`);

  // Corrección sin borrar
  await p.reload(); await p.waitForLoadState("networkidle");
  await p.getByRole("region", { name: "Planilla del mes" }).getByRole("button", { name: /22,5 grados/ }).click();
  const det = p.getByRole("region", { name: "Detalle de la jornada" });
  await det.getByRole("button", { name: "Corregir" }).click();
  const corr = p.getByRole("region", { name: "Corregir registro" });
  await p.fill("#t-temp", "23"); await p.fill("#t-motivo", "Se anotó mal el número");
  await corr.getByRole("button", { name: "Guardar corrección" }).click();
  await p.getByText(/Corrección guardada/).waitFor({ timeout: 10000 });
  g = await slot("general", "manana");
  ok(g.length === 2 && g[0].t === 22.5 && g[1].t === 23 && g[1].anula_id === g[0].id && g[1].motivo === "Se anotó mal el número", "la corrección es un registro nuevo y el anterior se conserva", JSON.stringify(g.map((x) => [x.t, !!x.anula_id])));
  const nueva = p.getByRole("region", { name: "Planilla del mes" }).getByRole("button", { name: /23,0 grados.*corregido/ });
  ok(await nueva.waitFor({ timeout: 10000 }).then(() => true, () => false), "la planilla muestra el valor corregido y la marca");
  ok(await p.getByRole("region", { name: "Detalle de la jornada" }).getByText("Anulado por corrección").isVisible(), "el historial muestra el registro anulado");

  // Bodega no cambia rangos
  ok((await api(p, "/api/temperatura", "PATCH", { area: "general", temp_min: 0, temp_max: 50, hum_min: 0, hum_max: 100 })).status === 403, "la bodega no cambia los rangos (403)");
  ok(await p.getByRole("button", { name: /Cambiar rango/ }).count() === 0, "la bodega ve los rangos sin botón para cambiarlos");
  await p.screenshot({ path: `${OUT}/temperatura-escritorio.png`, fullPage: true });

  // Informe mensual
  await p.goto(B + `/informes/temperatura?mes=${mes}`); await p.waitForLoadState("networkidle");
  const inf = (await p.locator("main").innerText()).replace(/\s+/g, " ");
  ok(/DROGUERÍA DEMO CARLOS S\.A\.S\./.test(inf) && /NIT 900000001-1/.test(inf), "informe: empresa y NIT");
  ok(/Control de temperatura y humedad relativa/.test(inf) && new RegExp(mes.slice(0, 4)).test(inf), "informe: título y mes");
  ok(/23,0/.test(inf) && /11,0\*/.test(inf) && /insulinas/.test(inf), "informe: valores, fuera de rango marcado y su acción");
  ok(/Correcciones/.test(inf) && /Se anotó mal el número/.test(inf), "informe: correcciones con motivo");
  ok(/Firma del regente/.test(inf), "informe: firma de la regente");
  ok(/15,0 a 28,0 °C/.test(inf), "informe: rango configurado por la droguería");
  await p.screenshot({ path: `${OUT}/informe-escritorio.png`, fullPage: true });
  await p.pdf?.({ path: `${OUT}/informe.pdf`, format: "A4" }).catch(() => {});

  // CSV
  const r = await p.request.get(B + `/api/temperatura?mes=${mes}`);
  const cuerpo = await r.text();
  ok(r.ok() && cuerpo.charCodeAt(0) === 0xfeff && cuerpo.slice(1).split("\r\n")[0].startsWith("Fecha;Jornada;Área;Temperatura °C;Humedad relativa %"), "exporta la planilla a CSV", cuerpo.split("\r\n")[0]);
  ok(cuerpo.split("\r\n").length === 4 && /Anulado por corrección/.test(cuerpo) && /22,5/.test(cuerpo), "el CSV trae los 3 registros, incluido el anulado");
  ok(errs.length === 0, "sin errores de consola (temperatura)", errs.join(" | "));
  await ctx.close();
}

// ───────────────────────── Celular (iPhone 13) ─────────────────────────
{
  const { ctx, p, errs } = await entrar("Carlos", { ...devices["iPhone 13"] });
  for (const [ruta, nombre] of [[`/documentos?desde=${hoy}&hasta=${hoy}`, "documentos"], ["/temperatura", "temperatura"], [`/informes/temperatura?mes=${mes}`, "informe"]]) {
    await p.goto(B + ruta); await p.waitForLoadState("networkidle");
    const s = await sobra(p);
    ok(s <= 1, `${nombre} en el celular sin desborde`, `${s}px`);
    await p.screenshot({ path: `${OUT}/${nombre}-celular.png`, fullPage: nombre !== "documentos" });
  }
  ok(errs.length === 0, "sin errores de consola (celular)", errs.join(" | "));
  await ctx.close();
}

await b.close(); await pool.end();
console.log(`\n${fallos} fallos`);
process.exit(fallos ? 1 : 0);
