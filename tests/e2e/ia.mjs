// Regenta IA de punta a punta con un servidor que imita la API de Anthropic (no sale a internet):
// verifica encabezados, herramientas enviadas, que las herramientas devuelven datos reales de la droguería con RLS,
// que la cajera no recibe costos y que la respuesta llega a la pantalla.
// Uso: servidor Regenta en :4500 arrancado con ANTHROPIC_API_KEY=prueba-local REGENTA_IA_URL=http://localhost:4601
import http from "node:http";
import { chromium } from "playwright-core";
import pg from "pg";

const B = process.env.BASE ?? "http://localhost:4500";
let fallos = 0;
const ok = (c, m, x = "") => { console.log(`${c ? "PASS" : "FAIL"} ${m}${x ? " — " + x : ""}`); if (!c) fallos++; };
const vistos = [];

const mock = http.createServer((req, res) => {
  let cuerpo = "";
  req.on("data", (c) => (cuerpo += c));
  req.on("end", () => {
    const b = JSON.parse(cuerpo);
    vistos.push({ headers: req.headers, body: b });
    const ultimo = b.messages.at(-1);
    // Como la API real: un bloque de texto vacío en el historial es un 400 (pasó en producción el 06/11).
    if (b.messages.some((m) => Array.isArray(m.content) && m.content.some((x) => x.type === "text" && !x.text?.trim()))) {
      res.writeHead(400, { "content-type": "application/json" });
      return res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "messages: text content blocks must be non-empty" } }));
    }
    // Como la API real con stream:true: eventos SSE, el texto en pedazos y la llamada a la herramienta con su JSON por partes.
    const responder = async (o) => {
      if (!b.stream) { res.writeHead(200, { "content-type": "application/json" }); return res.end(JSON.stringify(o)); }
      res.writeHead(200, { "content-type": "text/event-stream" });
      const ev = (type, data) => res.write(`event: ${type}\ndata: ${JSON.stringify({ type, ...data })}\n\n`);
      ev("message_start", { message: { id: "m", role: "assistant", content: [] } });
      for (const [i, bl] of o.content.entries()) {
        if (bl.type === "text") {
          ev("content_block_start", { index: i, content_block: { type: "text", text: "" } });
          for (const pedazo of bl.text.match(/.{1,6}/gs) ?? []) { ev("content_block_delta", { index: i, delta: { type: "text_delta", text: pedazo } }); await new Promise((r) => setTimeout(r, 15)); }
        } else {
          ev("content_block_start", { index: i, content_block: { type: "tool_use", id: bl.id, name: bl.name, input: {} } });
          const js = JSON.stringify(bl.input);
          ev("content_block_delta", { index: i, delta: { type: "input_json_delta", partial_json: js.slice(0, 5) } });
          ev("content_block_delta", { index: i, delta: { type: "input_json_delta", partial_json: js.slice(5) } });
        }
        ev("content_block_stop", { index: i });
      }
      ev("message_delta", { delta: { stop_reason: o.stop_reason } });
      ev("message_stop", {});
      res.end();
    };
    if (typeof ultimo.content === "string" && /cuánto vendí hoy/i.test(ultimo.content)) {
      const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
      return responder({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "t2", name: "resumen_ventas", input: { desde: hoy, hasta: hoy } }] });
    }
    if (typeof ultimo.content === "string" && /inventario a costo/i.test(ultimo.content))
      return responder({ stop_reason: "tool_use", content: [{ type: "text", text: "" }, { type: "tool_use", id: "t3", name: "resumen_inventario", input: {} }] });
    if (typeof ultimo.content === "string") {
      const herramienta = /vencer/i.test(ultimo.content) ? "riesgo_vencimiento" : "pedido_sugerido";
      return responder({ stop_reason: "tool_use", content: [{ type: "text", text: "Consulto tus datos." }, { type: "tool_use", id: "t1", name: herramienta, input: { limite: 3 } }] });
    }
    const datos = JSON.parse(ultimo.content[0].content);
    if (!Array.isArray(datos) && "productos_activos" in datos) return responder({ stop_reason: "end_turn", content: [{ type: "text", text: `Tienes ${datos.productos_activos} productos; a costo ${datos.valor_inventario_a_costo}.` }] });
    if (!Array.isArray(datos) && "ventas_netas" in datos) return responder({ stop_reason: "end_turn", content: [{ type: "text", text: `Netas: ${datos.ventas_netas}.` }] });
    const primero = datos[0]?.nombre ?? "nada";
    responder({ stop_reason: "end_turn", content: [{ type: "text", text: `Lo primero: ${primero}.` }] });
  });
}).listen(Number(process.env.IA_MOCK_PUERTO ?? 4601)); // el servidor apunta REGENTA_IA_URL aquí

const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium" });

// Las pruebas funcionales entran a la demo sin las ofertas del embudo (las prueba embudo.mjs).
{ const nc = b.newContext.bind(b); b.newContext = async (o) => { const c = await nc(o); await c.addInitScript(() => { try { sessionStorage.setItem("regenta_demo_v1", JSON.stringify({ hechos: [], ofertas: ["prueba", "prueba"], cerrada: true, inicio: Date.now() })); } catch {} }); return c; }; }
// Dueño: pregunta por el pedido desde el panel
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message));
  await p.goto(B + "/demo"); await p.getByRole("button", { name: /Probar la demo/ }).click(); await p.waitForURL(/inicio/);
  await p.getByRole("button", { name: "Abrir Regenta IA", exact: true }).click();
  await p.waitForSelector("text=¿Qué debo pedir esta semana?");
  await p.screenshot({ path: "test-results/ia-panel.png" });
  await p.locator("#ia-texto").fill("¿Qué debo pedir esta semana?");
  await p.getByRole("button", { name: "Enviar" }).click();
  await p.waitForSelector("text=Consultó:", { timeout: 20000 }); // fin de la respuesta (el texto llega antes, por partes)
  const r = vistos[0];
  ok(r.headers["x-api-key"] === "prueba-local" && r.headers["anthropic-version"] === "2023-06-01", "encabezados de la API de Anthropic");
  ok(r.body.tools.length >= 7 && r.body.tools.every((t) => t.input_schema?.type === "object"), "envía las herramientas con su esquema", `${r.body.tools.length}`);
  const sys = r.body.system.map?.((x) => x.text).join("") ?? r.body.system;
  ok(r.body.stream === true && r.body.system[0]?.cache_control?.type === "ephemeral", "pide la respuesta en flujo y deja las instrucciones en caché");
  ok(vistos[1].body.messages.at(-2).content.some((x) => x.type === "tool_use" && x.input.limite === 3), "arma la llamada a la herramienta desde el JSON por partes");
  ok(await p.getByText("Consulto tus datos.").count() === 0, "el texto provisional antes de consultar no queda en pantalla");
  ok(/Regenta IA/.test(sys) && /No diagnosticas/.test(sys) && /Resolución 1403 de 2007/.test(sys) && /urgencias/.test(sys), "instrucciones del sistema");
  ok(/Planes y precios/.test(sys) && /Confidencialidad/.test(sys) && /Dónde se hace cada cosa/.test(sys) && /89\.900/.test(sys), "conoce Regenta: funciones, dónde se hace cada cosa, planes y reglas de confidencialidad");
  ok(r.body.system.length === 2 && !/Hoy es/.test(r.body.system[0].text) && /DEMO/.test(r.body.system[1].text), "el conocimiento fijo va en caché y aparte la fecha, el usuario y el modo demo");
  const resultado = JSON.parse(vistos[1].body.messages.at(-1).content[0].content);
  ok(Array.isArray(resultado) && resultado.length > 0 && "sugerido_cajas" in resultado[0], "la herramienta devolvió el pedido sugerido real", resultado[0]?.nombre);
  ok(await p.getByText(`Lo primero: ${resultado[0].nombre}.`).count() === 1, "la respuesta aparece en pantalla");
  ok(await p.getByText("Consultó: pedido sugerido").count() === 1, "muestra qué datos consultó");
  await p.screenshot({ path: "test-results/ia.png" });
  // desde Ctrl+K
  await p.keyboard.press("Escape");
  await p.keyboard.press("Control+k");
  await p.getByLabel("Buscar").fill("qué productos tengo por vencer");
  await p.getByText("Preguntar a Regenta IA").click();
  await p.waitForSelector("text=Consultó: vencimientos", { timeout: 20000 });
  const r2 = JSON.parse(vistos.at(-1).body.messages.at(-1).content[0].content);
  ok("valor_en_riesgo" in r2[0], "el dueño recibe el valor a costo");
  // La IA abre un texto vacío y pasa a consultar: no se le devuelve a la API (antes daba 400 y «no pudo responder»).
  const inv = await p.evaluate(async () => (await (await fetch("/api/ia", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mensajes: [{ role: "user", content: "¿Cuántos productos tengo y cuánto vale mi inventario a costo?" }] }) })).text()));
  const fin = JSON.parse(inv.trim().split("\n").filter(Boolean).at(-1));
  ok(!fin.error && /Tienes \d+ productos; a costo \d/.test(fin.respuesta ?? ""), "inventario a costo responde aunque la IA abra un texto vacío", JSON.stringify(fin).slice(0, 160));
  ok(errs.length === 0, "sin errores de JavaScript", errs.join(" | "));
  await ctx.close();
}
// Cajera: la IA no le entrega costos
{
  const ctx = await b.newContext();
  const p = await ctx.newPage();
  await p.request.post(B + "/demo", { form: { rol: "cajero" } });
  const r = await p.request.post(B + "/api/ia", { data: { mensajes: [{ role: "user", content: "¿qué se me puede vencer?" }] } });
  ok(r.ok(), "la cajera puede preguntar", `${r.status()}`);
  const eventos = (await r.text()).split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  ok(eventos.at(-1).t === "fin" && /Lo primero:/.test(eventos.at(-1).respuesta) && eventos.some((e) => e.t === "consulta") && eventos.some((e) => e.t === "texto"), "la respuesta llega por partes (consulta, texto y fin)");
  const datos = JSON.parse(vistos.at(-1).body.messages.at(-1).content[0].content);
  ok(datos.length > 0 && !("valor_en_riesgo" in datos[0]), "a la cajera no le llegan costos");
  const malo = await p.request.post(B + "/api/ia", { data: { mensajes: [] } });
  ok(malo.status() === 400, "pregunta vacía rechazada");
  // Conversación larga: una respuesta anterior de más de 2.000 caracteres ya no rompe la siguiente pregunta (07/11)
  const larga = "Pedido sugerido detallado. ".repeat(220);
  const sigue = await p.request.post(B + "/api/ia", { data: { mensajes: [{ role: "user", content: "¿Qué pido esta semana?" }, { role: "assistant", content: larga }, { role: "user", content: "¿Y cuál me deja más margen?" }] } });
  ok(sigue.ok(), "tras una respuesta larga, la siguiente pregunta funciona", `${sigue.status()} · ${larga.length} caracteres`);
  const enviados = vistos.at(-1).body.messages;
  ok(enviados[1].role === "assistant" && enviados[1].content.length <= 8000 && enviados[0].role === "user", "el historial llega al modelo en orden y recortado", JSON.stringify(enviados.map((m) => [m.role, typeof m.content === "string" ? m.content.length : "bloques"])));
  const raro = await p.request.post(B + "/api/ia", { data: { mensajes: [{ role: "assistant", content: "Hola" }, { role: "user", content: "uno" }, { role: "user", content: "dos" }] } });
  ok(raro.ok(), "historial desordenado (error previo, dos preguntas seguidas) se ordena y responde", `${raro.status()}`);
  await ctx.close();
}
// Celular: el panel ocupa la pantalla, «atrás» lo cierra sin salir de la página y el botón se esconde al bajar
{
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const p = await ctx.newPage();
  await p.goto(B + "/demo"); await p.getByRole("button", { name: /Probar la demo/ }).click(); await p.waitForURL(/inicio/);
  await p.goto(B + "/productos"); await p.waitForLoadState("networkidle");
  const boton = p.getByRole("button", { name: "Abrir Regenta IA", exact: true });
  const caja = await boton.boundingBox();
  ok(caja && caja.width <= 48 && caja.height <= 48, "botón flotante pequeño en celular", caja && `${caja.width}x${caja.height}`);
  await p.mouse.wheel(0, 1500); await p.waitForTimeout(350);
  ok(await boton.evaluate((e) => getComputedStyle(e).opacity) === "0", "al bajar por la página el botón se esconde");
  await p.waitForTimeout(1500);
  ok(await boton.evaluate((e) => getComputedStyle(e).opacity) === "1", "quieto, el botón vuelve");
  await boton.click();
  const panel = await p.getByRole("dialog", { name: "Regenta IA" }).boundingBox();
  ok(panel && panel.width === 390 && panel.height >= 840, "el panel ocupa la pantalla completa", panel && `${panel.width}x${panel.height}`);
  await p.getByRole("button", { name: "¿Qué debo pedir esta semana?" }).click();
  await p.waitForSelector("text=Consultó:", { timeout: 20000 }); // fin de la respuesta (el texto llega antes, por partes)
  await p.screenshot({ path: "test-results/ia-movil.png" });
  await p.goBack();
  await p.waitForTimeout(300);
  ok(await p.getByRole("dialog", { name: "Regenta IA" }).count() === 0 && new URL(p.url()).pathname === "/productos", "«atrás» cierra el panel y se queda en la página");
  ok(await p.evaluate(() => document.documentElement.scrollWidth) <= 390, "sin desborde horizontal");
  await ctx.close();
}
// Ventas de hoy: netas de devoluciones (como Reportes). Se hace una venta y se devuelve una unidad por la API; las cifras
// que recibe la IA deben cuadrar con la base: netas = brutas − devoluciones del día.
{
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/regenta?host=/tmp" });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  await p.goto(B + "/demo"); await p.getByRole("button", { name: /Probar la demo/ }).click(); await p.waitForURL(/inicio/);
  const api = (url, metodo, cuerpo) => p.evaluate(async ([u, m, c]) => { const r = await fetch(u, { method: m, headers: { "content-type": "application/json" }, body: JSON.stringify(c) }); return { status: r.status, j: await r.json().catch(() => ({})) }; }, [url, metodo, cuerpo]);
  const prod = await p.evaluate(async () => (await (await fetch("/api/productos?q=acetaminofen forte")).json()).productos[0]);
  const v = await api("/api/ventas", "POST", { idem_key: crypto.randomUUID(), tipo_doc: "pos", lineas: [{ producto_id: prod.id, presentacion: "unidad", cantidad: 3 }], pagos: [{ medio: "efectivo", valor: 50000 }] });
  ok(v.status === 200, "venta para la prueba de ventas netas", String(v.status));
  const d = await api(`/api/ventas/${v.j.venta?.venta_id}/devolucion`, "POST", { motivo: "Prueba de ventas netas", lineas: [{ producto_id: prod.id, presentacion: "unidad", cantidad: 1 }] });
  ok(d.status === 200 || d.status === 201, "devolución de una unidad", `${d.status} ${d.j.error ?? ""}`);
  const r = await p.request.post(B + "/api/ia", { data: { mensajes: [{ role: "user", content: "¿Cuánto vendí hoy?" }] } });
  const eventos = (await r.text()).split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
  const datos = JSON.parse(vistos.at(-1).body.messages.at(-1).content[0].content);
  const emp = (await pool.query(`select id from empresas where demo limit 1`)).rows[0].id;
  const base = (await pool.query(`select (select coalesce(sum(total), 0) from ventas where empresa_id = $1 and estado = 'cerrada' and (creado at time zone 'America/Bogota')::date = (now() at time zone 'America/Bogota')::date)::float bruto,
    (select coalesce(sum(total), 0) from devoluciones where empresa_id = $1 and (creado at time zone 'America/Bogota')::date = (now() at time zone 'America/Bogota')::date)::float dev`, [emp])).rows[0];
  ok(datos.devoluciones?.total > 0 && Math.abs(datos.devoluciones.total - base.dev) < 0.01, "la IA recibe las devoluciones del día", `${datos.devoluciones?.total} vs ${base.dev}`);
  ok(Math.abs(datos.ventas_brutas - base.bruto) < 0.01 && Math.abs(datos.ventas_netas - (base.bruto - base.dev)) < 0.01, "ventas netas = brutas − devoluciones (como Reportes)", `${datos.ventas_brutas} − ${datos.devoluciones?.total} = ${datos.ventas_netas}`);
  const dia = datos.por_dia.at(-1);
  ok(dia && Math.abs(dia.netas - (base.bruto - base.dev)) < 0.01, "el día también va neto", JSON.stringify(dia));
  ok(eventos.at(-1).t === "fin" && eventos.at(-1).respuesta === `Netas: ${datos.ventas_netas}.`, "la respuesta usa las ventas netas", eventos.at(-1).respuesta);
  await ctx.close(); await pool.end();
}
{
  const r = await (await b.newContext()).request.post(B + "/api/ia", { data: { mensajes: [{ role: "user", content: "hola" }] } });
  ok(r.status() === 401, "sin sesión no responde");
}
await b.close(); mock.close();
console.log(`\n${fallos} fallos`);
process.exit(fallos ? 1 : 0);
