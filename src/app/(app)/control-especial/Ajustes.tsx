"use client";
import { useState } from "react";

/** Configuración de la droguería para la venta con fórmula (vigencia de la fórmula de control especial y si los
 *  productos «con fórmula» también piden registrar los datos). */
export function Ajustes({ vigencia, exige }: { vigencia: number; exige: boolean }) {
  const [dias, setDias] = useState(String(vigencia));
  const [datos, setDatos] = useState(exige);
  const [estado, setEstado] = useState<{ ok?: string; error?: string }>({});
  const [enviando, setEnviando] = useState(false);
  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true); setEstado({});
    const r = await fetch("/api/control-especial", { method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ vigencia_dias: Number(dias), exige_datos: datos }) }).catch(() => null);
    setEnviando(false);
    if (!r) return setEstado({ error: "Sin conexión: revisa internet e intenta de nuevo." });
    const j = await r.json().catch(() => ({}));
    setEstado(r.ok ? { ok: "Guardado. Las cajas abiertas lo aplican al recargar la página." } : { error: j.error ?? "No se pudo guardar" });
  }
  return (
    <form onSubmit={guardar} className="tarjeta p-5 grid gap-4" aria-labelledby="ajustes-titulo">
      <div>
        <h2 id="ajustes-titulo" className="titulo text-xl">Ajustes de la venta con fórmula</h2>
        <p className="text-sm text-muted mt-0.5">Lo que la caja exige al vender estos productos en tu droguería.</p>
      </div>
      <div className="grid sm:grid-cols-[minmax(0,19rem)_1fr] gap-4 items-start">
        <div>
          <label htmlFor="vigencia" className="etiqueta">Vigencia de la fórmula de control especial</label>
          <div className="flex items-center gap-2">
            <input id="vigencia" type="number" min={1} max={365} required inputMode="numeric" className="campo num w-24" value={dias} onChange={(e) => setDias(e.target.value)} />
            <span className="text-muted">días</span>
          </div>
          <p className="text-[13px] text-muted mt-1">Plazo configurado por tu droguería. La caja no acepta fórmulas más antiguas.</p>
        </div>
        <label className="flex items-start gap-3 cursor-pointer sm:mt-7">
          <input type="checkbox" className="mt-1 size-5 shrink-0 accent-[var(--cruz)]" checked={datos} onChange={(e) => setDatos(e.target.checked)} />
          <span><span className="font-semibold">Registrar los datos también en «venta con fórmula»</span>
            <span className="block text-sm text-muted">Si lo activas, la caja pide paciente, médico y fórmula también para los productos que solo requieren fórmula (sin internet no se venden). Si no, basta con confirmar que se verificó.</span></span>
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={enviando} className="btn-oscuro">{enviando ? "Guardando…" : "Guardar ajustes"}</button>
        {estado.ok && <p role="status" className="text-sm font-semibold text-cruz">{estado.ok}</p>}
        {estado.error && <p role="alert" className="text-sm text-alerta">{estado.error}</p>}
      </div>
    </form>
  );
}
