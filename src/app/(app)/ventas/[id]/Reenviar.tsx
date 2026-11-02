"use client";
import { useState } from "react";

/** Reenvía a la DIAN un documento rechazado, después de corregir lo que indicó el rechazo. */
export function Reenviar({ id }: { id: string }) {
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  async function reenviar() {
    setEnviando(true); setError("");
    const r = await fetch(`/api/ventas/${id}/reenviar`, { method: "POST" }).catch(() => null);
    if (!r) { setError("Sin conexión: revisa internet e intenta de nuevo."); setEnviando(false); return; }
    if (r.ok) { location.reload(); return; }
    setError((await r.json().catch(() => ({}))).error ?? "No se pudo reenviar"); setEnviando(false);
  }
  return (
    <div className="mt-3">
      <p className="text-sm text-muted">Corrige lo que indica el rechazo (datos del cliente o de la droguería) y reenvía.</p>
      <button onClick={reenviar} disabled={enviando} className="btn-primario mt-2">{enviando ? "Reenviando…" : "Reenviar a la DIAN"}</button>
      {error && <p role="alert" className="mt-2 text-sm text-alerta">{error}</p>}
    </div>
  );
}
