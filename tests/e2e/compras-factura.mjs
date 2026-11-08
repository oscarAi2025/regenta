// Compras desde la factura del proveedor (08/11/2026): XML de la DIAN armado con productos reales de la demo (uno por
// código de barras, uno por nombre, uno que la persona empareja), lote y vencimiento desde la descripción, proveedor nuevo
// con NIT, CUFE; pantalla de revisión en Nueva compra, guardar y que la próxima factura de ese proveedor salga emparejada
// sola; factura repetida avisada; nota crédito real (Pasteur) rechazada sin tocar inventario; foto leída con Regenta IA
// (simulada: transcripción de la foto de ejemplo) con su aviso de comprador distinto; la bodega sin costos; la cajera 403;
// archivo guardado en el espacio de la droguería (no en la demo), enlazado a la compra y aislado de otra droguería;
// celular sin desbordes. Uso: servidor con IA simulada (REGENTA_IA_URL=http://localhost:$IA_MOCK_PUERTO) →
// BASE=… DATABASE_URL=… REGENTA_SESSION_SECRET=… IA_MOCK_PUERTO=… node tests/e2e/compras-factura.mjs
import { chromium, devices } from "playwright-core";
import http from "node:http";
import { readFileSync } from "node:fs";
import pg from "pg";
import { SignJWT } from "jose";

const B = process.env.BASE ?? "http://localhost:4500";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/regenta?host=/tmp" });
let fallos = 0;
const ok = (c, m, x = "") => { console.log(`${c ? "PASS" : "FAIL"} ${m}${x ? " — " + x : ""}`); if (!c) fallos++; };
const q = async (sql, params = []) => (await pool.query(sql, params)).rows;
const q1 = async (sql, params = []) => (await q(sql, params))[0];
const fx = (n) => readFileSync(new URL(`../fixtures/facturas/${n}`, import.meta.url));

// ── Regenta IA simulada: devuelve la transcripción de la foto del tiquete de ejemplo (o «no es factura»).
let iaPedidos = [], iaModo = "factura";
const FOTO = {
  es_factura: true, tipo: "factura", numero: "POSF1003", fecha: "2026-10-01", proveedor_nombre: "farmagenericos colombia", proveedor_nit: "901845370", comprador_nit: "860676057",
  lineas: [
    { descripcion: "acetaminofen delta (FECHA VENCIMIENTO: 18/04/2029)(LOTE: 26312018)", cantidad: 50, precio_unitario: 4950, total_linea: 247500 },
    { descripcion: "AZITROMICINA (DELTAZITROM ) (FECHA VENCIMIENTO:30/12/2028)(LOTE:425251292)", cantidad: 100, precio_unitario: 2350, total_linea: 235000 },
    { descripcion: "AMETREX ACETAMINOFEN 120 ML (FECHA VENCIMIENTO:28/05/2028)(LOTE:000926)", cantidad: 50, precio_unitario: 2350, total_linea: 117500 },
    { descripcion: "LIMPIADERM CREMA TOPICA X 20 GR BIOQUIFAR (FECHA VENCIMIENTO: 31/07/2028)(LOTE:L2226)", cantidad: 60, precio_unitario: 6850, total_linea: 411000 },
  ],
  total: 1011000,
};
const mock = http.createServer((req, res) => {
  let body = ""; req.on("data", (d) => (body += d)); req.on("end", () => {
    const b = JSON.parse(body || "{}"); iaPedidos.push(b);
    const input = iaModo === "factura" ? FOTO : { es_factura: false, lineas: [] };
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ id: "m", role: "assistant", stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "factura_leida", input }] }));
  });
});
await new Promise((ok) => mock.listen(Number(process.env.IA_MOCK_PUERTO ?? 4640), ok));

const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium" });
{ const nc = b.newContext.bind(b); b.newContext = async (o) => { const c = await nc(o); await c.addInitScript(() => { try { sessionStorage.setItem("regenta_demo_v1", JSON.stringify({ hechos: [], ofertas: ["prueba", "prueba"], cerrada: true, inicio: Date.now() })); } catch {} }); return c; }; }
const vigilar = (p) => { const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => m.type() === "error" && !/status of 4\d\d/.test(m.text()) && errs.push(m.text())); return errs; };
async function entrar(quien, opciones = { viewport: { width: 1440, height: 900 } }) {
  const ctx = await b.newContext(opciones); const p = await ctx.newPage(); const errs = vigilar(p);
  await p.goto(B + "/entrar"); await p.getByRole("button", { name: new RegExp(quien) }).click(); await p.waitForURL(/\/(caja|inicio)/);
  return { ctx, p, errs };
}
/** Sube un archivo a /api/compras/leer-factura desde la página (con su sesión). */
const leer = (p, nombre, tipo, datos) => p.evaluate(async ([n, t, d]) => {
  const fd = new FormData(); fd.append("archivo", new Blob([new Uint8Array(d)], { type: t }), n);
  const r = await fetch("/api/compras/leer-factura", { method: "POST", body: fd });
  return { status: r.status, j: await r.json().catch(() => ({})) };
}, [nombre, tipo, [...datos]]);

// ── Factura de prueba con productos reales de la demo.
const DEMO = await q1(`select id, nit from empresas where demo limit 1`);
const R = Date.now().toString().slice(-6);
const NIT_PROV = "8" + R.padStart(8, "1");
const [P1] = await q(`select id, nombre, ean, unidades_por_caja upc from productos where empresa_id = $1 and activo and ean ~ '^[0-9]{13}$' and unidades_por_caja > 1 order by nombre limit 1`, [DEMO.id]);
const [P2] = await q(`select p.id, p.nombre, p.unidades_por_caja upc from productos p where p.empresa_id = $1 and p.activo and p.id <> $2 and p.nombre ~* '^(losart|omepra|metform|loratad)'
   and (select count(*) from productos x where x.empresa_id = p.empresa_id and split_part(lower(x.nombre), ' ', 1) = split_part(lower(p.nombre), ' ', 1)) = 1 order by p.nombre limit 1`, [DEMO.id, P1.id]);
const [P3] = await q(`select id, nombre, unidades_por_caja upc from productos where empresa_id = $1 and activo and id not in ($2, $3) and nombre ~* 'ibuprofeno' order by nombre limit 1`, [DEMO.id, P1.id, P2.id]);
ok(!!(P1 && P2 && P3), "productos de la demo para la factura", [P1?.nombre, P2?.nombre, P3?.nombre].join(" | "));
const linea = (n, cant, precio, item, iva = 0) => `<cac:InvoiceLine><cbc:ID>${n}</cbc:ID><cbc:InvoicedQuantity unitCode="94">${cant}</cbc:InvoicedQuantity><cbc:LineExtensionAmount currencyID="COP">${(cant * precio).toFixed(2)}</cbc:LineExtensionAmount>
  <cac:TaxTotal><cbc:TaxAmount currencyID="COP">${((cant * precio * iva) / 100).toFixed(2)}</cbc:TaxAmount><cac:TaxSubtotal><cbc:TaxAmount currencyID="COP">0</cbc:TaxAmount><cac:TaxCategory><cbc:Percent>${iva}.00</cbc:Percent><cac:TaxScheme><cbc:ID>01</cbc:ID></cac:TaxScheme></cac:TaxCategory></cac:TaxSubtotal></cac:TaxTotal>
  <cac:Item>${item}</cac:Item><cac:Price><cbc:PriceAmount currencyID="COP">${precio.toFixed(2)}</cbc:PriceAmount><cbc:BaseQuantity unitCode="94">1</cbc:BaseQuantity></cac:Price></cac:InvoiceLine>`;
const esc = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const factura = (numero) => `<?xml version="1.0" encoding="UTF-8"?><AttachedDocument xmlns="urn:oasis:names:specification:ubl:schema:xsd:AttachedDocument-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
<cac:Attachment><cac:ExternalReference><cbc:Description><![CDATA[<Invoice xmlns="urn:oasis:names:specification:ubl:schema:xsd:Invoice-2" xmlns:cac="urn:oasis:names:specification:ubl:schema:xsd:CommonAggregateComponents-2" xmlns:cbc="urn:oasis:names:specification:ubl:schema:xsd:CommonBasicComponents-2">
<cbc:ID>${numero}</cbc:ID><cbc:UUID schemeName="CUFE-SHA384">${"c".repeat(40)}${R}${"f".repeat(50)}</cbc:UUID><cbc:IssueDate>2026-11-04</cbc:IssueDate>
<cac:AccountingSupplierParty><cac:Party><cac:PartyTaxScheme><cbc:RegistrationName>MAYORISTA PRUEBA ${R} S.A.S.</cbc:RegistrationName><cbc:CompanyID schemeID="3">${NIT_PROV}</cbc:CompanyID></cac:PartyTaxScheme></cac:Party></cac:AccountingSupplierParty>
<cac:AccountingCustomerParty><cac:Party><cac:PartyTaxScheme><cbc:RegistrationName>DROGUERIA DEMO</cbc:RegistrationName><cbc:CompanyID schemeID="1">${DEMO.nit}</cbc:CompanyID></cac:PartyTaxScheme></cac:Party></cac:AccountingCustomerParty>
<cac:LegalMonetaryTotal><cbc:LineExtensionAmount currencyID="COP">0</cbc:LineExtensionAmount><cbc:PayableAmount currencyID="COP">${2 * 30000 + 3 * 12000 + 4 * 5000}.00</cbc:PayableAmount></cac:LegalMonetaryTotal>
${linea(1, 2, 30000, `<cbc:Description>${esc(P1.nombre.toUpperCase())}</cbc:Description><cac:StandardItemIdentification><cbc:ID schemeID="010">${P1.ean}</cbc:ID></cac:StandardItemIdentification><cac:ItemInstance><cac:LotIdentification><cbc:LotNumberID>F${R}A</cbc:LotNumberID><cbc:ExpiryDate>2029-06-30</cbc:ExpiryDate></cac:LotIdentification></cac:ItemInstance>`)}
${linea(2, 3, 12000, `<cbc:Description>${esc(P2.nombre.toUpperCase())} (FECHA VENCIMIENTO: 15/03/2029)(LOTE: F${R}B)</cbc:Description><cac:SellersItemIdentification><cbc:ID>COD-${R}-2</cbc:ID></cac:SellersItemIdentification>`)}
${linea(3, 4, 5000, `<cbc:Description>PRODUCTO RARO ${R} REF ZZ (LOTE: F${R}C)</cbc:Description><cac:SellersItemIdentification><cbc:ID>COD-${R}-3</cbc:ID></cac:SellersItemIdentification>`)}
</Invoice>]]></cbc:Description></cac:ExternalReference></cac:Attachment></AttachedDocument>`;
const XML1 = Buffer.from(factura(`FP-${R}`));

// ───────────── Dueño (escritorio): leer por API, cargar en pantalla, emparejar y guardar
{
  const { ctx, p, errs } = await entrar("Carlos");
  const r = await leer(p, `fp-${R}.xml`, "text/xml", XML1);
  const d = r.j.documento;
  ok(r.status === 200 && d?.tipo === "factura" && d.numero === `FP-${R}`, "XML de la DIAN leído", `${r.status} ${r.j.error ?? ""}`);
  ok(r.j.proveedor === null && d?.proveedor.nit === NIT_PROV, "proveedor nuevo reconocido por su NIT");
  ok(d?.lineas[0].producto?.id === P1.id && d.lineas[0].por === "codigo", "línea 1 emparejada por código de barras", d?.lineas[0].por);
  ok(d?.lineas[1].producto?.id === P2.id && d.lineas[1].por === "nombre", "línea 2 emparejada por nombre", `${d?.lineas[1].por} ${d?.lineas[1].producto?.nombre ?? JSON.stringify(d?.lineas[1].candidatos?.map((x) => [x.nombre, x.puntaje]))}`);
  ok(d?.lineas[2].producto === null, "línea 3 (producto desconocido) queda por emparejar, no se adivina");
  ok(d?.lineas[0].lote === `F${R}A` && d.lineas[0].vence === "2029-06-30" && d.lineas[1].lote === `F${R}B` && d.lineas[1].vence === "2029-03-15", "lotes y vencimientos (campo UBL y descripción)");
  ok(r.j.archivo_id === null, "en la demo el archivo no se guarda (droguería compartida)");
  ok(d?.lineas[0].precio === 30000 && d.totales.total === 116000, "precios y total para el dueño");

  await p.goto(B + "/compras/nueva"); await p.waitForLoadState("networkidle");
  await p.locator('input[aria-label="Archivo de la factura"]').setInputFiles({ name: `fp-${R}.xml`, mimeType: "text/xml", buffer: XML1 });
  await p.getByText(/por emparejar abajo/).waitFor({ timeout: 30000 });
  ok(await p.locator("#proveedor").inputValue() === `MAYORISTA PRUEBA ${R} S.A.S.` && await p.locator("#factura").inputValue() === `FP-${R}`, "proveedor y número de factura rellenados");
  ok(await p.locator("#nit-nuevo").inputValue() === NIT_PROV, "NIT del proveedor nuevo rellenado");
  ok(await p.getByText(/^CUFE c{40}/).isVisible(), "CUFE visible");
  ok(await p.locator('article:has-text("En la factura")').count() === 2, "2 líneas armadas con su descripción de la factura");
  ok(await p.getByRole("heading", { name: "Por emparejar (1)" }).isVisible(), "1 producto por emparejar");
  await p.getByRole("button", { name: /^Guardar/ }).click();
  ok(await p.getByRole("alert").filter({ hasText: /por emparejar/ }).isVisible(), "no deja guardar con productos sin emparejar");
  await p.locator('[id^="emp-"]').fill(P3.nombre.split(" ").slice(0, 2).join(" "));
  await p.locator("#por-emparejar li button", { hasText: P3.nombre }).first().click();
  ok(await p.locator('article:has-text("En la factura")').count() === 3 && await p.locator("#por-emparejar").count() === 0, "emparejado a mano: pasa a la compra");
  const lote3 = await p.locator('article:has-text("PRODUCTO RARO") input[id^="lote-"]').inputValue();
  ok(lote3 === `F${R}C`, "la línea emparejada conserva su lote", lote3);
  // Revisión: costos y cajas/unidades según cómo viene la factura.
  const costos = await p.locator('input[id^="costo-"]').evaluateAll((xs) => xs.map((x) => x.value));
  ok(JSON.stringify(costos) === JSON.stringify(["30000", "12000", "5000"]), "costos de la factura en la pantalla", costos.join(","));
  await p.getByRole("button", { name: /^Guardar/ }).click();
  await p.getByText(/Compra N\.º \d+ guardada/).waitFor({ timeout: 30000 });
  const c = await q1(`select c.id, c.cufe_proveedor, c.numero_factura, pr.nit, pr.nombre, c.total::float from compras c join proveedores pr on pr.id = c.proveedor_id where c.empresa_id = $1 and c.numero_factura = $2`, [DEMO.id, `FP-${R}`]);
  ok(c && c.nit === NIT_PROV && c.cufe_proveedor?.startsWith("cccc"), "compra guardada con el proveedor nuevo (NIT) y el CUFE");
  const ls = await q(`select p.id, l.lote, l.vence::text from compra_lineas cl join lotes l on l.id = cl.lote_id join productos p on p.id = cl.producto_id where cl.compra_id = $1 order by cl.id`, [c?.id]);
  ok(ls.length === 3 && ls.some((x) => x.id === P1.id && x.lote === `F${R}A` && x.vence === "2029-06-30") && ls.some((x) => x.id === P3.id && x.lote === `F${R}C`), "3 líneas con sus lotes y vencimientos en el inventario", JSON.stringify(ls));
  const mem = await q(`select clave, producto_id from proveedor_productos where empresa_id = $1 and proveedor_id = (select proveedor_id from compras where id = $2)`, [DEMO.id, c?.id]);
  ok(mem.some((m) => m.clave === `cod:cod-${R}-3` && m.producto_id === P3.id), "Regenta recuerda el emparejamiento hecho a mano", JSON.stringify(mem.map((m) => m.clave)));

  // La misma factura otra vez: avisa que ya está y todo sale emparejado (código o memoria).
  const r2 = await leer(p, `fp-${R}.xml`, "text/xml", XML1);
  ok(r2.status === 200 && r2.j.duplicada?.id === c?.id && r2.j.avisos.some((a) => /ya está registrada/.test(a)), "factura repetida: avisa con el número de compra");
  ok(r2.j.documento.lineas.every((l) => l.producto) && r2.j.documento.lineas[2].por === "memoria" && r2.j.documento.lineas[2].producto.id === P3.id, "la próxima factura de ese proveedor sale emparejada sola (memoria)");
  const XML2 = Buffer.from(factura(`FP-${R}-2`));
  const r3 = await leer(p, "otra.xml", "application/xml", XML2);
  ok(r3.status === 200 && !r3.j.duplicada && r3.j.proveedor?.nit === NIT_PROV, "factura nueva del mismo proveedor: lo reconoce por NIT");

  // Nota crédito real de un proveedor: no carga inventario.
  const antes = Number((await q1(`select count(*) n from compras where empresa_id = $1`, [DEMO.id])).n);
  const nc = await leer(p, "ad0890.zip", "application/zip", fx("pasteur-nota-credito.zip"));
  ok(nc.status === 422 && nc.j.nota?.tipo === "nota_credito" && /nota crédito/.test(nc.j.error) && /no mete mercancía/.test(nc.j.error), "nota crédito (ZIP real de Pasteur): explicada y rechazada", nc.j.error);
  ok(Number((await q1(`select count(*) n from compras where empresa_id = $1`, [DEMO.id])).n) === antes, "la nota crédito no creó ninguna compra");
  // Archivos que no son facturas.
  ok((await leer(p, "x.txt", "text/plain", Buffer.from("hola"))).status === 415, "texto plano → 415");
  ok((await leer(p, "x.xml", "text/xml", Buffer.from("<Otro/>"))).status === 422, "XML que no es factura → 422");
  ok((await leer(p, "x.zip", "application/zip", Buffer.from("PK\u0003\u0004basura"))).status === 422, "ZIP dañado → 422");

  // Foto: Regenta IA (simulada) transcribe; el lote y el vencimiento salen de la descripción.
  iaPedidos = []; iaModo = "factura";
  const jpg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(2000, 7)]);
  const f = await leer(p, "foto.jpg", "image/jpeg", jpg);
  const fd = f.j.documento;
  ok(f.status === 200 && fd?.origen === "ia" && fd.lineas.length === 4, "foto leída con Regenta IA", `${f.status} ${f.j.error ?? ""}`);
  const pedido = iaPedidos[0];
  ok(pedido?.tool_choice?.name === "factura_leida" && pedido.messages[0].content[0].type === "image" && pedido.messages[0].content[0].source.media_type === "image/jpeg", "la foto va a la IA como imagen, con la herramienta obligatoria");
  ok(fd?.lineas[0].lote === "26312018" && fd.lineas[0].vence === "2029-04-18" && fd.lineas[3].lote === "L2226" && fd.lineas[3].vence === "2028-07-31", "lotes y vencimientos de la foto", JSON.stringify(fd?.lineas.map((l) => [l.lote, l.vence])));
  ok(fd?.lineas[0].nombre === "acetaminofen delta" && fd.lineas[2].precio === 2350, "nombre limpio y precio de la foto");
  ok(f.j.avisos.some((a) => /no de tu droguería/.test(a)), "avisa que la factura está a nombre de otro comprador");
  iaModo = "no";
  const nf = await leer(p, "gato.jpg", "image/jpeg", jpg);
  ok(nf.status === 422 && /no se ve una factura/i.test(nf.j.error), "foto que no es factura → mensaje claro", nf.j.error);
  ok(errs.length === 0, "sin errores de consola (dueño)", errs.slice(0, 3).join(" | "));
  await ctx.close();
}

// ───────────── Bodega: productos, lotes y cantidades sin costos; cajera sin acceso
{
  const { ctx, p } = await entrar("Andrés");
  const r = await leer(p, "b.xml", "text/xml", Buffer.from(factura(`FP-${R}-B`)));
  const d = r.j.documento;
  ok(r.status === 200 && d.lineas.length === 3 && d.lineas.every((l) => l.precio === null && l.base === null) && d.totales.total === null, "la bodega recibe la factura sin precios ni totales");
  ok(d.lineas.every((l) => !l.producto || !("costo_unidad" in l.producto)), "ni el costo de los productos");
  await ctx.close();
}
{
  const { ctx, p } = await entrar("Laura");
  ok((await leer(p, "c.xml", "text/xml", XML1)).status === 403, "la cajera no carga facturas de compra (403)");
  await ctx.close();
}

// ───────────── Droguería real (no demo): el archivo queda en su espacio, enlazado a la compra, y nadie más lo ve
{
  const EB = await q1(`select id from empresas where not demo and nit = '900000002'`);
  const DUENO_B = "00000000-0000-4000-8000-000000000004";
  const prodB = (await q1(`insert into productos (empresa_id, nombre, laboratorio, unidades_por_caja, precio_caja, iva) values ($1, $2, 'Lab B', 1, 5000, 0) returning id`, [EB.id, `Producto Vecina ${R}`])).id;
  const jwt = await new SignJWT({ uid: DUENO_B, empresa: EB.id, nombre: "Dueño Vecina", rol: "dueno", v: 0 }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h")
    .sign(new TextEncoder().encode(process.env.REGENTA_SESSION_SECRET ?? "prueba-local-0123456789abcdef0123456789abcdef"));
  const ctx = await b.newContext(); await ctx.addCookies([{ name: "regenta_sesion", value: jwt, url: B }]);
  const p = await ctx.newPage(); await p.goto(B + "/compras");
  const r = await leer(p, `vecina-${R}.xml`, "text/xml", XML1);
  ok(r.status === 200 && !!r.j.archivo_id, "droguería real: el archivo original queda guardado", r.j.error);
  ok(r.j.documento.lineas.every((l) => !l.producto), "en otra droguería no empareja con productos ajenos");
  const reg = await p.evaluate(async ([a, pid, n, nit]) => (await fetch("/api/compras", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
    idem_key: crypto.randomUUID(), proveedor_nuevo: { nombre: "Mayorista Vecina", nit }, numero_factura: n, fecha_factura: "2026-11-04",
    lineas: [{ producto_id: pid, lote: "LV1", vence: "2029-01-31", unidades: 2, bonificadas: 0, costo: 3000, costo_por: "unidad", descuento_pct: 0, iva_pct: 0 }],
    archivo_id: a, recordar: [{ clave: "txt:producto raro", producto_id: pid, como: "unidad" }] }) })).status, [r.j.archivo_id, prodB, `FPV-${R}`, NIT_PROV]);
  ok(reg === 201, "compra registrada desde el archivo", String(reg));
  const arch = await q1(`select a.empresa_id, a.compra_id, a.tamano, a.documento->>'numero' numero, c.numero_factura from compra_archivos a left join compras c on c.id = a.compra_id where a.id = $1`, [r.j.archivo_id]);
  ok(arch?.empresa_id === EB.id && arch.numero_factura === `FPV-${R}` && arch.tamano === XML1.length && arch.numero === `FP-${R}`, "archivo enlazado a la compra con lo leído", JSON.stringify(arch));
  // Seguridad por fila: el dueño de la demo no ve el archivo de la droguería vecina (consulta directa como su usuario).
  const c = await pool.connect();
  try {
    const duenoDemo = (await c.query(`select user_id from miembros where empresa_id = $1 and rol = 'dueno' limit 1`, [DEMO.id])).rows[0].user_id;
    await c.query(`begin; select set_config('request.jwt.claims', $1, true); set local role authenticated`, [JSON.stringify({ sub: duenoDemo, role: "authenticated" })]);
    const vistos = (await c.query(`select count(*)::int n from compra_archivos where empresa_id = $1`, [EB.id])).rows[0].n;
    const memoria = (await c.query(`select count(*)::int n from proveedor_productos where empresa_id = $1`, [EB.id])).rows[0].n;
    ok(vistos === 0 && memoria === 0, "aislamiento: otra droguería no ve el archivo ni la memoria de proveedores (RLS)", `${vistos}/${memoria}`);
    let negado = false;
    try { await c.query(`select guardar_archivo_compra($1, 'x', 'application/xml', '\\x3c'::bytea, $2, null)`, [EB.id, "a".repeat(64)]); } catch (e) { negado = /permiso|cargan/i.test(e.message); }
    ok(negado, "aislamiento: no puede guardar archivos en el espacio de otra droguería");
    await c.query("rollback");
  } finally { c.release(); }
  await ctx.close();
}

// ───────────── Celular: la pantalla de revisión cabe y se usa con el dedo
{
  const { ctx, p, errs } = await entrar("Carlos", { ...devices["iPhone 13"] });
  await p.goto(B + "/compras/nueva"); await p.waitForLoadState("networkidle");
  await p.locator('input[aria-label="Archivo de la factura"]').setInputFiles({ name: "m.xml", mimeType: "text/xml", buffer: Buffer.from(factura(`FP-${R}-M`)) });
  await p.getByText(/ya encontrado/).waitFor({ timeout: 30000 });
  const des = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  ok(des <= 0, "celular: sin desborde horizontal", `${des}px`);
  const chicos = await p.evaluate(() => [...document.querySelectorAll("main button, main input:not([type=checkbox]):not([type=radio]):not([type=file]), main select")]
    .filter((e) => { const r = e.getBoundingClientRect(); return r.width > 0 && r.height < 44 && !e.closest(".sr-only"); }).map((e) => `${e.tagName} ${e.textContent?.trim().slice(0, 20)} ${Math.round(e.getBoundingClientRect().height)}`));
  ok(chicos.length === 0, "celular: todo lo que se toca mide 44 px o más", chicos.slice(0, 4).join(" | "));
  ok(errs.length === 0, "celular: sin errores de consola", errs.slice(0, 3).join(" | "));
  await ctx.close();
}

await b.close(); mock.close(); await pool.end();
console.log(`\n${fallos} fallos`);
process.exit(fallos ? 1 : 0);
