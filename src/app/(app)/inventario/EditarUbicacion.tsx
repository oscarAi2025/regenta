"use client";
import { useState } from "react";

/** Ubicación del producto en la estantería, editable en la misma fila del inventario (bodega y gerencia). */
export function EditarUbicacion({ id, inicial }: { id: string; inicial: string | null }) {
  const [u, setU] = useState(inicial ?? "");
  const [editando, setEditando] = useState(false);
  const [texto, setTexto] = useState(inicial ?? "");
  const [msg, setMsg] = useState("");
  const [enviando, setEnviando] = useState(false);
  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true); setMsg("");
    try {
      const r = await fetch(`/api/productos/${id}/ubicacion`, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ ubicacion: texto }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(j.error ?? "No se pudo guardar"); setEnviando(false); return; }
      setU(j.ubicacion ?? ""); setTexto(j.ubicacion ?? ""); setEditando(false); setEnviando(false);
    } catch { setMsg("Sin conexión: intenta de nuevo"); setEnviando(false); }
  }
  if (!editando) return (
    <button type="button" onClick={() => setEditando(true)} className="mt-0.5 text-sm text-muted hover:text-ink underline-offset-4 hover:underline text-left">
      {u ? <>Ubicación <span className="font-semibold text-ink">{u}</span></> : "Poner ubicación"}
    </button>
  );
  return (
    <form onSubmit={guardar} className="mt-1 flex flex-wrap items-center gap-2" aria-label="Cambiar la ubicación">
      <label htmlFor={`ub-${id}`} className="sr-only">Ubicación del producto</label>
      <input id={`ub-${id}`} autoFocus maxLength={40} autoComplete="off" value={texto} onChange={(e) => setTexto(e.target.value.toUpperCase())}
        onKeyDown={(e) => { if (e.key === "Escape") { setEditando(false); setTexto(u); setMsg(""); } }}
        placeholder="E3-N2" className="h-9 w-32 rounded-lg border border-line bg-surface px-2 num" />
      <button disabled={enviando} className="btn-oscuro h-9 text-sm disabled:opacity-60">{enviando ? "…" : "Guardar"}</button>
      <button type="button" onClick={() => { setEditando(false); setTexto(u); setMsg(""); }} className="text-sm text-muted">Cancelar</button>
      {msg && <span role="alert" className="text-sm text-alerta font-semibold w-full">{msg}</span>}
    </form>
  );
}
