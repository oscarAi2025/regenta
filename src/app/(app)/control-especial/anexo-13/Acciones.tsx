"use client";
import { useState } from "react";

/** Descarga del informe en Excel. Si la revisión encontró algo que detiene, pide confirmarlo antes. */
export function Descargar({ filtro, detiene }: { filtro: string; detiene: boolean }) {
  const [ok, setOk] = useState(false);
  const href = `/api/control-especial/anexo13?${filtro}&formato=excel${detiene ? "&confirmar=1" : ""}`;
  if (!detiene) return <a href={href} className="btn-borde" download>Descargar en Excel</a>;
  return (
    <span className="flex flex-wrap items-center gap-2">
      <label className="flex items-center gap-2 text-sm text-muted cursor-pointer">
        <input type="checkbox" className="size-4 accent-[var(--cruz)]" checked={ok} onChange={(e) => setOk(e.target.checked)} />
        Revisé los avisos
      </label>
      {ok ? <a href={href} className="btn-borde" download>Descargar en Excel</a>
        : <button type="button" className="btn-borde opacity-60 cursor-not-allowed" aria-disabled="true" title="Revisa los avisos de abajo y confírmalo">Descargar en Excel</button>}
    </span>
  );
}

const CANALES: [string, string][] = [["correo", "Correo electrónico"], ["plataforma", "Plataforma web del fondo"], ["presencial", "Radicado en físico"], ["otro", "Otro"]];

/** Registra que el informe del mes se presentó al Fondo Rotatorio (fecha, canal y radicado). */
export function Presentar({ mes, sede, canal, hoy, demo, yaPresentado }: { mes: string; sede: string | null; canal: string; hoy: string; demo: boolean; yaPresentado: boolean }) {
  const [d, setD] = useState({ presentado: hoy, canal: canal || "correo", radicado: "", observacion: "" });
  const [estado, setEstado] = useState<{ ok?: string; error?: string }>({});
  const [enviando, setEnviando] = useState(false);
  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true); setEstado({});
    const r = await fetch("/api/control-especial/anexo13", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mes, sede, ...d }) }).catch(() => null);
    setEnviando(false);
    if (!r) return setEstado({ error: "Sin conexión: revisa internet e intenta de nuevo." });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) return setEstado({ error: j.error ?? "No se pudo registrar" });
    setEstado({ ok: "Registrado." });
    window.location.reload();
  }
  return (
    <form onSubmit={enviar} className="grid gap-3" aria-label="Registrar el envío del informe">
      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <label className="grid text-sm text-muted">Fecha de envío
          <input type="date" required min={`${mes}-01`} max={hoy} value={d.presentado} onChange={(e) => setD({ ...d, presentado: e.target.value })} className="campo" />
        </label>
        <label className="grid text-sm text-muted">Cómo lo enviaste
          <select value={d.canal} onChange={(e) => setD({ ...d, canal: e.target.value })} className="campo">{CANALES.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select>
        </label>
        <label className="grid text-sm text-muted">Radicado o asunto (opcional)
          <input maxLength={80} value={d.radicado} onChange={(e) => setD({ ...d, radicado: e.target.value })} className="campo" />
        </label>
        <label className="grid text-sm text-muted">Observación (opcional)
          <input maxLength={500} value={d.observacion} onChange={(e) => setD({ ...d, observacion: e.target.value })} className="campo" />
        </label>
      </div>
      <div className="flex flex-wrap items-center gap-3">
        <button disabled={enviando || demo} className="btn-oscuro">{enviando ? "Registrando…" : yaPresentado ? "Registrar corrección" : "Marcar como presentado"}</button>
        {demo && <p className="text-sm text-muted">En la demostración se ve pero no se guarda.</p>}
        {estado.ok && <p role="status" className="text-sm font-semibold text-cruz">{estado.ok}</p>}
        {estado.error && <p role="alert" className="text-sm text-alerta">{estado.error}</p>}
      </div>
    </form>
  );
}
