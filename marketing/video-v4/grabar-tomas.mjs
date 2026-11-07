// Grabaciones de la plataforma por dentro: cada toma es una secuencia de acciones reales (escribir, tocar, desplazar)
// con un cursor dibujado encima; cada fotograma es una captura, que se codifica a 30 fps (todo intra, para buscar exacto).
import { createRequire } from "module"; const { chromium, devices } = createRequire(import.meta.url)("playwright");
import { spawn } from "child_process";
const B = "http://localhost:4550", OUT = "/tmp/claude-0/vid/tomas";
const solo = process.argv.slice(2);
const br = await chromium.launch();

async function contexto(movil) {
  const c = await br.newContext(movil ? { ...devices["iPhone 13"], deviceScaleFactor: 3 } : { viewport: { width: 1600, height: 900 }, deviceScaleFactor: 1.2 });
  await c.addInitScript(() => {
    try { sessionStorage.setItem("regenta_demo_v1", JSON.stringify({ hechos: [], ofertas: ["prueba", "prueba"], cerrada: true, inicio: Date.now() })); } catch {}
    const poner = () => {
      for (const b of document.querySelectorAll("button")) if (/Guía de la demo/.test(b.textContent)) b.style.display = "none";
      for (const h of document.querySelectorAll("section,div")) if (h.children.length < 12 && /^Pruébalo en 3 minutos/.test((h.textContent || "").trim()) && h.getBoundingClientRect().width < 500) h.style.display = "none";
      if (document.getElementById("__cur")) return;
      const st = document.createElement("style");
      st.textContent = `[aria-label="Estás en la demo"],[aria-label="Recorrido de la demo"]{display:none!important} #__cur{position:fixed;left:0;top:0;z-index:2147483647;pointer-events:none;width:30px;height:30px;transform:translate(-3px,-2px);filter:drop-shadow(0 3px 6px rgba(0,0,0,.45))}
        #__rip{position:fixed;z-index:2147483646;pointer-events:none;width:16px;height:16px;border-radius:50%;border:3px solid #14b8a6;opacity:0;transform:translate(-50%,-50%)}`;
      document.head.appendChild(st);
      const c = document.createElement("div"); c.id = "__cur";
      c.innerHTML = `<svg viewBox="0 0 24 24" width="30" height="30"><path d="M4 2l15 11-6.5 1.2L9 21z" fill="#fff" stroke="#0b2540" stroke-width="1.6" stroke-linejoin="round"/></svg>`;
      const r = document.createElement("div"); r.id = "__rip";
      document.body.append(c, r);
      for (const b of document.querySelectorAll("button")) if (/Guía de la demo/.test(b.textContent)) b.style.display = "none";
    };
    document.addEventListener("DOMContentLoaded", poner); setInterval(poner, 200);
  });
  const p = await c.newPage(); await p.request.post(B + "/demo", { form: { rol: "dueno" } });
  return { c, p };
}

async function toma(nombre, movil, fn) {
  if (solo.length && !solo.includes(nombre)) return;
  const { c, p } = await contexto(movil);
  const ff = spawn("ffmpeg", ["-v", "error", "-y", "-f", "image2pipe", "-framerate", "30", "-c:v", "mjpeg", "-i", "-", "-vf", movil ? "scale=1170:2532" : "scale=1920:1080",
    "-c:v", "libx264", "-preset", "fast", "-crf", "16", "-g", "1", "-pix_fmt", "yuv420p", `${OUT}/${nombre}.mp4`], { stdio: ["pipe", "inherit", "inherit"] });
  let cur = { x: movil ? 200 : 800, y: movil ? 500 : 450 }, frames = 0;
  const cuadro = async () => {
    await p.evaluate(([x, y]) => { const e = document.getElementById("__cur"); if (e) { e.style.left = x + "px"; e.style.top = y + "px"; } }, [cur.x, cur.y]).catch(() => {});
    const b = await p.screenshot({ type: "jpeg", quality: 92 }); if (!ff.stdin.write(b)) await new Promise((r) => ff.stdin.once("drain", r)); frames++;
  };
  const r = {
    p, cuadro,
    esperar: async (n) => { for (let i = 0; i < n; i++) await cuadro(); },
    ir: async (ruta) => { await p.goto(B + ruta, { waitUntil: "networkidle" }); await p.waitForTimeout(300); },
    mover: async (sel, n = 18, dx = 0, dy = 0) => {
      const bb = typeof sel === "string" ? await p.locator(sel).first().boundingBox() : sel;
      const to = { x: bb.x + (bb.width ?? 0) / 2 + dx, y: bb.y + (bb.height ?? 0) / 2 + dy }, from = { ...cur };
      for (let i = 1; i <= n; i++) { const k = i / n, e = k < .5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2; cur = { x: from.x + (to.x - from.x) * e, y: from.y + (to.y - from.y) * e }; await cuadro(); }
    },
    clic: async (sel, n = 18) => {
      await r.mover(sel, n);
      await p.evaluate(([x, y]) => { const e = document.getElementById("__rip"); e.style.left = x + "px"; e.style.top = y + "px"; e.animate([{ opacity: 1, width: "10px", height: "10px" }, { opacity: 0, width: "70px", height: "70px" }], { duration: 450 }); }, [cur.x, cur.y]);
      await (typeof sel === "string" ? p.locator(sel).first().click() : p.mouse.click(cur.x, cur.y)); await r.esperar(6);
    },
    escribir: async (sel, txt, porLetra = 2) => { await p.locator(sel).first().focus(); for (const ch of txt) { await p.keyboard.type(ch); await r.esperar(porLetra); } },
    rodar: async (dy, n = 40) => { for (let i = 0; i < n; i++) { await p.mouse.wheel(0, dy / n); await p.waitForTimeout(16); await cuadro(); } },
  };
  await fn(r);
  ff.stdin.end(); await new Promise((x) => ff.on("close", x)); await c.close();
  console.log("toma", nombre, frames, "cuadros", (frames / 30).toFixed(1) + " s");
}

const agregar = async (r, q) => {
  await r.escribir("#buscar", q, 2);
  await r.p.waitForSelector('[aria-label="Resultados"] [role="option"]', { timeout: 8000 }).catch(() => {}); await r.esperar(8);
  await r.clic(r.p.locator('[aria-label="Resultados"] [role="option"]').first().getByRole("button").last().boundingBox ? await r.p.locator('[aria-label="Resultados"] [role="option"]').first().getByRole("button").last().boundingBox() : "#buscar");
  await r.esperar(10);
};

await toma("caja", false, async (r) => {
  await r.ir("/caja"); await r.esperar(12);
  await r.clic("#buscar", 20); await agregar(r, "acetaminofen"); await agregar(r, "loratadina"); await agregar(r, "suero");
  await r.clic(r.p.getByRole("button", { name: "Factura electrónica", exact: true }).boundingBox ? await r.p.getByRole("button", { name: "Factura electrónica", exact: true }).boundingBox() : "#buscar", 22); await r.esperar(15);
  await r.clic(await r.p.getByRole("button", { name: "Tiquete POS", exact: true }).boundingBox(), 16); await r.esperar(10);
  await r.clic(await r.p.getByRole("button", { name: /^Cobrar/ }).first().boundingBox(), 22); await r.esperar(16);
  const exacto = r.p.getByRole("button", { name: "Exacto", exact: true }).first();
  if (await exacto.count()) { await r.clic(await exacto.boundingBox(), 18); await r.esperar(10); }
  const conf = r.p.getByRole("button", { name: /^Confirmar/ }).first();
  if (await conf.count()) { await r.clic(await conf.boundingBox(), 18); for (let i = 0; i < 60; i++) await r.cuadro(); await r.esperar(30); }
});

await toma("inventario", false, async (r) => {
  await r.ir("/inventario"); await r.esperar(10);
  await r.mover("text=Vencen en 30 días", 24); await r.esperar(12);
  await r.rodar(520, 60); await r.esperar(10);
  await r.mover({ x: 1000, y: 420, width: 0, height: 0 }, 20); await r.esperar(10);
  await r.rodar(-520, 40); await r.esperar(8);
  await r.clic(await r.p.getByRole("link", { name: /^Agotados/ }).first().boundingBox().catch(() => ({ x: 450, y: 330, width: 0, height: 0 })), 20); await r.esperar(30);
});

await toma("ia", false, async (r) => {
  await r.ir("/inicio"); await r.esperar(10);
  await r.clic(await r.p.getByRole("button", { name: "Abrir Regenta IA", exact: true }).boundingBox(), 26); await r.esperar(12);
  await r.escribir("#ia-texto", "¿Qué debo pedir esta semana?", 2); await r.esperar(8);
  await r.clic(await r.p.getByRole("button", { name: "Enviar" }).boundingBox(), 14);
  for (let i = 0; i < 140; i++) { await r.cuadro(); if (i > 30 && await r.p.getByText("Consultó:").count()) { await r.esperar(30); break; } }
});

await toma("prediccion", false, async (r) => {
  await r.ir("/prediccion"); await r.esperar(10);
  await r.mover("text=Para pedir", 20); await r.esperar(8);
  await r.rodar(420, 50); await r.esperar(8);
  await r.clic(await r.p.getByRole("link", { name: /Se pueden vencer/ }).first().boundingBox().catch(() => ({ x: 900, y: 500, width: 0, height: 0 })), 20); await r.esperar(30);
});

await toma("alertas", false, async (r) => { await r.ir("/alertas"); await r.esperar(10); await r.mover("text=Tocan tu inventario", 24); await r.esperar(10); await r.rodar(300, 45); await r.esperar(20); });
await toma("temperatura", false, async (r) => {
  await r.ir("/temperatura"); await r.esperar(8);
  const campos = r.p.locator("main input[inputmode='decimal']");
  if (await campos.count() >= 2) { await r.clic(await campos.nth(0).boundingBox(), 20); await r.escribir("main input[inputmode='decimal'] >> nth=0", "21,5", 3); await r.clic(await campos.nth(1).boundingBox(), 14); await r.escribir("main input[inputmode='decimal'] >> nth=1", "55", 3); }
  await r.esperar(30);
});
await toma("resultados", false, async (r) => { await r.ir("/reportes/resultados"); await r.esperar(10); await r.mover("text=Ventas netas", 24); await r.esperar(10); await r.rodar(380, 50); await r.esperar(20); });
await toma("control", false, async (r) => { await r.ir("/control-especial"); await r.esperar(10); await r.rodar(300, 45); await r.esperar(20); });
await toma("movil", true, async (r) => {
  await r.ir("/caja"); await r.esperar(10);
  await r.clic("#buscar", 16); await r.escribir("#buscar", "ibuprofeno", 2);
  await r.p.waitForSelector('[aria-label="Resultados"] [role="option"]', { timeout: 8000 }).catch(() => {}); await r.esperar(10);
  await r.clic(await r.p.locator('[aria-label="Resultados"] [role="option"]').first().getByRole("button").last().boundingBox(), 16); await r.esperar(30);
});

await toma("recibir", false, async (r) => {
  await r.ir("/inventario/recibir"); await r.esperar(8);
  await r.clic("#proveedor", 18); await r.escribir("#proveedor", "Laboratorio Andino", 1); await r.esperar(3);
  await r.clic("#factura", 14); await r.escribir("#factura", "FE-2045", 2);
  await r.clic("#buscar-recibir", 16); await r.escribir("#buscar-recibir", "acetaminofen MK", 2); await r.esperar(10);
  const op = r.p.locator("button", { hasText: /Acetaminofen MK tabletas 500 mg caja x 24/ }).first();
  await r.clic(await op.boundingBox(), 16); await r.esperar(10);
  await r.clic("#lote-1", 14); await r.escribir("#lote-1", "L2611A", 2);
  await r.clic("#vence-1", 14); await r.p.locator("#vence-1").fill("2028-05-31"); await r.esperar(8);
  await r.clic("#cajas-1", 14); await r.escribir("#cajas-1", "12", 3);
  await r.clic("#costo-1", 14); await r.escribir("#costo-1", "21000", 2); await r.esperar(30);
});

await br.close();
