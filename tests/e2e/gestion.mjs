// Recorrido de la portada comercial y de la gestión: inicio del dueño, alta de producto desde el catálogo, carga desde
// Excel (vista previa + aplicar), recibir mercancía, ventas y anulación, permisos. Guarda capturas para la portada.
// Uso: servidor en :4500 (REGENTA_DEMO=1) con la base recién sembrada → node tests/e2e/gestion.mjs
import { chromium, devices } from "playwright-core";
import { mkdirSync, writeFileSync } from "node:fs";

const B = process.env.BASE ?? "http://localhost:4500";
const OUT = process.env.OUT ?? "test-results";
const CAP = process.env.CAPTURAS; // si se define, guarda ahí las capturas para la portada
mkdirSync(OUT, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium" });

// Las pruebas funcionales entran a la demo sin las ofertas del embudo (las prueba embudo.mjs).
{ const nc = b.newContext.bind(b); b.newContext = async (o) => { const c = await nc(o); await c.addInitScript(() => { try { sessionStorage.setItem("regenta_demo_v1", JSON.stringify({ hechos: [], ofertas: ["prueba", "prueba"], cerrada: true, inicio: Date.now() })); } catch {} }); return c; }; }
let fallos = 0;
const ok = (c, m, x = "") => { console.log(`${c ? "PASS" : "FAIL"} ${m}${x ? " — " + x : ""}`); if (!c) fallos++; };
const vigilar = (p) => { const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => m.type() === "error" && errs.push(m.text())); return errs; };

async function entrar(ctx, quien) {
  const p = await ctx.newPage();
  const errs = vigilar(p);
  await p.goto(B + "/entrar");
  await p.getByRole("button", { name: new RegExp(quien) }).click();
  await p.waitForURL(/\/(caja|inicio)/);
  return { p, errs };
}

// ── Portada comercial
{
  // IP propia por corrida (el servidor de pruebas cree x-real-ip): el límite de solicitudes no se acumula entre corridas.
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 }, extraHTTPHeaders: { "x-real-ip": `10.9.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}` } });
  const p = await ctx.newPage();
  const errs = vigilar(p);
  const r = await p.goto(B + "/");
  ok(r.status() === 200, "la portada responde 200");
  ok(/droguer/i.test(await p.title()), "título con la palabra clave", await p.title());
  ok(await p.locator("h1").count() === 1, "una sola h1");
  ok(!(await p.locator('meta[name="robots"][content*="noindex"]').count()), "la portada es indexable");
  ok(await p.locator('link[rel="canonical"]').count() === 1, "tiene canonical");
  const ld = await p.locator('script[type="application/ld+json"]').textContent();
  ok(ld.includes("SoftwareApplication") && ld.includes("FAQPage"), "datos estructurados SoftwareApplication + FAQPage");
  const imgs = await p.locator("main img").evaluateAll((xs) => xs.map((x) => ({ alt: x.alt, src: x.getAttribute("src") })));
  ok(imgs.length >= 4 && imgs.every((i) => i.alt.length > 10), "capturas con texto alternativo", `${imgs.length}`);
  for (const i of imgs) { const s = (await p.request.get(B + i.src)).status(); if (s !== 200) ok(false, "imagen existe", `${i.src} ${s}`); }
  ok((await p.locator('a[href^="https://wa.me/573212141970"]').count()) >= 2, "enlaces a WhatsApp de Farmagenéricos");
  await p.screenshot({ path: `${OUT}/portada.png` });
  await p.screenshot({ path: `${OUT}/portada-completa.png`, fullPage: true });
  // Formulario de demo: error y envío
  await p.locator("#demo").scrollIntoViewIfNeeded();
  await p.fill("#d-nombre", "Prueba E2E");
  await p.fill("#d-drogueria", "Droguería Prueba");
  await p.fill("#d-tel", "12");
  await p.getByRole("button", { name: "Pedir demostración" }).click();
  ok(await p.getByRole("alert").filter({ hasText: "celular" }).waitFor({ timeout: 5000 }).then(() => true, () => false), "el formulario explica el error del celular");
  await p.fill("#d-tel", "321 000 0000");
  await p.getByRole("button", { name: "Pedir demostración" }).click();
  await p.waitForSelector("text=Listo, Prueba");
  ok(true, "la solicitud de demo se guarda");
  await p.screenshot({ path: `${OUT}/portada-demo.png` });
  const bot = await p.request.post(B + "/api/demo", { data: { nombre: "Bot Trampa", drogueria: "Bot", telefono: "3210000000", web: "spam" } });
  const { execSync } = await import("node:child_process");
  const guardado = execSync(`psql -h /tmp -p 5433 -U postgres regenta -Atc "select count(*) from solicitudes_demo where nombre = 'Bot Trampa'"`).toString().trim();
  ok(bot.status() === 201 && guardado === "0", "la trampa anti-bots responde normal pero no guarda nada", `${bot.status()} / ${guardado}`);
  ok((await p.request.get(B + "/sitemap.xml")).ok() && (await (await p.request.get(B + "/robots.txt")).text()).includes("Disallow: /caja"), "sitemap.xml y robots.txt");
  const app = await (await p.request.get(B + "/entrar")).text();
  ok(app.includes("noindex"), "entrar no se indexa");
  const reales = errs.filter((e) => !/status of 400/.test(e));
  ok(reales.length === 0, "portada sin errores de JavaScript", reales.join(" | "));
  await ctx.close();
}
{
  const ctx = await b.newContext({ ...devices["iPhone 13"] });
  const p = await ctx.newPage();
  await p.goto(B + "/");
  const ancho = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  ok(ancho <= 0, "portada sin desborde horizontal en móvil", `${ancho}px`);
  await p.screenshot({ path: `${OUT}/portada-movil.png` });
  await p.screenshot({ path: `${OUT}/portada-movil-completa.png`, fullPage: true });
  await ctx.close();
}

// ── Guías y demo de un clic
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const p = await ctx.newPage();
  const errs = vigilar(p);
  await p.goto(B + "/guias");
  const enlaces = await p.locator('main a[href^="/guias/"]').evaluateAll((xs) => xs.map((x) => x.getAttribute("href")));
  ok(enlaces.length >= 6, "índice de guías", `${enlaces.length}`);
  for (const h of enlaces) {
    const r = await p.goto(B + h);
    const t = await p.title(), d = await p.locator('meta[name="description"]').getAttribute("content");
    const ld = await p.locator('script[type="application/ld+json"]').textContent();
    ok(r.status() === 200 && t.length <= 60 && d.length <= 160 && ld.includes("Article") && ld.includes("BreadcrumbList") && await p.locator("h1").count() === 1 && await p.locator('form[action="/demo"]').count() >= 2,
      `guía ${h}`, `${t.length} car. título, ${d.length} descripción`);
  }
  await p.screenshot({ path: `${OUT}/guia.png` });
  const sm = await (await p.request.get(B + "/sitemap.xml")).text();
  ok(enlaces.every((h) => sm.includes(h)), "el sitemap incluye todas las guías");
  // Páginas comerciales
  for (const ruta of ["/precios", "/por-que-regenta", "/funciones", "/funciones/regenta-ia", "/funciones/pedido-sugerido", "/funciones/control-de-vencimientos", "/funciones/alertas-invima", "/funciones/caja-pos", "/para/regentes", "/para/duenos-de-drogueria"]) {
    const r = await p.goto(B + ruta);
    const t = await p.title(), d = await p.locator('meta[name="description"]').getAttribute("content");
    ok(r.status() === 200 && t.length <= 70 && d && d.length <= 160 && await p.locator("h1").count() === 1 && await p.locator('link[rel="canonical"]').count() === 1 && sm.includes(ruta === "/funciones" ? "/funciones<" : ruta), `página ${ruta}`, `${t.length}/${d?.length}`);
  }
  // Demo: un formulario POST desde el sitio; otro sitio no puede crear la sesión
  const ajeno = await p.request.post(B + "/demo", { form: { rol: "dueno" }, headers: { origin: "https://otro-sitio.example" }, maxRedirects: 0 });
  ok(ajeno.status() === 303 && (ajeno.headers()["location"] ?? "").includes("#demo") && !(ajeno.headers()["set-cookie"] ?? "").includes("regenta_sesion"), "otro sitio no puede abrir la demo (CSRF)");
  ok((await p.request.get(B + "/demo")).ok() && !((await p.request.get(B + "/demo")).headers()["set-cookie"] ?? "").includes("regenta_sesion"), "un GET a /demo nunca crea sesión");
  await p.goto(B + "/");
  await p.getByRole("button", { name: /Probar la demo/ }).first().click();
  await p.waitForURL(/\/inicio/);
  ok(true, "«Probar la demo» entra en un clic al inicio del dueño");
  ok(errs.length === 0, "guías y demo sin errores de JavaScript", errs.join(" | "));
  await ctx.close();
}

// ── Dueño
{
  const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
  const { p, errs } = await entrar(ctx, "Carlos");
  ok(p.url().endsWith("/inicio"), "el dueño entra al inicio");
  ok(await p.getByText("Ganancia bruta hoy").count() === 1, "el dueño ve la ganancia");
  ok((await p.locator('meta[name="robots"]').getAttribute("content")).includes("noindex"), "la app no se indexa");
  await p.screenshot({ path: `${OUT}/inicio-dueno.png` });

  // Alta desde el catálogo
  await p.goto(B + "/productos/nuevo");
  await p.fill("#buscar-maestro", "ibuprofeno 800");
  await p.waitForSelector("text=Agregar", { timeout: 8000 });
  const nombre = (await p.locator("li p.font-semibold").first().textContent()).trim();
  await p.getByRole("button", { name: "Agregar" }).first().click();
  ok(await p.inputValue("#nombre") === nombre, "el catálogo llena el nombre", nombre);
  await p.fill("#precio_caja", "15900");
  await p.screenshot({ path: `${OUT}/producto-nuevo.png` });
  await p.getByRole("button", { name: "Agregar a mi droguería" }).click();
  await p.waitForURL(/\/productos\?q=/);
  ok(await p.getByText(nombre).count() >= 1, "el producto nuevo aparece en la lista");

  // Carga desde Excel (CSV)
  const csv = ["nombre;codigo_barras;laboratorio;iva;unidades_por_caja;precio_caja;precio_unidad;stock_minimo;lote;vence;cantidad_unidades;costo_unidad",
    "Producto E2E Uno tabletas caja x 20;7709990000017;Lab Prueba;0;20;$ 24.000;1.300;2;E2E1;2027-05-31;60;700",
    "Producto E2E Dos jarabe 120 ml;;Lab Prueba;19;1;9.500;;3;E2E2;2026-12-31;5;5000"].join("\r\n");
  const malo = csv + "\r\nSin precio;;;0;1;;;;;;;";
  writeFileSync(`${OUT}/e2e.csv`, "﻿" + csv); writeFileSync(`${OUT}/e2e-malo.csv`, malo);
  await p.goto(B + "/productos/importar");
  await p.setInputFiles('input[type="file"]', `${OUT}/e2e-malo.csv`);
  await p.waitForSelector("text=con errores");
  ok(await p.getByText(/Fila 4: precio de venta/).count() === 1, "la vista previa señala la fila con error");
  ok(await p.getByRole("button", { name: /Importar/ }).isDisabled(), "con errores no deja importar");
  await p.setInputFiles('input[type="file"]', `${OUT}/e2e.csv`);
  await p.waitForSelector("text=Se van a crear 2 productos");
  await p.screenshot({ path: `${OUT}/importar-previa.png` });
  await p.getByRole("button", { name: "Importar 2 productos" }).click();
  await p.waitForSelector("text=Listo: 2 productos creados");
  ok(true, "importa 2 productos con existencias");
  await p.screenshot({ path: `${OUT}/importar-hecho.png` });
  const busca = await (await p.request.get(B + "/api/productos?q=7709990000017")).json();
  const uno = busca.productos[0];
  ok(uno && uno.unidades === 60 && uno.precio_caja === 24000 && uno.precio_unidad === 1300, "precios y existencias importados", JSON.stringify(uno && { u: uno.unidades, c: uno.precio_caja, pu: uno.precio_unidad }));

  // Recibir mercancía: 2 cajas + 5 sueltas = 45 unidades
  await p.goto(B + "/inventario/recibir");
  await p.fill("#buscar-recibir", "7709990000017");
  await p.waitForSelector("text=Producto E2E Uno");
  const k = (await p.locator('input[id^="lote-"]').first().getAttribute("id")).slice(5);
  await p.fill(`#lote-${k}`, "e2e9");
  await p.fill(`#vence-${k}`, "2028-01-31");
  await p.fill(`#cajas-${k}`, "2");
  await p.fill(`#sueltas-${k}`, "5");
  await p.fill(`#costo-${k}`, "650");
  await p.fill("#proveedor", "Factura E2E-1");
  ok(await p.getByText("Entran 45 unidades").count() === 1, "calcula cajas + sueltas");
  await p.screenshot({ path: `${OUT}/recibir.png` });
  await p.getByRole("button", { name: "Guardar entrada" }).click();
  await p.waitForSelector("text=Entrada guardada");
  const tras = (await (await p.request.get(B + "/api/productos?q=7709990000017")).json()).productos[0];
  ok(tras.unidades === 105, "las existencias suben con la entrada", `${tras.unidades}`);
  await p.goto(B + "/inventario?ver=todos&q=E2E Uno");
  ok(await p.getByText("E2E9").count() >= 1, "el lote recibido aparece en el inventario");

  // Vender y anular
  const venta = await p.request.post(B + "/api/ventas", { data: { idem_key: crypto.randomUUID(), tipo_doc: "pos", lineas: [{ producto_id: uno.id, presentacion: "unidad", cantidad: 3 }], pagos: [{ medio: "efectivo", valor: 5000 }] } });
  const vj = await venta.json();
  ok(venta.status() === 201 || venta.ok(), "venta por unidad registrada", `${venta.status()}`);
  await p.goto(B + "/ventas");
  ok(await p.locator("tbody tr").count() >= 1, "la venta aparece en Ventas");
  await p.screenshot({ path: `${OUT}/ventas.png` });
  await p.goto(B + `/ventas/${vj.venta.venta_id}`);
  await p.screenshot({ path: `${OUT}/venta-detalle.png` });
  await p.getByRole("button", { name: "Anular venta" }).click();
  await p.fill("#motivo", "Prueba automática de anulación");
  await p.getByRole("button", { name: "Confirmar anulación" }).click();
  await p.waitForSelector("text=Venta anulada");
  const fin = (await (await p.request.get(B + "/api/productos?q=7709990000017")).json()).productos[0];
  ok(fin.unidades === 105, "al anular, las unidades vuelven", `${fin.unidades}`);

  // Predicción
  await p.goto(B + "/prediccion");
  ok(await p.getByText("Pedido sugerido (").count() === 1, "predicción: pestaña de pedido sugerido");
  const filasPedido = await p.locator("tbody tr").count();
  ok(filasPedido > 0, "predicción: hay productos para pedir", `${filasPedido}`);
  await p.screenshot({ path: `${OUT}/prediccion.png` });
  await p.goto(B + "/prediccion?ver=vencimiento");
  ok(await p.getByText("Valor a costo").count() === 1, "el dueño ve el valor en riesgo");
  // Alertas INVIMA: el lote F0537A está en existencias
  await p.goto(B + "/inicio");
  ok(await p.getByText("Tienes en existencias un lote con alerta del INVIMA").count() === 1, "inicio avisa del lote con alerta INVIMA");
  await p.goto(B + "/alertas");
  ok(await p.getByText("Tienes este lote").count() === 1, "alertas: detecta el lote F0537A");
  if (CAP) await p.screenshot({ path: `${CAP}/alertas.png` });
  await p.screenshot({ path: `${OUT}/alertas.png` });
  await p.getByRole("button", { name: "Separé el producto" }).first().click();
  await p.waitForSelector("text=Producto separado");
  ok(true, "alertas: queda la constancia de la revisión");
  await p.goto(B + "/inicio");
  ok(await p.getByText("Tienes en existencias un lote con alerta del INVIMA").count() === 0, "tras revisar, el aviso rojo desaparece");

  if (CAP) {
    // Capturas para la portada (escritorio 1440×900)
    await p.goto(B + "/inicio"); await p.screenshot({ path: `${CAP}/inicio.png` });
    await p.goto(B + "/prediccion?ver=pedido"); await p.screenshot({ path: `${CAP}/prediccion.png` });
    await p.goto(B + "/prediccion?ver=vencimiento"); await p.screenshot({ path: `${CAP}/vencimiento.png` });
    await p.goto(B + "/inventario"); await p.screenshot({ path: `${CAP}/inventario.png` });
    const muestra = ["nombre;codigo_barras;laboratorio;iva;unidades_por_caja;precio_caja;precio_unidad;stock_minimo;lote;vence;cantidad_unidades;costo_unidad",
      "Losartán 50 mg tabletas caja x 30;7709990001014;Genérico;0;30;18900;700;4;LS2405;2027-03-31;120;310",
      "Metformina 850 mg tabletas caja x 30;7709990001021;Genérico;0;30;9800;400;4;MF118;2027-06-30;90;160",
      "Omeprazol 20 mg cápsulas caja x 30;7709990001038;Genérico;0;30;8500;350;5;OM771;2026-12-31;150;120",
      "Loratadina 10 mg tabletas caja x 10;7709990001045;Genérico;0;10;4200;450;3;LR092;2027-09-30;40;210",
      "Suero oral 500 ml;7709990001052;Genérico;0;1;3800;;6;SO332;2027-01-31;24;2400",
      "Crema dental 75 ml;7709990001069;Genérico;19;1;6500;;6;CD55;2028-01-31;24;4100",
      "Alcohol antiséptico 350 ml;7709990001076;Genérico;19;1;5900;;4;AA12;2028-06-30;18;3500"].join("\r\n");
    writeFileSync(`${OUT}/muestra.csv`, muestra);
    await p.goto(B + "/productos/importar"); await p.setInputFiles('input[type="file"]', `${OUT}/muestra.csv`); await p.waitForSelector("text=Importar 7 productos"); await p.waitForTimeout(300); await p.screenshot({ path: `${CAP}/importar.png` });
  }
  ok(errs.length === 0, "dueño sin errores de JavaScript", errs.join(" | "));
  await ctx.close();
}

// ── Cajera: no carga productos ni recibe mercancía
{
  const ctx = await b.newContext();
  const { p } = await entrar(ctx, "Laura");
  await p.goto(B + "/productos/importar");
  await p.waitForURL((u) => u.pathname === "/productos", { timeout: 10000 }).catch(() => {});
  ok(new URL(p.url()).pathname === "/productos", "la cajera no entra a cargar productos");
  const r = await p.request.post(B + "/api/productos/importar", { data: { simular: true, filas: [{ nombre: "x", precio_caja: 1 }] } });
  ok(r.status() === 403, "la API de carga rechaza a la cajera", `${r.status()}`);
  await p.goto(B + "/inventario/recibir");
  await p.waitForURL(/\/caja/, { timeout: 10000 }).catch(() => {});
  ok(new URL(p.url()).pathname === "/caja", "la cajera no recibe mercancía");
  if (CAP) {
    await p.setViewportSize({ width: 1440, height: 900 });
    for (const q of ["acetaminofen", "amoxicilina", "suero pedialyte"]) { await p.locator("#buscar").fill(q); await p.waitForSelector('[aria-label="Resultados"] [role="option"]'); await p.locator("#buscar").press("Enter"); }
    await p.locator("#buscar").fill("dolex"); await p.waitForSelector('[aria-label="Resultados"] [role="option"]'); await p.waitForTimeout(300);
    await p.screenshot({ path: `${CAP}/caja.png` });
  }
  await ctx.close();
}

// ── Bodega: recibe mercancía, no ve costos
{
  const ctx = await b.newContext();
  const { p } = await entrar(ctx, "Andrés");
  ok(p.url().endsWith("/inicio"), "bodega entra al inicio");
  await p.goto(B + "/inventario/recibir");
  ok(p.url().endsWith("/inventario/recibir"), "bodega puede recibir mercancía");
  await p.fill("#buscar-recibir", "7709990000017");
  await p.waitForSelector('input[id^="lote-"]');
  ok(await p.locator('input[id^="costo-"]').count() === 0, "bodega no ve el campo de costo");
  await p.goto(B + "/prediccion?ver=vencimiento");
  ok(p.url().includes("/prediccion") && await p.getByText("Valor a costo").count() === 0, "bodega ve la predicción sin costos");
  await ctx.close();
}

await b.close();
console.log(`\n${fallos} fallos`);
process.exit(fallos ? 1 : 0);
