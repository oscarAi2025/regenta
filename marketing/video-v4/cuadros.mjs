// Fotogramas sueltos para revisar la composición. Uso: node cuadros.mjs <formato> <carpeta> t1 t2 …  (también vuelca SFX a sfx.json)
import { createRequire } from "module"; const { chromium } = createRequire(import.meta.url)("playwright");
import fs from "fs"; import path from "path";
const [,, fmt, dir, ...ts] = process.argv; const [w, h] = { h: [1920, 1080], v: [1080, 1920], c: [1080, 1080] }[fmt];
const here = path.dirname(new URL(import.meta.url).pathname);
const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: w, height: h } });
const errs = []; p.on("pageerror", (e) => errs.push(e.message)); p.on("console", (m) => m.type() === "error" && errs.push(m.text()));
await p.goto("file://" + here + "/web/film.html?f=" + fmt); await p.evaluate(() => window.listo);
fs.writeFileSync(here + "/sfx.json", JSON.stringify(await p.evaluate(() => window.SFX), null, 1));
fs.mkdirSync(dir, { recursive: true });
for (const t of ts) { await p.evaluate((t) => window.render(t), Number(t)); await p.screenshot({ path: `${dir}/${fmt}-${t}.jpg`, type: "jpeg", quality: 85 }); }
console.log(errs.join("\n") || "sin errores"); await b.close();
