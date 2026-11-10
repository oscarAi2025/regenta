// Enlaces malformados no rompen ninguna pantalla: parámetros repetidos (?q=a&q=b), fechas imposibles, páginas fuera de
// rango e ids que no son UUID. Debe verse la pantalla (o el 404 en español), nunca el error técnico de Next.
// Uso: servidor con REGENTA_DEMO=1 y la base recién sembrada → node tests/e2e/parametros.mjs
import { chromium } from "playwright-core";

const B = process.env.BASE ?? "http://localhost:4500";
let fallos = 0;
const ok = (c, m, x = "") => { console.log(`${c ? "PASS" : "FAIL"} ${m}${x ? " — " + x : ""}`); if (!c) fallos++; };
const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium" });
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.addInitScript(() => { try { sessionStorage.setItem("regenta_demo_v1", JSON.stringify({ hechos: [], ofertas: ["p", "p"], cerrada: true, inicio: Date.now() })); } catch {} });
const p = await ctx.newPage();
await p.goto(B + "/entrar"); await p.getByRole("button", { name: /Carlos/ }).click(); await p.waitForURL(/\/(caja|inicio)/);
const REP = "q=a&q=b&ver=todos&ver=x&pagina=2&pagina=-3&desde=2026-02-30&desde=x&hasta=2026-04-31&hasta=y&mes=2026-13&mes=x&motivo=a&motivo=b&estado=a&estado=b&cliente=--&cliente=x&proveedor=-&proveedor=x&dia=x&dia=y";
const rutas = ["/inventario", "/clientes", "/compras", "/gastos", "/pedidos", "/cartera", "/ventas", "/ventas/historial", "/productos", "/reportes", "/reportes/iva",
  "/reportes/resultados", "/documentos", "/bitacora", "/temperatura", "/control-especial", "/inventario/ajustes", "/prediccion", "/baja"];
for (const r of rutas) {
  await p.goto(`${B}${r}?${REP}`); await p.waitForLoadState("networkidle");
  const t = await p.locator("body").innerText();
  ok(!/Application error|server-side exception|This page could not be found/.test(t), `${r} con parámetros repetidos se ve bien`, t.slice(0, 120).replace(/\n/g, " "));
}
for (const r of ["/tiquete/factura/", "/tiquete/", "/ventas/", "/clientes/", "/productos/", "/compras/", "/pedidos/", "/ventas/historial/", "/inventario/conteos/"]) {
  for (const id of ["------------------------------------", "abcdefabcdefabcdefabcdefabcdefabcdef"]) {
    await p.goto(B + r + id); await p.waitForLoadState("networkidle");
    const t = await p.locator("body").innerText();
    ok(/No encontramos esa página/.test(t) && !/Application error/.test(t), `${r}<id falso> muestra el 404 en español`, t.slice(0, 100).replace(/\n/g, " "));
  }
}
await p.goto(B + "/clientes?pagina=999"); await p.waitForLoadState("networkidle");
ok(!/pagina=999/.test(p.url()) && /Clientes|clientes/.test(await p.locator("main").innerText()), "una página de clientes que no existe vuelve a la primera", p.url());
await b.close();
console.log(`\n${fallos} fallos`);
process.exit(fallos ? 1 : 0);
