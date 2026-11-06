"use client";
import { useState } from "react";

/** Anular un conteo abierto (dueño o administrador): no toca el inventario y libera la sede para empezar otro. */
export function AnularConteo({ id, numero }: { id: string; numero: number }) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function anular(e: React.FormEvent) {
    e.preventDefault();
    if (motivo.trim().length < 4) { setError("Escribe el motivo de la anulación"); return; }
    setEnviando(true); setError("");
    const r = await fetch(`/api/inventario/conteos/${id}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ motivo }) }).catch(() => null);
    if (!r) { setEnviando(false); setError("Sin conexión: revisa internet e intenta de nuevo."); return; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setEnviando(false); setError(j.error ?? "No se pudo anular el conteo"); return; }
    location.href = `/inventario/conteos/${id}`;
  }

  if (!abierto) return <button type="button" className="btn-borde" onClick={() => setAbierto(true)}>Anular conteo</button>;
  return (
    <form onSubmit={anular} className="tarjeta p-4 grid gap-3 w-full max-w-xl border-alerta/40" aria-label="Anular conteo">
      <p className="text-[15px]"><b>Anular el conteo N.º {numero}.</b> No cambia ninguna existencia: lo contado queda guardado como anulado y puedes empezar un conteo nuevo.</p>
      <label className="grid gap-1 text-sm font-semibold">Motivo
        <input id="anular-motivo" className="campo font-normal" value={motivo} maxLength={300} onChange={(e) => setMotivo(e.target.value)} placeholder="Por ejemplo: se empezó con el filtro equivocado" autoFocus />
      </label>
      {error && <p role="alert" className="text-alerta text-sm font-semibold">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button className="btn-oscuro" disabled={enviando}>{enviando ? "Anulando…" : "Anular conteo"}</button>
        <button type="button" className="btn-borde" onClick={() => { setAbierto(false); setError(""); }}>Cancelar</button>
      </div>
    </form>
  );
}
