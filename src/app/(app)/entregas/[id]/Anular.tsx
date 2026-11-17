"use client";
import { useState } from "react";
import { useRefrescar } from "@/lib/refrescar";

/** Anular una entrega (gerencia): pide el motivo; las unidades vuelven a sus lotes. */
export function Anular({ id, numero }: { id: string; numero: number }) {
  const [abierto, setAbierto] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [estado, setEstado] = useState<"" | "enviando">("");
  const [msg, setMsg] = useState("");
  const refrescar = useRefrescar();
  async function anular(e: React.FormEvent) {
    e.preventDefault();
    if (motivo.trim().length < 4) { setMsg("Escribe el motivo de la anulación"); return; }
    setEstado("enviando"); setMsg("");
    try {
      const r = await fetch(`/api/entregas/${id}/anular`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ motivo }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(j.error ?? "No se pudo anular"); setEstado(""); return; }
      setAbierto(false); setEstado(""); void refrescar();
    } catch { setMsg("Sin conexión: intenta de nuevo"); setEstado(""); }
  }
  if (!abierto) return <div><button onClick={() => setAbierto(true)} className="btn-peligro">Anular la entrega EI-{numero}</button></div>;
  return (
    <form onSubmit={anular} className="tarjeta p-5 grid gap-3 max-w-xl" aria-label="Anular la entrega">
      <label htmlFor="motivo" className="etiqueta">Motivo de la anulación</label>
      <textarea id="motivo" className="campo !h-24 py-2" maxLength={300} value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Por ejemplo: se registró en el servicio equivocado" />
      <p className="text-sm text-muted">Las unidades vuelven a sus mismos lotes. La entrega no se borra: queda marcada como anulada, con el motivo.</p>
      {msg && <p role="alert" className="text-sm text-alerta font-semibold">{msg}</p>}
      <div className="flex flex-wrap gap-2">
        <button disabled={estado === "enviando"} className="btn-peligro disabled:opacity-60">{estado === "enviando" ? "Anulando…" : "Anular"}</button>
        <button type="button" onClick={() => { setAbierto(false); setMsg(""); }} className="btn-borde">Cancelar</button>
      </div>
    </form>
  );
}
