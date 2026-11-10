// Capturas paso a paso para la guía y el video (1920×1080, con resaltado del control que se usa).
import { chromium, devices } from "playwright-core";
import { writeFileSync, mkdirSync } from "node:fs";
const B = "http://localhost:4540", D = process.argv[2];
mkdirSync(D, { recursive: true });
const b = await chromium.launch({ executablePath: process.env.CHROME });
const cajas = {};
async function entrar(quien, o = { viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2, locale: "es-CO", timezoneId: "America/Bogota" }) {
  const c = await b.newContext(o);
  await c.addInitScript(() => { try { sessionStorage.setItem("regenta_demo_v1", JSON.stringify({ hechos: [], ofertas: ["prueba", "prueba"], cerrada: true, inicio: Date.now() })); } catch {} });
  const p = await c.newPage(); await p.goto(B + "/entrar"); await p.getByRole("button", { name: new RegExp(quien) }).click(); await p.waitForURL(/\/(caja|inicio)/); return p;
}
async function limpiar(p) {
  await p.addStyleTag({ content: `[aria-label="Estás en la demo"]{display:none!important} *{caret-color:transparent!important}` }).catch(() => {});
  await p.evaluate(() => {
    for (const el of document.querySelectorAll("button, a")) {
      const t = el.textContent?.trim() ?? "";
      if (/^Guía de la demo/.test(t)) el.style.display = "none";
      if (/^Quiero esto en mi droguería/.test(t)) { let x = el; while (x && getComputedStyle(x).position !== "fixed") x = x.parentElement; if (x) x.style.display = "none"; }
    }
    // Lo que solo dice la demo (emisión simulada): en una droguería habilitada no aparece.
    const w = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    const tocados = [];
    for (let n; (n = w.nextNode());) if (/simulad/i.test(n.nodeValue)) { n.nodeValue = n.nodeValue.replace(/\s*[·(-]?\s*emisión simulada[^.)]*\)?/gi, "").replace(/\s*\(pruebas\)/gi, ""); tocados.push(n.parentElement); }
    for (const el of tocados) { let x = el; while (x && x !== document.body && !(x.textContent ?? "").trim()) { const q = x.parentElement; if (q && (q.textContent ?? "").trim()) break; x = q; } if (x && !(x.textContent ?? "").trim()) x.style.display = "none"; }
    document.getElementById("__resalte")?.remove();
  }).catch(() => {});
}
/** Foto del paso; si hay control a resaltar, lo enmarca y guarda su caja (para el zoom del video). */
async function foto(p, id, loc) {
  await p.waitForTimeout(500); await limpiar(p);
  let caja = null;
  if (loc) {
    const l = typeof loc === "string" ? p.locator(loc).first() : loc.first();
    await l.scrollIntoViewIfNeeded().catch(() => {});
    await p.waitForTimeout(200);
    caja = await l.boundingBox().catch(() => null);
    if (caja) await p.evaluate((c) => {
      const d = document.createElement("div"); d.id = "__resalte";
      Object.assign(d.style, { position: "fixed", left: c.x - 8 + "px", top: c.y - 8 + "px", width: c.width + 16 + "px", height: c.height + 16 + "px",
        border: "4px solid #f59e0b", borderRadius: "14px", boxShadow: "0 0 0 9999px rgba(11,31,51,.14)", zIndex: 2147483647, pointerEvents: "none" });
      document.body.appendChild(d);
    }, caja);
  }
  await p.screenshot({ path: `${D}/${id}.png` });
  await p.evaluate(() => document.getElementById("__resalte")?.remove()).catch(() => {});
  cajas[id] = caja; console.log("foto", id, caja ? "resaltado" : "");
}
const ir = async (p, r) => { await p.goto(B + r); await p.waitForLoadState("networkidle"); };
const intento = async (n, f) => { try { await f(); } catch (e) { console.log("FALLO", n, String(e).split("\n")[0]); } };

// ── Primer acceso (sin sesión)
{
  const c = await b.newContext({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 2, locale: "es-CO", timezoneId: "America/Bogota" }); const p = await c.newPage();
  await intento("entrar", async () => { if (process.env.SIN_DEMO) { await ir(p, "/activar?t=GuiaRegentaPrimerAcceso2026abcdeg"); await foto(p, "00a-activar", "#v-clave");
    await p.fill("#v-clave", "SanRafael2026"); await p.fill("#v-repetir", "SanRafael2026"); await foto(p, "00b-activar-lleno", p.getByRole("button", { name: "Activar mi cuenta" }));
    await p.getByRole("button", { name: "Activar mi cuenta" }).click(); await p.getByText("está activa").waitFor(); await foto(p, "00c-activada", p.getByRole("link", { name: "Entrar a Regenta" }));
    await ir(p, "/entrar"); await p.fill('input[type="email"]', "maria@drogueriasanrafael.co"); await foto(p, "01-entrar", p.getByRole("button", { name: "Entrar", exact: true }));
    await p.getByRole("button", { name: "¿Olvidaste tu contraseña?" }).click(); await foto(p, "01b-olvide", p.getByRole("button", { name: "Enviarme el enlace" })); await b.close(); process.exit(0); } });
}

// ── Dueño
const p = await entrar("Carlos");
await intento("menu", async () => { await ir(p, "/inicio"); await foto(p, "02-inicio"); await foto(p, "03-menu", 'nav[aria-label="Principal"]');
  await foto(p, "04-buscador", p.getByText("Buscar o preguntar").first()); });
await intento("ia", async () => { await foto(p, "05-ia", p.getByRole("button", { name: /Regenta IA/ })); });
await intento("equipo", async () => { await ir(p, "/equipo"); await foto(p, "06-midrogueria");
  await foto(p, "07-equipo", p.getByRole("region", { name: /Equipo/ })); await foto(p, "08-formato", p.getByText(/Formato de la factura|Tamaño carta/).first()); });
await intento("productos", async () => { await ir(p, "/productos"); await foto(p, "09-productos", p.getByRole("link", { name: "Agregar producto" }));
  await ir(p, "/productos/nuevo"); await foto(p, "10-producto-nuevo");
  await p.getByRole("tab", { name: "Producto nuevo" }).click(); await p.fill("#nombre", "Acetaminofén 500 mg tabletas caja x 100"); await p.fill("#laboratorio", "Genfar");
  await p.fill("#upc", "100"); await p.fill("#precio_caja", "12000"); await p.fill("#ex-lote", "L2026A");
  const v = new Date(Date.now() + 400 * 864e5).toISOString().slice(0, 10); await p.fill("#ex-vence", v); await p.fill("#ex-unidades", "300"); await p.fill("#ex-costo", "80");
  await foto(p, "10b-producto-lote", p.locator("fieldset").filter({ hasText: "Lote y fecha de vencimiento" })); await ir(p, "/productos/importar"); await foto(p, "11-importar", p.getByRole("button", { name: "Descargar la plantilla" })); });
await intento("recibir", async () => { await ir(p, "/inventario/recibir"); await foto(p, "12-recibir", p.getByRole("button", { name: /Subir ZIP/ })); });
await intento("turno", async () => { await ir(p, "/turno"); await p.locator("input").first().fill("150000"); await foto(p, "13-turno-abrir", p.getByRole("button", { name: "Abrir turno" }));
  await p.getByRole("button", { name: "Abrir turno" }).click(); await p.waitForTimeout(1200); await foto(p, "14-turno-abierto"); });
await intento("caja", async () => {
  await ir(p, "/caja"); await foto(p, "15-caja", 'input[placeholder="Buscar o escanear"]');
  await p.locator('input[placeholder="Buscar o escanear"]').fill("acetaminofen forte"); await p.waitForTimeout(900); await foto(p, "16-buscar", '[role="listbox"][aria-label="Resultados"]');
  await p.keyboard.press("Enter"); await p.waitForTimeout(500);
  await p.locator('input[placeholder="Buscar o escanear"]').fill("dolex"); await p.waitForTimeout(900);
  const u = p.getByRole("option").first().getByRole("button", { name: /Unidad/ }); if (await u.count()) await u.click(); else await p.keyboard.press("Enter");
  await p.waitForTimeout(500); await foto(p, "17-carrito", 'aside[aria-label="Venta actual"]');
  await foto(p, "18-tipo-doc", '[role="group"][aria-label="Documento"]');
  await p.keyboard.press("F9"); await p.waitForTimeout(700); await foto(p, "19-cobrar", "#recibido");
  await p.fill("#recibido", "100000"); await p.waitForTimeout(300); await foto(p, "20-cambio", p.getByRole("button", { name: /Confirmar/ }));
  await p.getByRole("button", { name: /Confirmar/ }).click(); await p.getByText(/aceptad/).first().waitFor({ timeout: 15000 }); await p.waitForTimeout(800); await foto(p, "21-hecho");
  await p.keyboard.press("Enter"); await p.waitForTimeout(500);
});
await intento("factura", async () => {
  await p.locator('input[placeholder="Buscar o escanear"]').fill("loratadina"); await p.waitForTimeout(900); await p.keyboard.press("Enter"); await p.waitForTimeout(400);
  await p.getByRole("button", { name: "Factura electrónica" }).click(); await p.waitForTimeout(500); await foto(p, "22-factura", 'aside[aria-label="Venta actual"]');
  const doc = p.getByPlaceholder(/documento|NIT|cédula/i).first(); if (await doc.count()) { await doc.fill("900456789"); await p.waitForTimeout(1200); }
  await p.locator('aside[aria-label="Venta actual"]').getByText("Hogar Geriátrico San José S.A.S.").click(); await p.waitForTimeout(600);
  await foto(p, "23-cliente", 'aside[aria-label="Venta actual"]');
  await p.keyboard.press("F9"); await p.waitForTimeout(700); await p.fill("#recibido", "50000").catch(() => {}); await foto(p, "23a-facturar", p.getByRole("button", { name: /^Facturar/ })); await p.getByRole("button", { name: /^Facturar/ }).click();
  await p.getByText(/aceptad/i).first().waitFor({ timeout: 15000 }); await p.waitForTimeout(800); await foto(p, "23b-factura-hecha", p.getByRole("button", { name: /Ver la factura|factura/i }));
  await ir(p, "/ventas"); const fila = p.locator("a").filter({ hasText: /SETT/ }).first(); const href = await fila.getAttribute("href");
  const vid = href?.split("/").pop(); if (vid) { const q = await p.context().newPage(); await q.setViewportSize({ width: 1920, height: 1080 }); await q.goto(B + "/tiquete/factura/" + vid); await q.waitForLoadState("networkidle"); await limpiar(q); await q.screenshot({ path: `${D}/23c-factura-carta.png`, fullPage: true });
    await q.goto(B + "/tiquete/" + vid); await q.waitForLoadState("networkidle"); await limpiar(q); await q.screenshot({ path: `${D}/23d-tirilla.png`, fullPage: true }); await q.close(); }
});
await intento("pedidos", async () => { await ir(p, "/pedidos"); await foto(p, "24-pedidos"); });
await intento("ventas", async () => { await ir(p, "/ventas"); await foto(p, "25-ventas");
  const v = p.locator("tbody tr a, ul li a").filter({ hasText: /SETP|SETT/ }).first(); if (await v.count()) { await v.click(); await p.waitForLoadState("networkidle"); await foto(p, "26-venta-detalle", p.getByRole("button", { name: /Devolver|Devolución/ })); } });
await intento("clientes", async () => { await ir(p, "/clientes"); await foto(p, "27-clientes"); await ir(p, "/cartera"); await foto(p, "28-cartera", p.getByRole("button", { name: "Recibir pago" }));
  await p.getByRole("button", { name: "Recibir pago" }).first().click(); await p.waitForTimeout(600); await foto(p, "29-recibir-pago"); });
await intento("inventario", async () => { await ir(p, "/inventario"); await foto(p, "30-inventario", p.getByRole("link", { name: "Descargar en Excel" }));
  await ir(p, "/inventario?ver=vencidos"); await foto(p, "31-vencidos"); await ir(p, "/inventario/ajustes"); await foto(p, "32-ajustes");
  await ir(p, "/inventario/conteos"); await foto(p, "33-conteo", p.getByRole("button", { name: "Empezar a contar" })); await ir(p, "/inventario/lotes"); await foto(p, "34-lotes");
  await ir(p, "/inventario/cuarentena"); await foto(p, "35-cuarentena"); });
await intento("precios", async () => { await ir(p, "/productos/precios"); await foto(p, "36-precios"); await ir(p, "/etiquetas"); await foto(p, "37-etiquetas"); });
await intento("alertas", async () => { await ir(p, "/alertas"); await foto(p, "38-alertas"); await ir(p, "/prediccion"); await foto(p, "39-prediccion"); });
await intento("compras", async () => { await ir(p, "/compras"); await foto(p, "40-compras"); await ir(p, "/cuentas-por-pagar"); await foto(p, "41-cxp"); });
await intento("cumplimiento", async () => { await ir(p, "/documentos"); await foto(p, "42-documentos"); await ir(p, "/temperatura"); await foto(p, "43-temperatura");
  await ir(p, "/control-especial"); await foto(p, "44-control"); });
await intento("reportes", async () => { await ir(p, "/reportes"); await foto(p, "45-reportes"); await ir(p, "/reportes/cierre"); await foto(p, "46-cierre");
  await ir(p, "/reportes/resultados"); await foto(p, "47-resultados"); await ir(p, "/reportes/iva"); await foto(p, "48-iva"); await ir(p, "/gastos"); await foto(p, "49-gastos"); await ir(p, "/bitacora"); await foto(p, "50-bitacora"); });
await intento("cerrar", async () => { await ir(p, "/turno"); const s = p.getByRole("region", { name: "Cerrar turno" }); await s.locator("input").first().fill("250000");
  await foto(p, "51-cerrar-turno", s); });
await intento("ayuda", async () => { await ir(p, "/ayuda"); await foto(p, "53-ayuda", p.getByRole("link", { name: "Ayuda" }).last()); });
await intento("celular", async () => { const m = await entrar("Laura", { ...devices["iPhone 13"], locale: "es-CO", timezoneId: "America/Bogota" }); await ir(m, "/caja"); await limpiar(m); await m.screenshot({ path: `${D}/52-celular.png` }); });
writeFileSync(`${D}/cajas.json`, JSON.stringify(cajas, null, 1));
await b.close();
