// DIAN complementaria (Bloque 3-B), de punta a punta en el modo simulado:
// compra a un proveedor no obligado a facturar → «Generar documento soporte» → aceptado (simulado) con CUDS y XML de prueba
// marcado; nota de ajuste que lo anula y libera la compra; documento soporte semanal de 3 compras → 1 documento, y la misma
// compra no entra dos veces (pantalla y API); proveedor obligado → sin botón y API 4xx; nota débito sobre una factura;
// /documentos con los tipos nuevos, filtro, descarga de un XML y del ZIP del rango; la consola carga la numeración de
// documento soporte de otra droguería; cajera y bodega 403; aislamiento entre empresas; celular sin desbordes; sin errores
// de consola. Guarda capturas de escritorio (1440) e iPhone 13 en test-results/dian-soporte/.
// Uso: servidor con la base sembrada → BASE=http://localhost:4532 DATABASE_URL=… node tests/e2e/dian-soporte.mjs
import { chromium, devices } from "playwright-core";
import { mkdirSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { SignJWT } from "jose";
import pg from "pg";
import { codigoTotp, olvidarUltimo, TOTP } from "../ayudas/totp.mjs";

const B = process.env.BASE ?? "http://localhost:4500";
const DB = process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/regenta?host=/tmp";
const OUT = process.env.OUT ?? "test-results/dian-soporte";
mkdirSync(OUT, { recursive: true });
const pool = new pg.Pool({ connectionString: DB });
let fallos = 0;
const ok = (c, m, x = "") => { console.log(`${c ? "PASS" : "FAIL"} ${m}${x ? " — " + x : ""}`); if (!c) fallos++; };
const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium" });
// Las pruebas funcionales entran a la demo sin las ofertas del embudo (las prueba embudo.mjs).
{ const nc = b.newContext.bind(b); b.newContext = async (o) => { const c = await nc(o); await c.addInitScript(() => { try { sessionStorage.setItem("regenta_demo_v1", JSON.stringify({ hechos: [], ofertas: ["prueba", "prueba"], cerrada: true, inicio: Date.now() })); } catch {} }); return c; }; }

const vigilar = (p) => { const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => m.type() === "error" && errs.push(m.text())); return errs; };
async function entrar(quien, opciones = { viewport: { width: 1440, height: 900 } }) {
  const ctx = await b.newContext({ acceptDownloads: true, ...opciones });
  const p = await ctx.newPage();
  const errs = vigilar(p);
  await p.goto(B + "/entrar"); await p.getByRole("button", { name: new RegExp(quien) }).click(); await p.waitForURL(/\/(caja|inicio)/);
  return { ctx, p, errs };
}
const ir = async (p, ruta) => { await p.goto(B + ruta); await p.waitForLoadState("networkidle"); };
const api = async (p, url, metodo = "GET", cuerpo) => {
  const r = await p.evaluate(async ([u, m, c]) => {
    const r = await fetch(u, { method: m, headers: c === undefined ? {} : { "content-type": "application/json" }, body: c === undefined ? undefined : JSON.stringify(c) });
    const t = r.headers.get("content-type") ?? "";
    return { status: r.status, tipo: t, j: t.includes("json") ? await r.json().catch(() => ({})) : {}, texto: t.includes("xml") ? await r.text() : "" };
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

const EMP = await q1(`select e.id, (select id from sedes where empresa_id = e.id order by creado limit 1) sede_id from empresas e where e.demo limit 1`);
const EB = await q1(`select id from empresas where not demo and nit = '900000002'`);
const DUENO_B = "00000000-0000-4000-8000-000000000004";
const R = Date.now().toString().slice(-7);
const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
const MARCA = "DOCUMENTO SIMULADO POR REGENTA";

// La demo necesita numeración (de pruebas: emite en simulado) de los tipos nuevos. La siembra la tendrá (ver la entrega);
// mientras tanto se carga aquí si falta, igual que la cargaría la consola.
for (const [tipo, prefijo] of [["soporte", "DSSE"], ["ajuste_soporte", "NASE"], ["nota_debito", "NDSE"]])
  if (!(await q1(`select 1 x from resoluciones_dian where empresa_id = $1 and tipo = $2 and activa`, [EMP.id, tipo])))
    await pool.query(`insert into resoluciones_dian (empresa_id, tipo, prefijo, desde, hasta, actual, vigente_hasta, pruebas) values ($1, $2, $3, 1, 1000000, 0, '2027-12-31', true)`, [EMP.id, tipo, prefijo]);

// Un producto con código y existencias para las compras.
const P = await q1(`select p.id, p.nombre from productos p where p.empresa_id = $1 and p.activo and not p.requiere_formula order by p.nombre limit 1`, [EMP.id]);

// ───────────── Dueño, escritorio
const D = await entrar("Carlos");
const { p } = D;
const proveedor = async (nombre, obligado) => {
  const r = await api(p, "/api/proveedores", "POST", { nombre, nit: obligado ? `9001${R}` : `1110${R}`, obligado_facturar: obligado, responsable_iva: obligado });
  ok(r.status === 201, `proveedor ${obligado ? "obligado" : "no obligado"} creado`, `${r.status} ${r.j.error ?? ""}`);
  return r.j.id ?? r.j.proveedor?.id;
};
const PROV = `Campesino E2E ${R}`, PROV_OB = `Laboratorio E2E ${R}`;
const provNo = await proveedor(PROV, false), provSi = await proveedor(PROV_OB, true);
let nf = 0;
const comprar = async (prov, costo) => {
  const r = await api(p, "/api/compras", "POST", { idem_key: crypto.randomUUID(), proveedor_id: prov, numero_factura: `DS${R}-${++nf}`, fecha_factura: hoy, condicion: "contado",
    lineas: [{ producto_id: P.id, lote: `DS${R}${nf}`, vence: "2030-12-31", unidades: 10, costo, costo_por: "unidad", iva_pct: 0 }] });
  ok(r.status === 201 && r.j.estado === "registrada", `compra ${nf} registrada con costos`, `${r.status} ${r.j.error ?? ""}`);
  return r.j.id;
};
const K1 = await comprar(provNo, 1200);

// 1) Documento soporte por operación desde la ficha de la compra
await ir(p, `/compras/${K1}`);
await p.getByRole("heading", { name: "Documento soporte" }).waitFor({ timeout: 15000 });
ok(/no está obligado a facturar/.test(await p.locator('section[aria-labelledby="soporte-t"]').innerText()), "la ficha explica por qué lleva documento soporte");
await p.getByRole("button", { name: "Generar documento soporte" }).click();
const st1 = p.getByRole("status").filter({ hasText: /Documento soporte DSSE\d+ generado/ });
await st1.waitFor({ timeout: 15000 });
ok(/\(simulado\)/.test(await st1.innerText()), "el documento soporte queda aceptado en simulado", await st1.innerText());
const DS1 = await q1(`select d.id, d.prefijo || d.numero numero, d.estado, d.simulado, d.cufe, d.xml, d.total::float, d.compra_id from documentos_dian d where d.compra_id = $1 and d.tipo = 'soporte'`, [K1]);
ok(DS1?.estado === "aceptado" && DS1.simulado && /^[0-9a-f]{96}$/.test(DS1.cufe ?? ""), "aceptado con CUDS (simulado)", JSON.stringify({ estado: DS1?.estado, cufe: DS1?.cufe?.slice(0, 10) }));
ok(DS1?.xml?.includes(MARCA) && DS1.xml.includes(`<CUDS>${DS1.cufe}</CUDS>`) && DS1.xml.includes(PROV), "guarda el XML de prueba marcado con el CUDS y el proveedor");
ok(DS1?.total === 12000, "el total del documento es el de la compra", String(DS1?.total));
await p.locator('section[aria-labelledby="soporte-t"] summary', { hasText: "CUDS" }).click();
ok(await p.getByText(DS1.cufe).count() === 1, "la ficha muestra el CUDS");
ok(await p.getByRole("link", { name: `Descargar el XML de ${DS1.numero}` }).count() === 1, "la ficha ofrece el XML");
ok(await p.getByRole("button", { name: "Generar documento soporte" }).count() === 0, "ya no ofrece generar otro para la misma compra");
await p.screenshot({ path: `${OUT}/compra-soporte-1440.png`, fullPage: true });
const otra = await api(p, "/api/dian/soporte", "POST", { compras: [K1], semanal: false, idem_key: crypto.randomUUID() });
ok(otra.status === 422 && /ya está en el documento soporte/.test(otra.j.error), "la API no repite la compra", `${otra.status} ${otra.j.error}`);

// 2) Nota de ajuste que lo anula (y libera la compra)
await p.getByRole("button", { name: "Nota de ajuste" }).click();
await p.fill("#ajuste-motivo", "La factura del campesino se registró con otro valor");
await p.screenshot({ path: `${OUT}/nota-ajuste-1440.png`, fullPage: true });
await p.getByRole("button", { name: "Generar nota de anulación" }).click();
const st2 = p.getByRole("status").filter({ hasText: /Nota de ajuste NASE\d+ generada/ });
await st2.waitFor({ timeout: 15000 });
const NA = await q1(`select d.id, d.prefijo || d.numero numero, d.estado, d.cufe, d.concepto, d.total::float, d.xml from documentos_dian d where d.origen_id = $1 and d.tipo = 'ajuste_soporte'`, [DS1.id]);
ok(NA?.estado === "aceptado" && NA.concepto === "anulacion" && NA.total === 12000 && NA.cufe && NA.xml.includes(`<Referencia numero="${DS1.numero}">`), "la nota de ajuste anula el documento soporte (aceptada, con referencia)", JSON.stringify({ e: NA?.estado, t: NA?.total }));
ok((await q1(`select liberada is not null l from soporte_compras where documento_id = $1`, [DS1.id])).l, "la compra queda libre");
await p.getByRole("button", { name: "Generar documento soporte" }).waitFor({ timeout: 10000 });
ok(new RegExp(`anteriores.*${DS1.numero}`).test(await p.locator('section[aria-labelledby="soporte-t"]').innerText()), "la ficha recuerda el documento anulado y vuelve a ofrecer generar");
const anular2 = await api(p, `/api/dian/soporte/${DS1.id}/ajuste`, "POST", { concepto: "anulacion", motivo: "Otra vez", idem_key: crypto.randomUUID() });
ok(anular2.status === 422 && /ya está anulado/.test(anular2.j.error), "no se anula dos veces", anular2.j.error);

// 3) Documento soporte semanal: 3 compras → 1 documento; una compra nunca en dos
const [K2, K3, K4] = [await comprar(provNo, 1000), await comprar(provNo, 2000), await comprar(provNo, 3000)];
await ir(p, `/compras/${K2}`);
const semanal = p.getByRole("group", { name: "Documento soporte semanal" });
await semanal.waitFor({ timeout: 15000 });
const casillas = semanal.getByRole("checkbox");
ok(await casillas.count() === 4, "el semanal lista las 4 compras de la semana sin documento (incluida la liberada)", String(await casillas.count()));
await semanal.locator("label", { hasText: /Compra N\.º \d+ · factura DS\d+-1 / }).getByRole("checkbox").uncheck();
const botonSem = semanal.getByRole("button", { name: /Documento soporte semanal \(3 compras/ });
ok(await botonSem.count() === 1, "el botón dice 3 compras y el total");
await p.screenshot({ path: `${OUT}/semanal-1440.png`, fullPage: true });
await botonSem.click();
await p.getByRole("status").filter({ hasText: /Documento soporte DSSE\d+ generado/ }).waitFor({ timeout: 15000 });
const SEM = await q1(`select d.id, d.prefijo || d.numero numero, d.compra_id, d.estado, d.total::float, (select count(*)::int from soporte_compras s where s.documento_id = d.id) n,
  (select array_agg(s.compra_id::text order by s.compra_id) from soporte_compras s where s.documento_id = d.id) compras
  from documentos_dian d join soporte_compras s on s.documento_id = d.id where s.compra_id = $1 and s.liberada is null`, [K2]);
ok(SEM?.n === 3 && SEM.compra_id === null && SEM.total === 60000 && SEM.estado === "aceptado", "un solo documento semanal con las 3 compras", JSON.stringify(SEM));
ok(JSON.stringify(SEM?.compras) === JSON.stringify([K2, K3, K4].sort()), "son exactamente las 3 compras elegidas");
ok(/semanal/.test(await p.locator('section[aria-labelledby="soporte-t"]').innerText()), "la ficha muestra el documento semanal");
for (const [m, cuerpo] of [["por operación", { compras: [K3], semanal: false }], ["semanal", { compras: [K1, K4], semanal: true }]]) {
  const r = await api(p, "/api/dian/soporte", "POST", { ...cuerpo, idem_key: crypto.randomUUID() });
  ok(r.status === 422 && /ya está en el documento soporte/.test(r.j.error), `una compra del semanal no entra en otro (${m})`, `${r.status} ${r.j.error}`);
}
const idem = crypto.randomUUID();
const i1 = await api(p, "/api/dian/soporte", "POST", { compras: [K1], semanal: false, idem_key: idem });
const i2 = await api(p, "/api/dian/soporte", "POST", { compras: [K1], semanal: false, idem_key: idem });
ok(i1.status === 201 && i2.status === 200 && i1.j.id === i2.j.id && i2.j.repetido, "el reintento con la misma clave no duplica (idempotencia)", `${i1.status} ${i2.status}`);
const DS2 = i1.j;

// 4) Proveedor obligado a facturar: sin botón y la API lo rechaza
const K5 = await comprar(provSi, 800);
await ir(p, `/compras/${K5}`);
await p.getByRole("heading", { name: /Compra N\.º/ }).waitFor();
ok(await p.getByRole("heading", { name: "Documento soporte" }).count() === 0 && await p.getByRole("button", { name: "Generar documento soporte" }).count() === 0, "compra a proveedor obligado: sin sección ni botón");
const ob = await api(p, "/api/dian/soporte", "POST", { compras: [K5], idem_key: crypto.randomUUID() });
ok(ob.status === 422 && /obligado a facturar/.test(ob.j.error), "la API rechaza el documento soporte de un proveedor obligado", `${ob.status} ${ob.j.error}`);

// 5) Nota débito sobre una factura (concepto con valor)
const FAC = await q1(`select d.id, d.prefijo || d.numero numero, to_char(v.creado at time zone 'America/Bogota', 'YYYY-MM-DD') dia from documentos_dian d join ventas v on v.id = d.venta_id
  where d.empresa_id = $1 and d.tipo = 'factura' and d.estado = 'aceptado' and v.estado = 'cerrada' order by v.creado desc limit 1`, [EMP.id]);
ok(!!FAC, "la demo tiene una factura aceptada", FAC?.numero);
await ir(p, `/documentos?tipo=factura&desde=${FAC.dia}&hasta=${FAC.dia}`);
await p.getByRole("link", { name: `Nota débito de ${FAC.numero}` }).first().waitFor({ timeout: 15000 });
await Promise.all([p.waitForURL(new RegExp(`/documentos/nota-debito/${FAC.id}`)), p.getByRole("link", { name: `Nota débito de ${FAC.numero}` }).first().click()]);
await p.waitForLoadState("networkidle");
// La demo no es responsable de IVA: la nota débito va sin IVA (no se ofrece la tarifa). Para probar el IVA, responsable.
ok(await p.locator("#nd-iva").count() === 0, "no responsable de IVA: la nota débito no ofrece tarifa de IVA");
await pool.query(`update empresas set responsable_iva = true where id = $1`, [EMP.id]);
await p.reload(); await p.waitForLoadState("networkidle");
await p.fill("#nd-concepto", "Flete del domicilio");
await p.fill("#nd-valor", "10.000");
await p.selectOption("#nd-iva", "19");
await p.fill("#nd-motivo", "Se cobró el domicilio después de facturar");
ok(/Total de la nota \(con IVA\): \$11\.900/.test(await p.locator("main").innerText()), "calcula el total con IVA antes de guardar");
await p.screenshot({ path: `${OUT}/nota-debito-1440.png`, fullPage: true });
await p.getByRole("button", { name: "Generar nota débito" }).click();
const st3 = p.getByRole("status").filter({ hasText: /Nota débito NDSE\d+ por \$11\.900 generada/ });
await st3.waitFor({ timeout: 15000 });
const ND = await q1(`select d.id, d.prefijo || d.numero numero, d.estado, d.cufe, d.total::float, d.xml from documentos_dian d where d.origen_id = $1 and d.tipo = 'nota_debito' order by d.creado desc limit 1`, [FAC.id]);
ok(ND?.estado === "aceptado" && ND.total === 11900 && ND.cufe && ND.xml.includes(`<Referencia numero="${FAC.numero}">`), "nota débito aceptada (simulado) con referencia a la factura", JSON.stringify({ e: ND?.estado, t: ND?.total }));
ok(await p.getByRole("list").filter({ hasText: ND.numero }).count() >= 1, "la pantalla lista la nota débito sin recargar");
await pool.query(`update empresas set responsable_iva = false where id = $1`, [EMP.id]);

// 6) /documentos: tipos nuevos, filtro, XML y ZIP
await ir(p, `/documentos?tipo=soporte&desde=${hoy}&hasta=${hoy}`);
const tabla = p.getByRole("table", { name: "Documentos electrónicos" });
await tabla.waitFor({ timeout: 15000 });
const txt = await tabla.innerText();
ok(txt.includes(DS1.numero) && txt.includes(SEM.numero) && txt.includes(PROV) && !txt.includes(ND.numero), "el filtro «Documento soporte» muestra solo los soportes, con el proveedor", txt.slice(0, 200));
ok(new RegExp(`${DS1.numero}[\\s\\S]*Anulado con ${NA.numero}`).test(txt), "el soporte anulado dice con qué nota");
ok(/3 compras \(N\.º/.test(txt), "el semanal dice cuántas compras soporta");
ok(await p.locator('select[name="tipo"] option[value="soporte"]').count() === 1 && await p.locator('select[name="tipo"] option[value="nota_debito"]').count() === 1 && await p.locator('select[name="tipo"] option[value="ajuste_soporte"]').count() === 1, "el filtro de tipo tiene los tipos nuevos");
await p.locator("tr", { hasText: SEM.numero }).locator("summary", { hasText: "CUDS" }).click();
await p.screenshot({ path: `${OUT}/documentos-soporte-1440.png`, fullPage: true });
const [descarga] = await Promise.all([p.waitForEvent("download"), p.getByRole("link", { name: `Descargar el XML de ${SEM.numero}` }).click()]);
const xmlBajado = readFileSync(await descarga.path(), "utf8");
ok(descarga.suggestedFilename() === `${SEM.numero}.xml` && xmlBajado.includes(MARCA) && xmlBajado.startsWith("<?xml"), "descarga el XML de un documento", descarga.suggestedFilename());
const x1 = await api(p, `/api/documentos/${ND.id}/xml`);
ok(x1.status === 200 && /application\/xml/.test(x1.tipo) && x1.texto.includes("<CUDE>"), "la API del XML responde con el XML", `${x1.status} ${x1.tipo}`);
await ir(p, `/documentos?desde=${hoy}&hasta=${hoy}`);
const [zipD] = await Promise.all([p.waitForEvent("download"), p.getByRole("link", { name: "Descargar XML (ZIP)" }).click()]);
const zipB = readFileSync(await zipD.path());
const nombres = (() => { const n = []; for (let i = 0; i + 46 <= zipB.length; i++) if (zipB.readUInt32LE(i) === 0x02014b50) { const l = zipB.readUInt16LE(i + 28); n.push(zipB.subarray(i + 46, i + 46 + l).toString("utf8")); } return n; })();
const esperados = await pool.query(`select d.tipo || '/' || d.prefijo || d.numero || '.xml' n from documentos_dian d left join documentos_dian o on o.id = d.origen_id left join ventas v on v.id = coalesce(d.venta_id, o.venta_id)
  where d.empresa_id = $1 and d.xml is not null and (case when d.tipo in ('pos', 'factura') then v.creado else d.creado end) >= ($2::date)::timestamp at time zone 'America/Bogota'
    and (case when d.tipo in ('pos', 'factura') then v.creado else d.creado end) < ($2::date + 1)::timestamp at time zone 'America/Bogota'`, [EMP.id, hoy]);
ok(zipB.subarray(0, 2).toString() === "PK" && nombres.length === esperados.rowCount && [`soporte/${DS1.numero}.xml`, `soporte/${SEM.numero}.xml`, `ajuste_soporte/${NA.numero}.xml`, `nota_debito/${ND.numero}.xml`].every((n) => nombres.includes(n)),
  "el ZIP trae los XML del rango (incluidos los tipos nuevos)", `${nombres.length} de ${esperados.rowCount}: ${nombres.filter((n) => !n.startsWith("pos/")).join(", ")}`);
const vacio = await api(p, `/api/documentos/xml?desde=2025-11-07&hasta=2025-11-07`);
ok(vacio.status === 404 && /No hay XML/.test(vacio.j.error), "sin XML en el rango: mensaje claro", vacio.j.error);
const csv = await p.evaluate(async (u) => new Uint8Array(await (await fetch(u)).arrayBuffer()).slice(0, 3).join(","), `/api/documentos?tipo=nota_debito&desde=${hoy}&hasta=${hoy}`);
ok(csv === "239,187,191", "el CSV de documentos sigue con BOM");
const sinPermisoDoc = await api(p, `/api/documentos/00000000-0000-4000-8000-000000000000/xml`);
ok(sinPermisoDoc.status === 404, "un XML que no existe da 404");
ok(sinProvocados(p, D.errs).length === 0, "sin errores de consola (dueño)", sinProvocados(p, D.errs).join(" | "));

// ───────────── Cajera y bodega: 403 en todo
for (const quien of ["Laura", "Andrés"]) {
  const { ctx, p: q, errs } = await entrar(quien);
  const pruebas = [["GET", `/api/dian/soporte?compra=${K2}`], ["POST", "/api/dian/soporte", { compras: [K1] }], ["POST", `/api/dian/soporte/${DS1.id}/ajuste`, { concepto: "anulacion", motivo: "Intento" }],
    ["GET", `/api/dian/nota-debito?factura=${FAC.id}`], ["POST", "/api/dian/nota-debito", { documento_id: FAC.id, motivo: "Intento", lineas: [{ descripcion: "Flete", valor: 1 }] }],
    ["GET", `/api/documentos/${DS1.id}/xml`], ["GET", `/api/documentos/xml?desde=${hoy}&hasta=${hoy}`], ["POST", `/api/documentos/${DS2.id}/reenviar`, {}]];
  for (const [m, u, c] of pruebas) { const r = await api(q, u, m, c); ok(r.status === 403, `${quien}: 403 en ${m} ${u.split("?")[0]}`, `${r.status} ${r.j.error ?? ""}`); }
  if (quien === "Andrés") {
    await ir(q, `/compras/${K1}`);
    await q.getByRole("heading", { name: /Compra N\.º/ }).waitFor();
    ok(await q.getByRole("heading", { name: "Documento soporte" }).count() === 0, "la bodega ve la compra sin el documento soporte");
  }
  await ir(q, `/documentos/nota-debito/${FAC.id}`);
  ok(!/nota-debito/.test(q.url()), `${quien} no entra a la nota débito`, q.url());
  ok(sinProvocados(q, errs).length === 0, `sin errores de consola (${quien})`, sinProvocados(q, errs).join(" | "));
  await ctx.close();
}

// ───────────── Aislamiento: el dueño de otra droguería no ve ni toca nada de A
{
  const jwt = await new SignJWT({ uid: DUENO_B, empresa: EB.id, nombre: "Dueño Vecina", rol: "dueno", v: 0 }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h")
    .sign(new TextEncoder().encode(process.env.REGENTA_SESSION_SECRET ?? "prueba-local-0123456789abcdef0123456789abcdef"));
  const ctx = await b.newContext();
  await ctx.addCookies([{ name: "regenta_sesion", value: jwt, url: B }]);
  const q = await ctx.newPage(); const errs = vigilar(q);
  await ir(q, "/inicio");
  const pruebas = [["GET", `/api/dian/soporte?compra=${K1}`, 404], ["POST", "/api/dian/soporte", 404, { compras: [K1], idem_key: crypto.randomUUID() }],
    ["POST", `/api/dian/soporte/${DS2.id}/ajuste`, 404, { concepto: "anulacion", motivo: "Ataque" }], ["GET", `/api/dian/nota-debito?factura=${FAC.id}`, 404],
    ["POST", "/api/dian/nota-debito", 404, { documento_id: FAC.id, motivo: "Ataque", lineas: [{ descripcion: "Flete", valor: 1 }] }],
    ["GET", `/api/documentos/${DS2.id}/xml`, 404], ["POST", `/api/documentos/${DS2.id}/reenviar`, 404, {}]];
  for (const [m, u, st, c] of pruebas) { const r = await api(q, u, m, c); ok(r.status === st, `B recibe ${st} en ${m} ${u.split("?")[0]}`, `${r.status} ${r.j.error ?? ""}`); }
  const zipB2 = await api(q, `/api/documentos/xml?desde=${hoy}&hasta=${hoy}&tipo=soporte`);
  ok(zipB2.status === 404, "el ZIP de B no trae documentos de A", String(zipB2.status));
  await ir(q, `/documentos?tipo=soporte&desde=${hoy}&hasta=${hoy}`);
  ok(!(await q.locator("main").innerText()).includes(DS1.numero), "B no ve los documentos soporte de A en /documentos");
  const r = await q.goto(B + `/documentos/nota-debito/${FAC.id}`);
  await q.waitForLoadState("networkidle");
  ok(/404/.test(await q.locator("body").innerText()) && !(await q.locator("body").innerText()).includes(FAC.numero), "B no abre la nota débito de una factura de A", String(r.status()));
  ok((await q1(`select count(*)::int n from documentos_dian where empresa_id = $1 and tipo in ('soporte', 'ajuste_soporte', 'nota_debito')`, [EB.id])).n === 0, "nada se creó en B");
  ok(sinProvocados(q, errs).filter((e) => !/status of 404/.test(e)).length === 0, "sin errores de consola (dueño B)", sinProvocados(q, errs).join(" | "));
  await ctx.close();
}

// ───────────── Consola: carga la numeración de documento soporte de una droguería
{
  const ADMIN = { email: `admin-ds${R}@regenta.test`, clave: "ConsolaSoporte2026" };
  execFileSync("node", ["scripts/crear-superadmin.mjs", ADMIN.email, "Admin Soporte"], { env: { ...process.env, REGENTA_CLAVE_PRUEBA: ADMIN.clave, REGENTA_TOTP_PRUEBA: TOTP, DATABASE_URL: DB } });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const q = await ctx.newPage(); const errs = vigilar(q);
  await q.goto(B + "/admin/entrar");
  await q.fill("#a-email", ADMIN.email); await q.fill("#a-clave", ADMIN.clave);
  await q.getByRole("button", { name: "Entrar" }).click(); await q.locator("#a-codigo").waitFor();
  await olvidarUltimo(pool, ADMIN.email); await q.fill("#a-codigo", codigoTotp());
  await Promise.all([q.waitForURL(/\/admin$/), q.getByRole("button", { name: "Entrar" }).click()]);
  await ir(q, `/admin/clientes/${EB.id}`);
  const fac = q.getByRole("region", { name: "Facturación electrónica" });
  await fac.getByText("Cargar numeración autorizada por la DIAN").click();
  await fac.getByLabel("Tipo de documento").selectOption("soporte");
  await fac.getByLabel("Prefijo", { exact: true }).fill("DSB");
  await fac.getByLabel("Desde", { exact: true }).fill("1"); await fac.getByLabel("Hasta", { exact: true }).fill("5000");
  await fac.getByLabel("Es de pruebas (habilitación)").check();
  await fac.getByRole("button", { name: "Guardar numeración" }).click();
  await fac.getByRole("status").filter({ hasText: "Numeración guardada" }).waitFor({ timeout: 10000 });
  const res = await q1(`select prefijo, desde::int, hasta::int, actual::int, pruebas, activa from resoluciones_dian where empresa_id = $1 and tipo = 'soporte'`, [EB.id]);
  ok(res?.prefijo === "DSB" && res.hasta === 5000 && res.actual === 0 && res.pruebas && res.activa, "la consola carga la numeración de documento soporte", JSON.stringify(res));
  await q.waitForLoadState("load"); await ir(q, `/admin/clientes/${EB.id}`);
  ok(/Documento soporte DSB/.test(await q.locator("main").innerText()), "la ficha del cliente lista la numeración de documento soporte");
  ok(await q.getByRole("button", { name: "Activar envío real" }).isDisabled(), "el envío real no se activa sin numeración de producción");
  const act = await q.evaluate(async (u) => { const r = await fetch(u, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ complementario: true }) }); return { s: r.status, j: await r.json() }; }, `/api/admin/clientes/${EB.id}`);
  ok(act.s === 400 && /numeración de documento soporte de producción/.test(act.j.error), "la API tampoco lo activa sin numeración de producción", act.j.error);
  await q.screenshot({ path: `${OUT}/consola-numeracion-1440.png`, fullPage: true });
  ok(errs.filter((e) => !/status of 400/.test(e)).length === 0, "sin errores de consola (superadministración)", errs.join(" | "));
  await ctx.close();
}

// ───────────── Celular (iPhone 13): sin desbordes, con capturas
{
  const { ctx, p: q, errs } = await entrar("Carlos", { ...devices["iPhone 13"] });
  const pantallas = [[`/compras/${K1}`, "compra-soporte"], [`/compras/${K2}`, "compra-semanal"], [`/documentos?tipo=soporte&desde=${hoy}&hasta=${hoy}`, "documentos-soporte"],
    [`/documentos?desde=${hoy}&hasta=${hoy}`, "documentos"], [`/documentos/nota-debito/${FAC.id}`, "nota-debito"]];
  for (const [ruta, nombre] of pantallas) {
    await ir(q, ruta);
    const d = await desborde(q);
    ok(d <= 0, `sin desborde horizontal en el celular: ${nombre}`, `${d}px`);
    const c = await cortados(q);
    ok(c.length === 0, `nada se sale de la pantalla en el celular: ${nombre}`, c.join(", "));
    await q.screenshot({ path: `${OUT}/${nombre}-iphone13.png` });
    const alto = await q.evaluate(() => document.documentElement.scrollHeight);
    await q.screenshot({ path: `${OUT}/${nombre}-iphone13-completa.png`, fullPage: true, clip: { x: 0, y: 0, width: 390, height: Math.min(alto, 2600) } });
  }
  // Nota de ajuste de corrección desde el celular (sobre el documento por operación de K1)
  await ir(q, `/compras/${K1}`);
  await q.getByRole("button", { name: "Nota de ajuste" }).click();
  await q.getByText("Corregir el valor").click();
  await q.fill("#ajuste-concepto", "Precio mal liquidado"); await q.fill("#ajuste-valor", "1.500"); await q.fill("#ajuste-motivo", "El campesino cobró menos");
  ok(await desborde(q) <= 0, "el formulario de ajuste no desborda en el celular");
  await q.screenshot({ path: `${OUT}/nota-ajuste-iphone13.png`, fullPage: true });
  await q.getByRole("button", { name: "Generar nota de corrección" }).click();
  await q.getByRole("status").filter({ hasText: /Nota de ajuste NASE\d+ generada/ }).waitFor({ timeout: 15000 });
  const cor = await q1(`select total::float, concepto from documentos_dian where origen_id = $1 order by creado desc limit 1`, [DS2.id]);
  ok(cor?.concepto === "correccion" && cor.total === 1500, "la corrección baja el valor del documento soporte", JSON.stringify(cor));
  ok(sinProvocados(q, errs).length === 0, "sin errores de consola (celular)", sinProvocados(q, errs).join(" | "));
  await ctx.close();
}

await D.ctx.close();
await b.close(); await pool.end();
console.log(`\n${fallos} fallos`);
process.exit(fallos ? 1 : 0);
