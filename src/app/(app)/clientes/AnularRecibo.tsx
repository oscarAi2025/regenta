"use client";
import { useState } from "react";

/** Anular un recibo de caja con motivo (dueño o administrador). Cambia el estado de cuenta entero: se recarga la ficha. */
export function AnularRecibo({ id, numero }: { id: number; numero: number }) {
  const [abierto, setAbierto] = useState(false), [motivo, setMotivo] = useState(""), [error, setError] = useState(""), [enviando, setEnviando] = useState(false);
  if (!abierto) return <button className="text-sm font-semibold text-alerta underline" onClick={() => setAbierto(true)} aria-label={`Anular el recibo RC-${numero}`}>Anular</button>;
  return (
    <form className="grid gap-2 min-w-[220px]" aria-label={`Anular RC-${numero}`} onSubmit={async (e) => {
      e.preventDefault(); if (enviando) return; setEnviando(true); setError("");
      try {
        const r = await fetch(`/api/recibos/${id}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ motivo }) });
        const j = await r.json();
        if (!r.ok) { setError(j.error ?? "No se pudo anular"); return; }
        location.assign(location.pathname + "?anulado=" + numero);
      } catch { setError("Sin conexión con el servidor"); } finally { setEnviando(false); }
    }}>
      <label htmlFor={`an-${id}`} className="text-sm font-semibold">Motivo de la anulación</label>
      <input id={`an-${id}`} className="campo h-10" maxLength={200} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Pago devuelto por el banco…" />
      {error && <p role="alert" className="text-sm text-alerta">{error}</p>}
      <div className="flex gap-2">
        <button className="btn-peligro h-9 text-sm" disabled={enviando || motivo.trim().length < 4}>{enviando ? "Anulando…" : "Anular recibo"}</button>
        <button type="button" className="text-sm text-muted" onClick={() => { setAbierto(false); setError(""); }}>Cancelar</button>
      </div>
    </form>
  );
}
