"use client";
import { useState } from "react";

/** Bloquear el fiado por mora: con una factura de más de N días de mora, la cajera no le fía al cliente y la gerencia
 *  solo con un motivo. Vacío = la mora no bloquea. */
export function MoraBloqueo({ inicial }: { inicial: number | null }) {
  const [dias, setDias] = useState(inicial === null ? "" : String(inicial));
  const [actual, setActual] = useState(inicial);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [enviando, setEnviando] = useState(false);
  return (
    <form className="tarjeta p-4 grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end" aria-label="Bloqueo por mora" onSubmit={async (e) => {
      e.preventDefault(); if (enviando) return; setEnviando(true); setMsg(null);
      try {
        const r = await fetch("/api/cartera", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ dias_mora_bloqueo: dias.trim() === "" ? null : Number(dias) }) });
        const j = await r.json();
        if (!r.ok) { setMsg({ ok: false, t: j.error ?? "No se pudo guardar" }); return; }
        setActual(j.dias_mora_bloqueo); setMsg({ ok: true, t: j.mensaje });
      } catch { setMsg({ ok: false, t: "Sin conexión con el servidor" }); } finally { setEnviando(false); }
    }}>
      <div>
        <label htmlFor="mora-dias" className="etiqueta">No fiar a quien tenga una factura con más de… días de mora</label>
        <div className="flex gap-2 items-center">
          <input id="mora-dias" inputMode="numeric" className="campo num max-w-[120px]" placeholder="Sin límite" value={dias} onChange={(e) => setDias(e.target.value.replace(/\D/g, "").slice(0, 3))} />
          <span className="text-sm text-muted">{actual === null ? "Hoy la mora no bloquea el fiado." : `Hoy: más de ${actual} días bloquea.`}</span>
        </div>
      </div>
      <button className="btn-oscuro h-11" disabled={enviando}>{enviando ? "Guardando…" : "Guardar"}</button>
      {msg && <p role={msg.ok ? "status" : "alert"} className={`text-sm font-semibold sm:col-span-2 ${msg.ok ? "text-cruz" : "text-alerta"}`}>{msg.t}</p>}
    </form>
  );
}
