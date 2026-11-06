// Auditoría página por página.
//  · Web pública: rastrea desde la portada todos los enlaces internos y revisa en cada página estado, título, descripción,
//    H1 único, canonical absoluto, Open Graph, lang, JSON-LD válido, imágenes con alt y que cargan, enlaces rotos,
//    títulos/descripciones duplicados, errores de consola y desborde en móvil. Cruza con sitemap.xml y robots.txt.
//  · App interna: cada pantalla con cada rol (dueño, cajera, bodega y vendedor): carga sin errores, sin desborde en móvil,
//    con H1, y las pantallas prohibidas para el rol redirigen.
// Uso: servidor en :4500 (REGENTA_DEMO=1) → node tests/e2e/auditoria.mjs
import { chromium, devices } from "playwright-core";
import { SignJWT } from "jose";
import pg from "pg";

const B = process.env.BASE ?? "http://localhost:4500";
let fallos = 0, revisadas = 0;
const ok = (c, m, x = "") => { if (!c) { console.log(`FAIL ${m}${x ? " — " + x : ""}`); fallos++; } };
const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium" });

// Las pruebas funcionales entran a la demo sin las ofertas del embudo (las prueba embudo.mjs).
{ const nc = b.newContext.bind(b); b.newContext = async (o) => { const c = await nc(o); await c.addInitScript(() => { try { sessionStorage.setItem("regenta_demo_v1", JSON.stringify({ hechos: [], ofertas: ["prueba", "prueba"], cerrada: true, inicio: Date.now() })); } catch {} }); return c; }; }

// ── Web pública
const ctx = await b.newContext({ viewport: { width: 1440, height: 900 } });
const movil = await b.newContext({ ...devices["iPhone 13"] });
const pendientes = ["/"], vistas = new Set(), titulos = new Map(), descripciones = new Map(), enlaces = new Set();
while (pendientes.length) {
  const ruta = pendientes.shift();
  if (vistas.has(ruta)) continue;
  vistas.add(ruta);
  const p = await ctx.newPage();
  const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
  const r = await p.goto(B + ruta, { waitUntil: "networkidle" });
  revisadas++;
  ok(r.status() === 200, `${ruta}: estado`, `${r.status()}`);
  const meta = await p.evaluate(() => ({
    titulo: document.title, desc: document.querySelector('meta[name="description"]')?.getAttribute("content") ?? "",
    canonical: document.querySelector('link[rel="canonical"]')?.getAttribute("href") ?? "", robots: document.querySelector('meta[name="robots"]')?.getAttribute("content") ?? "",
    og: document.querySelector('meta[property="og:image"]')?.getAttribute("content") ?? "", ogt: document.querySelector('meta[property="og:title"]')?.getAttribute("content") ?? "",
    lang: document.documentElement.lang, h1: document.querySelectorAll("h1").length,
    ld: [...document.querySelectorAll('script[type="application/ld+json"]')].map((s) => s.textContent),
    imgs: [...document.querySelectorAll("img")].map((i) => ({ src: i.getAttribute("src"), alt: i.getAttribute("alt") ?? "" })),
    links: [...document.querySelectorAll("a[href]")].map((a) => a.getAttribute("href")),
    saltos: [...document.querySelectorAll("h1,h2,h3,h4")].map((h) => Number(h.tagName[1])),
  }));
  ok(meta.titulo.length >= 15 && meta.titulo.length <= 65, `${ruta}: largo del título`, `${meta.titulo.length} «${meta.titulo}»`);
  ok(meta.desc.length >= 70 && meta.desc.length <= 160, `${ruta}: largo de la descripción`, `${meta.desc.length}`);
  ok(meta.h1 === 1, `${ruta}: un solo H1`, `${meta.h1}`);
  ok(/^https?:\/\//.test(meta.canonical) && new URL(meta.canonical).pathname.replace(/\/$/, "") === ruta.replace(/\/$/, ""), `${ruta}: canonical absoluto y propio`, meta.canonical);
  ok(!meta.robots.includes("noindex"), `${ruta}: indexable`);
  ok(meta.og && meta.ogt, `${ruta}: Open Graph`);
  ok(meta.lang === "es-CO", `${ruta}: lang es-CO`);
  for (const t of meta.ld) { try { JSON.parse(t); } catch { ok(false, `${ruta}: JSON-LD inválido`); } }
  for (let i = 1; i < meta.saltos.length; i++) ok(meta.saltos[i] - meta.saltos[i - 1] <= 1, `${ruta}: salto de encabezado`, `h${meta.saltos[i - 1]} → h${meta.saltos[i]}`);
  for (const im of meta.imgs) {
    ok(im.alt.length >= 8, `${ruta}: imagen sin texto alternativo`, im.src);
    const ri = await p.request.get(new URL(im.src, B).toString()); ok(ri.ok(), `${ruta}: imagen rota`, im.src);
  }
  if (titulos.has(meta.titulo)) ok(false, `${ruta}: título duplicado con ${titulos.get(meta.titulo)}`); titulos.set(meta.titulo, ruta);
  if (descripciones.has(meta.desc)) ok(false, `${ruta}: descripción duplicada con ${descripciones.get(meta.desc)}`); descripciones.set(meta.desc, ruta);
  ok(errs.length === 0, `${ruta}: errores de consola`, errs.join(" | "));
  for (const h of meta.links) {
    if (!h || h.startsWith("mailto:") || h.startsWith("tel:") || h.startsWith("#")) continue;
    const u = new URL(h, B + ruta);
    if (u.origin !== new URL(B).origin) { enlaces.add(u.toString()); continue; }
    const limpia = u.pathname;
    if (!vistas.has(limpia) && !pendientes.includes(limpia) && !/^\/(api|demo|entrar|inicio|caja|ventas|productos|inventario|prediccion|alertas)/.test(limpia)) pendientes.push(limpia);
  }
  // móvil
  const pm = await movil.newPage(); await pm.goto(B + ruta);
  const desborde = await pm.evaluate(() => document.documentElement.scrollWidth - innerWidth);
  ok(desborde <= 0, `${ruta}: desborde horizontal en móvil`, `${desborde}px`);
  await pm.close(); await p.close();
}
console.log(`web pública: ${vistas.size} páginas rastreadas`);
// sitemap y robots
const sm = await (await ctx.request.get(B + "/sitemap.xml")).text();
const enSitemap = [...sm.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => new URL(m[1]).pathname);
for (const r of enSitemap) ok(vistas.has(r), `sitemap: ${r} no se alcanza desde la web (página huérfana)`);
for (const r of vistas) ok(enSitemap.includes(r), `${r}: falta en el sitemap`);
const robots = await (await ctx.request.get(B + "/robots.txt")).text();
ok(/Sitemap: /.test(robots) && /Disallow: \/api\//.test(robots), "robots.txt con sitemap y bloqueo de /api");
const wa = [...enlaces].filter((u) => u.startsWith("https://wa.me/"));
ok(wa.every((u) => u.startsWith("https://wa.me/573212141970")), "todos los WhatsApp van al número de Farmagenéricos");
console.log(`enlaces externos distintos: ${enlaces.size}`);

// ── App interna por rol
const PANTALLAS = ["/inicio", "/caja", "/ventas", "/productos", "/productos/nuevo", "/productos/importar", "/inventario", "/inventario?ver=agotados", "/inventario?ver=todos",
  "/inventario/recibir", "/prediccion", "/prediccion?ver=vencimiento", "/prediccion?ver=quietos", "/alertas", "/cartera", "/cartera?ver=pagadas", "/reportes", "/turno", "/demo/gracias",
  // Bloque 2: compras, proveedores, cuentas por pagar, pedidos del mostrador y cartera por cliente
  "/compras", "/compras/nueva", "/proveedores", "/cuentas-por-pagar", "/pedidos", "/pedidos/nuevo", "/pedidos?tipo=cotizacion&estado=todos", "/cartera?ver=clientes",
  // Bloque 3: resultados, IVA, cierre, gastos, bitácora, documentos DIAN (con soporte y notas), precios, etiquetas y cuarentena
  "/reportes/resultados", "/reportes/iva", "/reportes/cierre", "/gastos", "/bitacora", "/documentos", "/documentos?tipo=soporte", "/productos/precios", "/etiquetas",
  "/inventario/cuarentena"];
const COMPRAS = { "/compras": "/caja", "/compras/nueva": "/caja", "/proveedores": "/caja", "/cuentas-por-pagar": "/inicio" };
// Bloque 3: lo de la gerencia (dueño y administrador). Etiquetas y cuarentena también son de la bodega.
const GERENCIA3 = { "/reportes/resultados": "/inicio", "/reportes/iva": "/inicio", "/reportes/cierre": "/inicio", "/gastos": "/inicio", "/bitacora": "/inicio",
  "/documentos": "/inicio", "/productos/precios": "/productos" };
const BODEGA3 = { "/etiquetas": "/inicio", "/inventario/cuarentena": "/inventario" };
const PROHIBIDAS = { cajero: { "/reportes": "/inicio", "/productos/nuevo": "/productos", "/productos/importar": "/productos", "/inventario/recibir": "/caja", "/prediccion": "/caja", "/cartera": "/inicio", "/cartera?ver=pagadas": "/inicio", ...COMPRAS, ...GERENCIA3, ...BODEGA3 },
  bodega: { "/reportes": "/inicio", "/turno": "/inicio", "/caja": "/inventario", "/ventas": null, "/cartera": "/inicio", "/cartera?ver=pagadas": "/inicio", "/cuentas-por-pagar": "/compras", "/pedidos": "/inicio", "/pedidos/nuevo": "/inicio", ...GERENCIA3 },
  // El vendedor arma pedidos y cotizaciones: no cobra, no ve la caja, ni el dinero, ni compras.
  vendedor: { "/caja": "/pedidos", "/turno": null, "/ventas": null, "/reportes": null, "/cartera": null, "/compras": null, "/compras/nueva": null, "/proveedores": null, "/cuentas-por-pagar": null,
    "/inventario/recibir": null, "/productos/nuevo": null, "/productos/importar": null, "/prediccion": null, ...GERENCIA3, ...BODEGA3 },
  dueno: {} };
const PANTALLAS_VENDEDOR = ["/inicio", "/pedidos", "/pedidos/nuevo", "/pedidos?tipo=cotizacion&estado=todos", "/cuenta", ...Object.keys(PROHIBIDAS.vendedor)];
// Sesión del vendedor (la demo no trae uno): miembro de la droguería demo con sesión firmada como la de /api/acceso.
const VEND = "00000000-0000-4000-8000-0000000000e9";
let sesionVendedor = null;
{
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL ?? "postgres://postgres@localhost:5433/regenta?host=/tmp" });
  const emp = (await pool.query(`select id from empresas where demo limit 1`)).rows[0].id;
  await pool.query(`insert into miembros (empresa_id, user_id, nombre, rol) values ($1, $2, 'Vendedor auditoría', 'vendedor')
    on conflict (empresa_id, user_id) do update set activo = true, rol = 'vendedor'`, [emp, VEND]);
  await pool.end();
  sesionVendedor = await new SignJWT({ uid: VEND, empresa: emp, nombre: "Vendedor auditoría", rol: "vendedor", v: 0 }).setProtectedHeader({ alg: "HS256" }).setIssuedAt().setExpirationTime("1h")
    .sign(new TextEncoder().encode(process.env.REGENTA_SESSION_SECRET ?? "prueba-local-0123456789abcdef0123456789abcdef"));
}
for (const rol of ["dueno", "cajero", "bodega", "vendedor"]) {
  for (const [nombre, opts] of [["escritorio", { viewport: { width: 1440, height: 900 } }], ["móvil", devices["iPhone 13"]]]) {
    const c = await b.newContext(opts);
    const p = await c.newPage();
    const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
    if (rol === "vendedor") await c.addCookies([{ name: "regenta_sesion", value: sesionVendedor, url: B }]);
    else await p.request.post(B + "/demo", { form: { rol } });
    const pantallas = rol === "vendedor" ? [...PANTALLAS_VENDEDOR] : [...PANTALLAS];
    const venta = (await (await p.request.get(B + "/api/productos?q=a")).json()).productos?.[0];
    if (venta && rol === "dueno") pantallas.push(`/productos/${venta.id}`);
    const unaVenta = await p.evaluate(() => null);
    for (const ruta of pantallas) {
      errs.length = 0;
      const r = await p.goto(B + ruta, { waitUntil: "networkidle" });
      revisadas++;
      const destino = new URL(p.url()).pathname;
      const prohibida = PROHIBIDAS[rol][ruta.split("?")[0]];
      if (prohibida !== undefined) ok(destino !== ruta.split("?")[0], `${rol}: ${ruta} debería estar prohibida`, destino);
      ok(r.status() === 200, `${rol} ${nombre}: ${ruta} estado`, `${r.status()}`);
      ok(await p.locator("h1").count() >= 1, `${rol} ${nombre}: ${ruta} sin H1`);
      ok(errs.length === 0, `${rol} ${nombre}: ${ruta} errores de consola`, errs.join(" | "));
      const desborde = await p.evaluate(() => document.documentElement.scrollWidth - innerWidth);
      ok(desborde <= 0, `${rol} ${nombre}: ${ruta} desborde horizontal`, `${desborde}px`);
      const robots = await p.locator('meta[name="robots"]').getAttribute("content").catch(() => "");
      ok((robots ?? "").includes("noindex"), `${rol}: ${ruta} la app debe ser noindex`);
    }
    // detalle de una venta
    if (rol !== "bodega" && rol !== "vendedor") {
      await p.goto(B + "/ventas");
      const enlace = p.locator('a[href^="/ventas/"]').first();
      if (await enlace.count()) { await enlace.click(); await p.waitForLoadState("networkidle"); revisadas++; ok(await p.locator("h1, [aria-label='Tiquete']").count() >= 1 && errs.length === 0, `${rol} ${nombre}: detalle de venta`, errs.join(" | ")); }
    }
    await c.close();
  }
}
await b.close();
console.log(`\n${revisadas} pantallas revisadas · ${fallos} fallos`);
process.exit(fallos ? 1 : 0);
