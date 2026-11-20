"use client";
import { useState } from "react";
import { useRefrescar } from "@/lib/refrescar";

// Explicar una diferencia del conteo desde el informe: causa, qué pasó y el documento que lo soporta. Lo ya explicado
// se ve en el informe impreso; el formulario no se imprime.

export function Justificar({ conteoId, lineaId, causas, hay }: { conteoId: string; lineaId: number; causas: Record<string, string>; hay: boolean }) {
  const refrescar = useRefrescar();
  const [abierto, setAbierto] = useState(false);
  const [causa, setCausa] = useState("");
  const [detalle, setDetalle] = useState("");
  const [documento, setDocumento] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [enviando, setEnviando] = useState(false);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (!causa) { setMsg({ ok: false, t: "Elige la causa" }); return; }
    setEnviando(true); setMsg(null);
    try {
      const r = await fetch(`/api/inventario/conteos/${conteoId}/justificar`, { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ linea_id: lineaId, causa, detalle, documento: documento || null }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setMsg({ ok: false, t: j.error ?? "No se pudo guardar" });
      else { setMsg({ ok: true, t: j.mensaje ?? "Guardado" }); setAbierto(false); setCausa(""); setDetalle(""); setDocumento(""); void refrescar(); }
    } catch { setMsg({ ok: false, t: "Sin conexión: revisa internet y vuelve a intentar." }); }
    setEnviando(false);
  }

  return (
    <div className="no-imprimir mt-1">
      {!abierto && <button type="button" onClick={() => setAbierto(true)} className="text-sm font-semibold text-cruz underline underline-offset-2">{hay ? "Cambiar la explicación" : "Explicar esta diferencia"}</button>}
      {msg && <p role={msg.ok ? "status" : "alert"} className={`text-sm font-semibold ${msg.ok ? "text-cruz" : "text-alerta"}`}>{msg.t}</p>}
      {abierto && (
        <form onSubmit={guardar} className="mt-1 grid gap-2 rounded-xl border border-line bg-paper/60 p-3 max-w-[520px]">
          <label className="text-sm font-semibold">Causa
            <select value={causa} onChange={(e) => setCausa(e.target.value)} className="campo h-10 font-normal" aria-label="Causa de la diferencia">
              <option value="">Elige la causa…</option>
              {Object.entries(causas).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
            </select></label>
          <label className="text-sm font-semibold">Qué pasó
            <textarea value={detalle} onChange={(e) => setDetalle(e.target.value)} maxLength={400} rows={2} className="campo font-normal" aria-label="Qué pasó" placeholder="Ej.: salió en el pedido de Droguería X y no se facturó" /></label>
          <label className="text-sm font-semibold">Documento que lo soporta (opcional)
            <input value={documento} onChange={(e) => setDocumento(e.target.value)} maxLength={80} className="campo h-10 font-normal" aria-label="Documento" placeholder="Factura, remisión, nota crédito o acta" /></label>
          <div className="flex gap-2">
            <button disabled={enviando} className="btn-oscuro h-10 text-sm">{enviando ? "Guardando…" : "Guardar explicación"}</button>
            <button type="button" onClick={() => { setAbierto(false); setMsg(null); }} className="btn-borde h-10 text-sm">Cancelar</button>
          </div>
        </form>
      )}
    </div>
  );
}
