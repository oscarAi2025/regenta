// App de Android (TWA en Google Play), 28/11/2026: entrada /app, modo app sin compras (ocultas en pantalla y bloqueadas
// en el servidor), salida de la web de venta, archivos de la web instalable y página de eliminar cuenta. Y que en el
// navegador normal todo siga igual (los botones de compra se ven).
// Uso: servidor en :4500 (REGENTA_DEMO=1) → node tests/e2e/app-android.mjs
import { chromium } from "playwright-core";

const B = process.env.BASE ?? "http://localhost:4500";
let fallos = 0;
const ok = (c, m, x = "") => { console.log(`${c ? "PASS" : "FAIL"} ${m}${x ? " — " + x : ""}`); if (!c) fallos++; };
const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium" });

// 1) Archivos públicos de la web instalable y de Google Play.
for (const [ruta, tipo] of [["/manifest.webmanifest", /json/], ["/sw.js", /javascript/], ["/sin-conexion.html", /html/], ["/.well-known/assetlinks.json", /json/], ["/icon-512.png", /png/], ["/icon-maskable-512.png", /png/], ["/icon-192.png", /png/], ["/apple-touch-icon.png", /png/], ["/eliminar-cuenta", /html/]]) {
  const r = await fetch(B + ruta);
  ok(r.status === 200 && tipo.test(r.headers.get("content-type") ?? ""), `${ruta} responde 200 (${r.headers.get("content-type")})`);
}
const man = await (await fetch(B + "/manifest.webmanifest")).json();
ok(man.start_url === "/inicio" && man.display === "standalone" && man.icons.some((i) => i.purpose === "maskable"), "el manifiesto abre la consola, en pantalla completa y con icono maskable");
const al = await (await fetch(B + "/.well-known/assetlinks.json")).json();
ok(al[0]?.target?.package_name === "pro.regenta.android" && al[0].target.sha256_cert_fingerprints.length >= 1, "assetlinks declara pro.regenta.android con su huella");

// 2) Entrada de la app: marca la cookie y lleva a la consola.
const r = await fetch(B + "/app?plataforma=android", { redirect: "manual" });
ok(r.status === 302 && r.headers.get("location") === "/inicio", "/app redirige a /inicio", `${r.status} ${r.headers.get("location")}`);
ok(/regenta_app=android/.test(r.headers.get("set-cookie") ?? ""), "/app marca la cookie regenta_app");
const r2 = await fetch(B + "/app?plataforma=ios", { redirect: "manual" });
ok(!/regenta_app/.test(r2.headers.get("set-cookie") ?? ""), "una plataforma desconocida no marca la cookie");

// 3) El servidor bloquea los pagos desde la app (y solo desde la app).
const cuerpo = JSON.stringify({ plan: "pro", periodo: "mes", proveedor: "qr" });
const pApp = await fetch(B + "/api/pagos", { method: "POST", headers: { "content-type": "application/json", origin: B, cookie: "regenta_app=android" }, body: cuerpo });
ok(pApp.status === 403 && /navegador/.test((await pApp.json()).error ?? ""), "POST /api/pagos desde la app → 403");
const pWeb = await fetch(B + "/api/pagos", { method: "POST", headers: { "content-type": "application/json", origin: B }, body: cuerpo });
ok(pWeb.status === 400, "POST /api/pagos desde la web sigue validando (400 por datos incompletos, no 403)", String(pWeb.status));

// 4) En la app (celular): la web de venta lleva a la consola; la demo no muestra compras.
const app = await b.newContext({ viewport: { width: 412, height: 860 } });
await app.addCookies([{ name: "regenta_app", value: "android", url: B }]);
const p = await app.newPage();
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
for (const ruta of ["/", "/precios", "/contratar?plan=pro", "/software", "/guias"]) {
  await p.goto(B + ruta); await p.waitForLoadState("networkidle");
  ok(new URL(p.url()).pathname === "/entrar", `app: ${ruta} no se muestra (sin sesión termina en /entrar)`, p.url());
}
ok(await p.locator("html[data-app=android]").count() === 1, "app: <html data-app=android>");
ok(!(await p.getByText("Contrata Regenta").isVisible()), "app: «Contrata Regenta» oculto en Entrar");
await p.getByRole("button", { name: /Carlos/ }).click();
await p.waitForURL(/\/inicio/);
const barra = p.getByRole("region", { name: "Estás en la demo" });
ok(await barra.isVisible(), "app: la demo funciona (barra visible)");
ok(!(await barra.getByRole("link", { name: "Contratar ahora" }).isVisible()), "app: sin «Contratar ahora» en la barra");
ok(!/\$\s?[\d.]+/.test(await barra.innerText()), "app: la barra no muestra precios", await barra.innerText());
await p.goto(B + "/equipo"); await p.waitForLoadState("networkidle");
const visibles = await p.locator('a[href^="/contratar"]').evaluateAll((as) => as.filter((a) => a.offsetParent !== null).length);
ok(visibles === 0, "app: ningún enlace a /contratar visible en Equipo", String(visibles));
await p.goto(B + "/cuenta"); await p.waitForLoadState("networkidle");
ok(await p.getByRole("link", { name: "Ver cómo eliminarla" }).isVisible(), "app: Mi cuenta enlaza a eliminar la cuenta");
await p.getByRole("link", { name: "Ver cómo eliminarla" }).click(); await p.waitForURL(/eliminar-cuenta/);
ok(new URL(p.url()).pathname === "/eliminar-cuenta", "app: /eliminar-cuenta se abre dentro de la app");
ok(await p.getByRole("link", { name: "Volver a Regenta" }).isVisible(), "app: la cabecera pública muestra «Volver a Regenta»");
ok(!(await p.locator("footer").isVisible()) && !(await p.getByRole("navigation", { name: "Página" }).isVisible()), "app: sin menú ni pie de la web de venta");
await p.screenshot({ path: "test-results/app-eliminar-cuenta.png", fullPage: true });
ok(errs.length === 0, "app: sin errores de JavaScript", errs.join(" | "));

// 5) En el navegador normal nada cambia.
const web = await b.newContext({ viewport: { width: 1280, height: 860 } });
const w = await web.newPage();
await w.goto(B + "/precios"); await w.waitForLoadState("networkidle");
ok(new URL(w.url()).pathname === "/precios", "web: /precios se ve normal");
await w.goto(B + "/entrar");
ok(await w.getByText("Contrata Regenta").isVisible(), "web: «Contrata Regenta» visible en Entrar");
await w.getByRole("button", { name: /Carlos/ }).click(); await w.waitForURL(/\/inicio/);
ok(await w.getByRole("region", { name: "Estás en la demo" }).getByRole("link", { name: "Contratar ahora" }).isVisible(), "web: la demo mantiene «Contratar ahora»");
await w.goto(B + "/eliminar-cuenta");
ok(await w.locator("footer").isVisible() && !(await w.getByRole("link", { name: "Volver a Regenta" }).isVisible()), "web: /eliminar-cuenta con pie y sin «Volver a Regenta»");

await b.close();
console.log(fallos ? `\n${fallos} FALLOS` : "\nTODO OK");
process.exit(fallos ? 1 : 0);
