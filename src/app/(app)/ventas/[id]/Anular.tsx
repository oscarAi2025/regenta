"use client";
import { useState } from "react";

/** Anular la venta. Si el documento ya está en la DIAN, sale la nota crédito de anulación en el mismo momento. */
export function Anular({ id, emitido }: { id: string; emitido: boolean }) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  async function anular() {
    setEnviando(true); setError("");
    const r = await fetch(`/api/ventas/${id}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ motivo }) }).catch(() => null);
    if (!r) { setError("Sin conexión: revisa internet e intenta de nuevo."); setEnviando(false); return; }
    if (r.ok) { location.reload(); return; }
    setError((await r.json().catch(() => ({}))).error ?? "No se pudo anular"); setEnviando(false);
  }
  if (!abierto) return <div><button onClick={() => setAbierto(true)} className="btn-peligro">{emitido ? "Anular y avisar a la DIAN" : "Anular venta"}</button></div>;
  return (
    <div className="tarjeta p-5 border-alerta">
      <h2 className="titulo text-xl">Anular esta venta</h2>
      <p className="text-sm text-muted mt-1">
        Las unidades vuelven a sus lotes. {emitido
          ? "Como el documento ya está en la DIAN, se envía ahora mismo una nota crédito por el total que lo anula."
          : "El documento todavía no había salido a la DIAN: se anula sin enviar nada."}
      </p>
      <label htmlFor="motivo" className="etiqueta mt-4">Motivo</label>
      <input id="motivo" className="campo" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: error en el producto facturado" autoFocus />
      {error && <p role="alert" className="mt-2 text-sm text-alerta">{error}</p>}
      <div className="mt-4 flex flex-wrap gap-2">
        <button onClick={anular} disabled={enviando || motivo.trim().length < 4} className="btn-peligro">{enviando ? (emitido ? "Anulando y enviando a la DIAN…" : "Anulando…") : "Confirmar anulación"}</button>
        <button onClick={() => setAbierto(false)} className="btn-borde">Cancelar</button>
      </div>
    </div>
  );
}
