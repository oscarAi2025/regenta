"use client";
import { useState } from "react";

export function Anular({ id }: { id: string }) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  async function anular() {
    setEnviando(true); setError("");
    const r = await fetch(`/api/ventas/${id}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ motivo }) });
    if (r.ok) { location.reload(); return; }
    setError((await r.json().catch(() => ({}))).error ?? "No se pudo anular"); setEnviando(false);
  }
  if (!abierto) return <div><button onClick={() => setAbierto(true)} className="btn-peligro">Anular venta</button></div>;
  return (
    <div className="tarjeta p-5 border-alerta">
      <h2 className="titulo text-xl">Anular esta venta</h2>
      <p className="text-sm text-muted mt-1">Las unidades vuelven a sus lotes. Ante la DIAN se corrige con nota crédito.</p>
      <label htmlFor="motivo" className="etiqueta mt-4">Motivo</label>
      <input id="motivo" className="campo" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: el cliente devolvió el producto" autoFocus />
      {error && <p role="alert" className="mt-2 text-sm text-alerta">{error}</p>}
      <div className="mt-4 flex gap-2">
        <button onClick={anular} disabled={enviando || motivo.trim().length < 4} className="btn-peligro">{enviando ? "Anulando…" : "Confirmar anulación"}</button>
        <button onClick={() => setAbierto(false)} className="btn-borde">Cancelar</button>
      </div>
    </div>
  );
}
