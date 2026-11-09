"use client";
import { useState } from "react";

export function ActivarDosPasos() {
  const [codigo, setCodigo] = useState(""), [error, setError] = useState(""), [enviando, setEnviando] = useState(false);
  async function activar(e: React.FormEvent) {
    e.preventDefault();
    if (enviando) return;
    setEnviando(true); setError("");
    const r = await fetch("/api/admin/dos-pasos", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ codigo }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    if (!r?.ok) { setError(r ? (j.error ?? "No se pudo activar") : "Sin conexión con el servidor: revisa internet."); setEnviando(false); return; }
    location.href = "/admin";
  }
  return (
    <form onSubmit={activar} className="grid gap-3" aria-label="Activar la verificación en dos pasos">
      <div>
        <label htmlFor="codigo-2p" className="etiqueta">Código de la app</label>
        <input id="codigo-2p" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required className="campo num text-2xl tracking-[0.3em]"
          value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/[^\d ]/g, ""))} />
      </div>
      {error && <p role="alert" className="text-alerta text-sm font-semibold">{error}</p>}
      <button disabled={enviando} className="btn-oscuro h-12 disabled:opacity-60">{enviando ? "Comprobando…" : "Activar y entrar a la consola"}</button>
    </form>
  );
}
