"use client";
import { useState } from "react";
import { useRefrescar } from "@/lib/refrescar";

const MAX_LADO = { ancho: 900, alto: 360 };
const LIMITE = 380000; // caracteres del base64 (la base acepta hasta 400.000)

/** Reduce la imagen en el navegador (máx. 900×360) y la deja en PNG; si pesa mucho, en WebP o JPG. */
async function preparar(f: File): Promise<string> {
  if (!/^image\/(png|jpeg|webp)$/.test(f.type)) throw new Error("Sube una imagen PNG, JPG o WebP (el SVG no se admite).");
  if (f.size > 8 * 1024 * 1024) throw new Error("La imagen pesa más de 8 MB: usa una más liviana.");
  const url = URL.createObjectURL(f);
  try {
    const img = await new Promise<HTMLImageElement>((ok, mal) => { const i = new Image(); i.onload = () => ok(i); i.onerror = () => mal(new Error("No se pudo leer la imagen.")); i.src = url; });
    const k = Math.min(1, MAX_LADO.ancho / img.naturalWidth, MAX_LADO.alto / img.naturalHeight);
    const cv = document.createElement("canvas");
    cv.width = Math.max(1, Math.round(img.naturalWidth * k)); cv.height = Math.max(1, Math.round(img.naturalHeight * k));
    cv.getContext("2d")!.drawImage(img, 0, 0, cv.width, cv.height);
    for (const [tipo, q] of [["image/png", undefined], ["image/webp", 0.9], ["image/jpeg", 0.88], ["image/jpeg", 0.75]] as const) {
      const d = cv.toDataURL(tipo, q);
      if (d.startsWith(`data:${tipo};`) && d.length <= LIMITE) return d;
    }
    throw new Error("El logo sigue pesando demasiado: recórtalo o usa una imagen más simple.");
  } finally { URL.revokeObjectURL(url); }
}

/** Logo que sale en la factura en tamaño carta. `endpoint` recibe PUT { logo } (null para quitarlo). */
export function SubirLogo({ endpoint, inicial }: { endpoint: string; inicial: string | null }) {
  const [logo, setLogo] = useState(inicial);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [ocupado, setOcupado] = useState(false);
  const refrescar = useRefrescar();

  async function guardar(valor: string | null) {
    setOcupado(true); setMsg(null);
    const r = await fetch(endpoint, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ logo: valor }) }).catch(() => null);
    const j = await r?.json().catch(() => ({}));
    setOcupado(false);
    if (!r?.ok) { setMsg({ ok: false, t: j?.error ?? "Sin conexión: vuelve a intentarlo." }); return; }
    setLogo(valor); setMsg({ ok: true, t: j.mensaje ?? "Guardado" }); void refrescar();
  }
  async function elegir(f: File | undefined) {
    if (!f) return;
    try { await guardar(await preparar(f)); } catch (e) { setMsg({ ok: false, t: (e as Error).message }); }
  }

  return (
    <section className="tarjeta p-5 grid gap-3" aria-labelledby="logo-t">
      <div>
        <h2 id="logo-t" className="titulo text-xl">Logo de las facturas</h2>
        <p className="text-sm text-muted">Sale arriba a la izquierda en la factura en tamaño carta. Mejor horizontal y con fondo, en PNG o JPG.</p>
      </div>
      <div className="flex flex-wrap items-center gap-4">
        <div className="h-24 w-64 rounded-xl border border-dashed border-line bg-paper grid place-items-center overflow-hidden">
          {logo ? <img src={logo} alt="Logo actual" className="max-h-full max-w-full object-contain" /> : <span className="text-sm text-muted">Sin logo</span>}
        </div>
        <div className="flex flex-wrap gap-2">
          <label className={`btn-oscuro h-10 text-sm cursor-pointer has-[:focus-visible]:outline has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-marca ${ocupado ? "opacity-60 pointer-events-none" : ""}`}>
            {ocupado ? "Guardando…" : logo ? "Cambiar logo" : "Subir logo"}
            <input type="file" accept="image/png,image/jpeg,image/webp" className="sr-only" data-prueba="archivo-logo" onChange={(e) => { void elegir(e.target.files?.[0]); e.target.value = ""; }} />
          </label>
          {logo && <button type="button" onClick={() => void guardar(null)} disabled={ocupado} className="btn-borde h-10 text-sm">Quitar logo</button>}
        </div>
      </div>
      {msg && <p role={msg.ok ? "status" : "alert"} className={`text-sm font-semibold ${msg.ok ? "text-cruz" : "text-alerta"}`}>{msg.t}</p>}
    </section>
  );
}
