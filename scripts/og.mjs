// Imagen para compartir (1200×630): logo, promesa y captura. Uso: servidor en :4500 → node scripts/og.mjs
import { chromium } from "playwright-core";
import { readFileSync } from "node:fs";
const icono = readFileSync(new URL("../src/app/icon.svg", import.meta.url), "utf8");
const fuente = (f) => "data:font/woff2;base64," + readFileSync(new URL(`../node_modules/@fontsource/${f}`, import.meta.url)).toString("base64");
const caja = "data:image/webp;base64," + readFileSync(new URL("../public/capturas/facturacion.webp", import.meta.url)).toString("base64");
const html = `<!doctype html><html><head><style>
@font-face{font-family:'Barlow Semi Condensed';font-weight:700;src:url(${fuente('barlow-semi-condensed/files/barlow-semi-condensed-latin-700-normal.woff2')})}@font-face{font-family:Barlow;font-weight:500;src:url(${fuente('barlow/files/barlow-latin-500-normal.woff2')})}@font-face{font-family:Barlow;font-weight:600;src:url(${fuente('barlow/files/barlow-latin-600-normal.woff2')})}
body{margin:0;width:1200px;height:630px;font-family:Barlow,sans-serif;font-weight:500;color:#fff;overflow:hidden;
background:radial-gradient(55% 70% at 88% 8%,rgba(20,184,166,.35),transparent 62%),radial-gradient(50% 60% at 6% 96%,rgba(37,99,235,.4),transparent 62%),#0b1f33}
.l{position:absolute;left:64px;top:56px;width:560px}.m{display:flex;align-items:center;gap:14px}.m svg{width:64px;height:64px}
.w{font-family:'Barlow Semi Condensed',sans-serif;font-weight:700;font-size:48px;letter-spacing:-.03em;line-height:1}.d{color:#5eead4;font-weight:600;font-size:17px}
h1{font-family:'Barlow Semi Condensed',sans-serif;font-weight:700;font-size:58px;line-height:.98;margin:40px 0 0;letter-spacing:-.02em}
h1 span{background:linear-gradient(90deg,#5eead4,#60a5fa 55%,#fcd34d);-webkit-background-clip:text;color:transparent}
p{font-size:21px;color:rgba(255,255,255,.78);margin-top:18px;line-height:1.35}.c{position:absolute;right:-120px;top:110px;width:600px;border-radius:18px;border:6px solid rgba(255,255,255,.12);box-shadow:0 40px 80px -30px #000}
.b{position:absolute;left:64px;bottom:50px;background:#fbbf24;color:#0b1f33;font-weight:700;font-size:22px;padding:14px 26px;border-radius:14px}</style></head><body>
<div class="l"><div class="m">${icono}<div><div class="w">Regenta</div><div class="d">Facturación e IA para el sector farmacéutico</div></div></div>
<h1>Facturación electrónica e IA para <span>droguerías, farmacias y distribuidoras</span></h1>
<p>Hecho por gente del sector farmacéutico.<br>By Farmagenéricos Colombia.</p></div>
<img class="c" src="${caja}"><div class="b">Prueba la demo gratis</div></body></html>`;
const b = await chromium.launch({ executablePath: process.env.CHROME ?? "/opt/pw-browsers/chromium" });
const p = await (await b.newContext({ viewport: { width: 1200, height: 630 } })).newPage();
await p.setContent(html, { waitUntil: "networkidle" });
await p.screenshot({ path: new URL("../public/capturas/og.png", import.meta.url).pathname });
await b.close();
