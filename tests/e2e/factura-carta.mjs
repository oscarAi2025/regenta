// Factura en tamaño carta (logo, cliente completo, una fila por producto con sus lotes, totales que cuadran con la base,
// valor en letras, una sola hoja), logo de la droguería (dueño sí, cajera no, SVG no), la caja ofrece carta o tirilla,
// el inventario se descarga en Excel (costos solo para gerencia) y se pagina sin cortar productos.
// Uso: servidor con REGENTA_DEMO=1 y la base recién sembrada → node tests/e2e/factura-carta.mjs
import { chromium } from "playwright-core";
import pg from "pg";
import { readFileSync } from "node:fs";

const B = process.env.BASE ?? "http://localhost:4500";
const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/regenta?host=/tmp" });
let fallos = 0;
const ok = (c, m, x = "") => { console.log(`${c ? "PASS" : "FAIL"} ${m}${x ? " — " + x : ""}`); if (!c) fallos++; };
const q = async (sql, v = []) => (await pool.query(sql, v)).rows;
const pesos = (n) => "$" + Math.round(n).toLocaleString("es-CO");
const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium" });
{ const nc = b.newContext.bind(b); b.newContext = async (o) => { const c = await nc(o); await c.addInitScript(() => {
  try { sessionStorage.setItem("regenta_demo_v1", JSON.stringify({ hechos: [], ofertas: ["prueba", "prueba"], cerrada: true, inicio: Date.now() })); } catch {}
  window.print = () => { window.__impreso = (window.__impreso ?? 0) + 1; };
}); return c; }; }
async function entrar(quien) {
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => m.type() === "error" && !/status of 4\d\d/.test(m.text()) && errs.push(m.text()));
  await p.goto(B + "/entrar"); await p.getByRole("button", { name: new RegExp(quien) }).click(); await p.waitForURL(/\/(caja|inicio)/);
  return { ctx, p, errs };
}
const PNG = "data:image/png;base64," + readFileSync(new URL("../../public/qr-pago.png", import.meta.url)).toString("base64");

// ── Dueño: logo, factura carta, caja, venta, Excel, paginación
{
  const { ctx, p, errs } = await entrar("Carlos");
  const api = (m, u, d) => p.request.fetch(B + u, { method: m, headers: { origin: B }, data: d });
  let r = await api("PUT", "/api/empresa/logo", { logo: "data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=" });
  ok(r.status() === 400, "no acepta un logo SVG", `${r.status()}`);
  r = await api("PUT", "/api/empresa/logo", { logo: "data:image/png;base64," + "A".repeat(400001) });
  ok(r.status() === 400, "no acepta un logo demasiado pesado", `${r.status()}`);
  r = await api("PUT", "/api/empresa/logo", { logo: PNG });
  ok(r.status() === 403 && /demo/.test((await r.json()).error), "en la demo pública no se sube logo (cualquiera la usa)", `${r.status()}`);
  await p.goto(B + "/equipo"); await p.waitForLoadState("networkidle");
  ok(await p.locator('[data-prueba="archivo-logo"]').count() === 0, "la demo no muestra el cargador de logo");
  const [e] = await q(`select e.id from empresas e where e.demo order by e.creado limit 1`);
  await pool.query(`update empresas set logo = $2 where id = $1`, [e.id, PNG]); // para ver el logo en la factura de la demo
  // Factura a crédito a un cliente con NIT, varias líneas, una partida en dos lotes y un descuento
  const cli = (await (await api("GET", "/api/clientes?q=salud")).json()).clientes[0];
  const [dos] = await q(`select p.id, p.nombre, p.unidades_por_caja upc, min(s.unidades)::int menor from productos p join v_stock_lotes s on s.producto_id = p.id join empresas e on e.id = p.empresa_id
    where e.demo and p.unidades_por_caja = 1 and s.unidades > 0 and (s.vence is null or s.vence > current_date) and not s.bloqueado group by p.id having count(*) >= 2 and min(s.unidades) between 1 and 30 order by p.nombre limit 1`);
  const prods = (await (await api("GET", "/api/productos?q=acetaminofen")).json()).productos.filter((x) => x.unidades >= 5 * x.unidades_por_caja && x.id !== dos.id).slice(0, 4);
  const lineas = [{ producto_id: dos.id, presentacion: "caja", cantidad: dos.menor + 1 }, ...prods.map((x, i) => ({ producto_id: x.id, presentacion: "caja", cantidad: 1, descuento_pct: i === 1 ? 5 : 0 }))];
  const v = await (await api("POST", "/api/ventas", { idem_key: crypto.randomUUID(), tipo_doc: "factura", cliente_id: cli.id, condicion: "credito", plazo_dias: 30, lineas, pagos: [] })).json();
  ok(!!v.venta?.venta_id, "se registra la factura de prueba", JSON.stringify(v).slice(0, 160));
  const id = v.venta.venta_id;
  await p.goto(B + `/tiquete/factura/${id}`); await p.waitForLoadState("networkidle");
  const txt = await p.locator("main").innerText();
  const [vt] = await q(`select v.total::float, v.prefijo || v.numero n, v.vence_pago::text vence, count(distinct (vl.producto_id, vl.precio, vl.presentacion))::int filas
    from ventas v join venta_lineas vl on vl.venta_id = v.id where v.id = $1 group by v.id`, [id]);
  ok(txt.includes(`No. ${vt.n}`) && /FACTURA ELECTRÓNICA DE VENTA/i.test(txt), "la factura carta lleva su título y número");
  ok(await p.locator("header img").getAttribute("src").then((x) => x?.startsWith("data:image/")), "la factura lleva el logo de la droguería");
  ok(txt.includes(cli.nombre) && txt.includes(cli.numero_doc) && txt.includes("Crédito a 30 días"), "trae el cliente con su documento y la forma de pago");
  ok(await p.locator("tbody tr").count() === vt.filas, "una fila por producto vendido (no una por lote)", `${await p.locator("tbody tr").count()} / ${vt.filas}`);
  const filaDos = p.locator("tbody tr", { hasText: dos.nombre });
  ok(await filaDos.locator(".lotes span").count() === 2 && !/,\d/.test(await filaDos.locator("td").nth(4).innerText()), "la partida de dos lotes muestra ambos lotes y la cantidad entera", await filaDos.innerText());
  ok(txt.includes(pesos(vt.total)) && /TOTAL A PAGAR/.test(txt), "el total coincide con la base", pesos(vt.total));
  ok(/pesos m\/cte/.test(txt) && /Valor en letras/.test(txt), "lleva el valor en letras");
  ok(/CUFE|Pendiente de validación DIAN/.test(txt) && /Software: Regenta/.test(txt), "lleva el CUFE (o el aviso) y el fabricante del software");
  await p.emulateMedia({ media: "print" });
  const pdf = await p.pdf({ format: "Letter", printBackground: true, preferCSSPageSize: true });
  const hojas = (pdf.toString("latin1").match(/\/Type\s*\/Page[^s]/g) ?? []).length;
  ok(hojas === 1, "una factura de 5 productos sale en una sola hoja carta", `${hojas} hojas`);
  await p.emulateMedia({ media: "screen" });
  ok(await p.getByRole("button", { name: /Imprimir/ }).count() >= 1, "la factura tiene su botón de imprimir");

  // Detalle de la venta y Documentos llevan a la factura carta
  await p.goto(B + `/ventas/${id}`); await p.waitForLoadState("networkidle");
  ok(await p.getByRole("button", { name: "Imprimir factura" }).isVisible() && await p.getByRole("link", { name: "Ver factura" }).getAttribute("href") === `/tiquete/factura/${id}` && await p.getByRole("button", { name: "Tirilla" }).isVisible(),
    "el detalle de una factura ofrece factura carta y tirilla");
  await p.getByRole("button", { name: "Imprimir factura" }).click();
  const marco = p.frameLocator('iframe[title="Tiquete"]');
  ok(await marco.locator(".fac").waitFor({ state: "attached", timeout: 10000 }).then(() => true, () => false), "«Imprimir factura» manda a imprimir la factura carta");

  // Caja: cobrar una factura imprime la carta por defecto y ofrece la tirilla
  await p.goto(B + "/caja"); await p.waitForLoadState("networkidle");
  await p.evaluate(() => localStorage.removeItem("regenta.impresora"));
  await p.reload(); await p.waitForLoadState("networkidle");
  await p.getByRole("button", { name: "Factura electrónica", exact: true }).click();
  await p.locator("#buscar").fill("acetaminofen"); await p.waitForSelector('[aria-label="Resultados"] [role="option"]');
  await p.locator('[role="option"]', { hasText: /\b([2-9]|\d{2,}) cajas/ }).first().getByRole("button").first().click();
  await p.locator("#cf-buscar").fill("salud vital"); await p.getByRole("button", { name: /IPS Salud Vital/ }).click();
  await p.keyboard.press("F9"); await p.waitForSelector("#recibido"); await p.fill("#recibido", "500000");
  await p.getByRole("button", { name: /^Facturar \$/ }).click();
  await p.getByText(/Factura electrónica registrada/).waitFor({ timeout: 15000 });
  ok(await p.frameLocator('iframe[title="Tiquete"]').last().locator(".fac").waitFor({ state: "attached", timeout: 10000 }).then(() => true, () => false), "al cobrar una factura se imprime la carta (preferencia por defecto)");
  ok(await p.getByRole("button", { name: /Imprimir factura/ }).isVisible() && await p.getByRole("button", { name: "Imprimir también la tirilla" }).isVisible() && await p.getByRole("link", { name: "Ver la factura" }).isVisible(),
    "después de cobrar ofrece factura, tirilla y ver la factura");
  await p.getByText("Impresora de esta caja").click();
  await p.getByLabel("Facturas electrónicas").selectOption("tirilla");
  ok(JSON.parse(await p.evaluate(() => localStorage.getItem("regenta.impresora"))).factura === "tirilla" && await p.getByRole("button", { name: "Imprimir la factura en tamaño carta" }).isVisible(),
    "la caja puede cambiar a tirilla y sigue ofreciendo la carta");

  // Formato de la droguería: tirilla → la caja que nunca eligió imprime la tirilla; vuelve a carta
  await p.evaluate(() => localStorage.removeItem("regenta.impresora"));
  let fr = await api("PUT", "/api/empresa/factura", { formato: "tirilla" });
  ok(fr.ok(), "el dueño elige que las facturas salgan en tirilla", `${fr.status()}`);
  await p.goto(B + "/equipo"); await p.waitForLoadState("networkidle");
  ok(await p.getByRole("radio", { name: /Tirilla de la térmica/ }).isChecked(), "«Mi droguería» muestra el formato elegido");
  await p.getByRole("radio", { name: /Tamaño carta/ }).check();
  await p.getByRole("status").filter({ hasText: "tamaño carta" }).waitFor({ timeout: 10000 });
  fr = await api("PUT", "/api/empresa/factura", { formato: "pdf" });
  ok(fr.status() === 400, "un formato que no existe se rechaza", `${fr.status()}`);
  // Historial de Alegra con fechas imposibles: no rompe la página
  await p.goto(B + "/ventas/historial?desde=2026-02-30&hasta=2026-04-31"); await p.waitForLoadState("networkidle");
  ok(!/Application error|server-side exception/i.test(await p.locator("body").innerText()) && await p.getByRole("heading", { name: /Historial de Alegra|Compras de/ }).count() >= 1 || /\/inicio|\/ventas/.test(p.url()), "el historial no se cae con fechas que no existen", p.url());

  // Inventario: Excel completo y paginación
  const total = (await q(`select count(*)::int n from productos p join empresas e on e.id = p.empresa_id join miembros m on m.empresa_id = e.id where m.user_id = (select user_id from miembros where rol = 'dueno' and empresa_id = $1 limit 1) and e.id = $1 and p.activo`, [e.id]))[0].n;
  await p.goto(B + "/inventario?ver=todos"); await p.waitForLoadState("networkidle");
  const inv = await p.locator("main").innerText();
  ok(inv.includes(`Productos 1 a 100 de ${total.toLocaleString("es-CO")}`) && await p.locator("tbody tr").count() === 100, "el inventario dice cuántos productos hay y muestra de a 100", `${total}`);
  await p.getByRole("link", { name: "Siguiente" }).click(); await p.waitForURL(/pagina=2/);
  ok(await p.getByText("Página 2 de").count() === 1 && await p.locator("tbody tr").count() === Math.min(100, total - 100), "la página 2 del inventario trae los siguientes");
  await p.goto(B + "/inventario?ver=todos&pagina=999"); await p.waitForLoadState("networkidle");
  ok(!/pagina=999/.test(p.url()), "una página que no existe vuelve a la primera", p.url());
  const [dl] = await Promise.all([p.waitForEvent("download"), p.getByRole("link", { name: "Descargar en Excel" }).click()]);
  const ruta = await dl.path();
  const { readSheet } = await import("read-excel-file/node");
  const h1 = await readSheet(ruta, 1), h2 = await readSheet(ruta, 2);
  ok(/^inventario-.*\.xlsx$/.test(dl.suggestedFilename()) && h1.length === total + 1, "el Excel del inventario trae todos los productos", `${dl.suggestedFilename()} · ${h1.length - 1}/${total}`);
  const [lv] = await q(`select count(*)::int n from v_stock_lotes s join productos p on p.id = s.producto_id where s.empresa_id = $1 and s.unidades > 0 and p.activo`, [e.id]);
  ok(h2.length === lv.n + 1, "la hoja de lotes trae cada lote con existencias", `${h2.length - 1}/${lv.n}`);
  ok(h1[0].includes("Valor a costo") && h2[0].includes("Costo por unidad"), "el dueño ve los costos en el Excel");
  const [sum] = await q(`select coalesce(sum(s.unidades) filter (where (s.vence is null or s.vence >= current_date) and not s.bloqueado), 0)::int u from v_stock_lotes s join productos p on p.id = s.producto_id where s.empresa_id = $1 and p.activo`, [e.id]);
  const iU = h1[0].indexOf("Existencias vendibles (und)");
  ok(h1.slice(1).reduce((a, r) => a + (r[iU] ?? 0), 0) === sum.u, "las existencias del Excel suman lo mismo que la base", `${sum.u}`);
  const codigo = h1.slice(1).find((r) => typeof r[0] === "string" && r[0].startsWith("0"));
  ok(!codigo || /^0\d+$/.test(codigo[0]), "los códigos de barras conservan los ceros a la izquierda");
  ok(errs.length === 0, "sin errores de consola (dueño)", errs.join(" | "));
  await pool.query(`update empresas set logo = null where id = $1`, [e.id]);
  await ctx.close();
}

// ── Una droguería real (no demo): soporte sube el logo desde la consola y el dueño lo cambia en «Mi droguería»
{
  const { execFileSync } = await import("node:child_process");
  const { codigoTotp, TOTP } = await import("../ayudas/totp.mjs");
  const E = "10000000-0000-4000-8000-00000000000b"; // DROGUERÍA VECINA
  const IP = `10.79.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}`;
  const ADMIN = `logo${Date.now().toString().slice(-7)}@consola.test`;
  execFileSync("node", ["scripts/crear-superadmin.mjs", ADMIN, "Admin Logo"], { env: { ...process.env, REGENTA_CLAVE_PRUEBA: "ConsolaLogo2026x", REGENTA_TOTP_PRUEBA: TOTP } });
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { "x-real-ip": IP } });
  const p = await ctx.newPage(); const errs = []; p.on("pageerror", (x) => errs.push(x.message));
  const acc = await p.request.post(B + "/api/acceso", { headers: { origin: B }, data: { email: ADMIN, clave: "ConsolaLogo2026x", consola: true, codigo: codigoTotp() } });
  ok(acc.ok(), "la consola entra", `${acc.status()}`);
  await p.goto(B + `/admin/clientes/${E}`); await p.waitForLoadState("networkidle");
  await p.locator('[data-prueba="archivo-logo"]').setInputFiles({ name: "logo.png", mimeType: "image/png", buffer: readFileSync(new URL("../../public/qr-pago.png", import.meta.url)) });
  await p.getByRole("status").filter({ hasText: "Logo guardado" }).waitFor({ timeout: 15000 });
  const [v1] = await q(`select logo from empresas where id = $1`, [E]);
  ok(/^data:image\/(png|webp|jpeg);base64,/.test(v1.logo ?? "") && v1.logo.length <= 380000, "soporte sube el logo desde la consola (reducido a menos de 380 KB)", `${(v1.logo ?? "").length}`);
  ok((await q(`select 1 from admin_eventos where accion = 'logo_cambiado' and empresa_id = $1`, [E])).length >= 1, "queda en la bitácora de la consola");
  const ent = await p.request.post(`${B}/api/admin/clientes/${E}/entrar`, { headers: { origin: B } });
  ok(ent.ok(), "la consola entra como el dueño");
  await p.goto(B + "/equipo"); await p.waitForLoadState("networkidle");
  ok(await p.getByAltText("Logo actual").isVisible(), "el dueño ve su logo en «Mi droguería»");
  await p.getByRole("button", { name: "Quitar logo" }).click();
  await p.getByRole("status").filter({ hasText: "Logo quitado" }).waitFor({ timeout: 10000 });
  ok((await q(`select logo from empresas where id = $1`, [E]))[0].logo === null, "el dueño quita el logo");
  ok(errs.length === 0, "sin errores de página (consola y dueño)", errs.join(" | "));
  await ctx.close();
}

// ── Cajera: sin costos en el Excel, sin cambiar el logo
{
  const { ctx, p, errs } = await entrar("Laura");
  const r = await p.request.fetch(B + "/api/empresa/logo", { method: "PUT", headers: { origin: B }, data: { logo: PNG } });
  ok(r.status() === 403, "la cajera no cambia el logo", `${r.status()}`);
  const x = await p.request.get(B + "/api/inventario/exportar");
  const { readSheet } = await import("read-excel-file/node");
  const h1 = await readSheet(Buffer.from(await x.body()), 1);
  ok(x.ok() && !h1[0].includes("Valor a costo"), "la cajera descarga el inventario sin costos");
  const hx = await p.request.get(B + "/api/ventas/historial/exportar");
  ok(hx.status() === 403, "la cajera no descarga el historial comercial de Alegra", `${hx.status()}`);
  const fx = await p.request.fetch(B + "/api/empresa/factura", { method: "PUT", headers: { origin: B }, data: { formato: "tirilla" } });
  ok(fx.status() === 403, "la cajera no cambia el formato de la factura de la droguería", `${fx.status()}`);
  ok(errs.length === 0, "sin errores de consola (cajera)", errs.join(" | "));
  await ctx.close();
}

await b.close(); await pool.end();
console.log(`\n${fallos} fallos`);
process.exit(fallos ? 1 : 0);
