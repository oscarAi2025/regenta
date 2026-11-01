"use client";
import { useState } from "react";

const OPCIONES = { lote: [["separado", "Separé el producto"], ["sin_lote", "Ya no lo tengo"]], registro: [["sin_lote", "No tengo ese lote"], ["separado", "Separé el producto"]], nombre: [["no_aplica", "No es el mismo producto"], ["sin_lote", "No tengo ese lote"], ["separado", "Separé el producto"]] } as const;

export function Revisar({ alerta, producto, nivel }: { alerta: number; producto: string; nivel: keyof typeof OPCIONES }) {
  const [estado, setEstado] = useState<"" | "enviando" | "ok">("");
  const [error, setError] = useState("");
  async function marcar(resultado: string) {
    setEstado("enviando"); setError("");
    const r = await fetch("/api/alertas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ alerta_id: alerta, producto_id: producto, resultado }) });
    if (r.ok) { setEstado("ok"); location.reload(); return; }
    setError((await r.json().catch(() => ({}))).error ?? "No se pudo guardar"); setEstado("");
  }
  return (
    <div className="flex flex-wrap items-center gap-2">
      {OPCIONES[nivel].map(([k, t]) => <button key={k} disabled={estado !== ""} onClick={() => marcar(k)} className={`${k === "separado" ? "btn-primario" : "btn-borde"} h-9 px-3 text-sm`}>{t}</button>)}
      {error && <span role="alert" className="text-sm text-alerta">{error}</span>}
    </div>
  );
}
