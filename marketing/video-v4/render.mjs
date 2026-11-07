// Render de un tramo [a, b) de la película a MP4 (30 fps, x264). Uso: node render.mjs <formato h|v|c> <salida.mp4> <a> <b>
import { createRequire } from "module"; const { chromium } = createRequire(import.meta.url)("playwright");
import { spawn } from "child_process"; import fs from "fs"; import path from "path";
const [,, fmt, salida, a, b] = process.argv; const FPS = 30;
const [w, h] = { h: [1920, 1080], v: [1080, 1920], c: [1080, 1080] }[fmt];
const f0 = Math.round(Number(a) * FPS), f1 = Math.round(Number(b) * FPS);
const br = await chromium.launch(); const p = await br.newPage({ viewport: { width: w, height: h } });
const errs = []; p.on("pageerror", (e) => errs.push(e.message));
await p.goto("file://" + path.resolve(path.dirname(new URL(import.meta.url).pathname), "web/film.html") + "?f=" + fmt); await p.evaluate(() => window.listo);
const tmp = salida.replace(/\.mp4$/, ".tmp.mp4");
const ff = spawn("ffmpeg", ["-v", "error", "-y", "-f", "image2pipe", "-framerate", String(FPS), "-c:v", "mjpeg", "-i", "-", "-c:v", "libx264", "-preset", "medium", "-crf", "17", "-pix_fmt", "yuv420p", "-r", String(FPS), tmp], { stdio: ["pipe", "inherit", "inherit"] });
for (let f = f0; f < f1; f++) {
  await p.evaluate((T) => window.render(T), f / FPS);
  const buf = await p.screenshot({ type: "jpeg", quality: 92 });
  if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
}
ff.stdin.end(); const code = await new Promise((r) => ff.on("close", r)); await br.close();
if (errs.length) console.error(errs.join("\n"));
if (code === 0) { fs.renameSync(tmp, salida); console.log("hecho", salida, f1 - f0); } else process.exit(1);
