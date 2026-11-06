"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { pesos } from "@/lib/formato";

type Credito = { cupo: number | null; cupo_disponible: number | null; saldo: number; dias_mora: number; motivo: string | null; plazo_dias: number | null; bloqueado: boolean };
const entero = (v: string) => Number(v.replace(/\D/g, "") || 0);

/** Datos de crédito del cliente (dueño o administrador): cupo, plazo por defecto, bloqueo y notas. Tras guardar se muestra
 *  lo que confirma el servidor (cupo disponible incluido), sin esperar a que la página se recargue. */
export function CreditoCliente({ id, inicial, notas: notasIni }: { id: string; inicial: Credito; notas: string | null }) {
  const [cr, setCr] = useState(inicial);
  const [conCupo, setConCupo] = useState(inicial.cupo !== null);
  const [cupo, setCupo] = useState(inicial.cupo !== null ? String(inicial.cupo) : "");
  const [plazo, setPlazo] = useState(inicial.plazo_dias ? String(inicial.plazo_dias) : "");
  const [bloq, setBloq] = useState(inicial.bloqueado);
  const [notas, setNotas] = useState(notasIni ?? "");
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const router = useRouter();

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (enviando) return;
    setEnviando(true); setMsg(null);
    try {
      const r = await fetch(`/api/clientes/${id}/credito`, { method: "PATCH", headers: { "content-type": "application/json" },
        body: JSON.stringify({ cupo_credito: conCupo ? entero(cupo) : null, plazo_dias_defecto: plazo ? Number(plazo) : null, credito_bloqueado: bloq, notas: notas.trim() || null }) });
      const j = await r.json();
      if (!r.ok) { setMsg({ ok: false, t: j.error ?? "No se pudo guardar" }); return; }
      setCr(j.credito); setMsg({ ok: true, t: j.mensaje }); router.refresh();
    } catch { setMsg({ ok: false, t: "Sin conexión con el servidor: vuelve a intentarlo" }); } finally { setEnviando(false); }
  }

  return (
    <section className="tarjeta p-5 grid gap-4 min-w-0" aria-label="Crédito del cliente">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="titulo text-xl">Crédito</h2>
        <p className="text-sm num" role="status">
          {cr.cupo === null ? <span className="text-muted">Sin cupo: la cajera no le fía</span>
            : <>Disponible <b className={cr.cupo_disponible ? "text-cruz" : "text-alerta"}>{pesos(cr.cupo_disponible ?? 0)}</b> de {pesos(cr.cupo)}</>}
        </p>
      </div>
      {cr.motivo && <p className="rounded-xl bg-aviso-soft text-aviso px-3 py-2 text-sm font-semibold">No se le puede fiar: {cr.motivo}</p>}
      <form className="grid gap-3" onSubmit={guardar}>
        <fieldset className="grid gap-2">
          <legend className="etiqueta">Cupo de crédito</legend>
          <div className="grid grid-cols-2 gap-1 rounded-xl bg-paper p-1 max-w-sm" role="group" aria-label="¿Tiene cupo?">
            {([[false, "Sin cupo"], [true, "Con cupo"]] as const).map(([v, t]) => (
              <button type="button" key={t} aria-pressed={conCupo === v} onClick={() => setConCupo(v)}
                className={`h-9 rounded-lg text-sm font-semibold ${conCupo === v ? "bg-ink text-white" : "text-muted"}`}>{t}</button>
            ))}
          </div>
          {conCupo && (
            <div className="max-w-sm">
              <label htmlFor="cr-cupo" className="sr-only">Cupo en pesos</label>
              <input id="cr-cupo" inputMode="numeric" className="campo num" placeholder="$ 0" value={cupo ? pesos(entero(cupo)) : ""} onChange={(e) => setCupo(e.target.value)} />
              <p className="text-xs text-muted mt-1">Lo máximo que puede deber en total. La cajera fía hasta ahí.</p>
            </div>
          )}
        </fieldset>
        <div className="grid sm:grid-cols-2 gap-3 max-w-xl">
          <div>
            <label htmlFor="cr-plazo" className="etiqueta">Plazo de pago por defecto</label>
            <select id="cr-plazo" className="campo" value={plazo} onChange={(e) => setPlazo(e.target.value)}>
              <option value="">Sin plazo fijo</option>
              {[8, 15, 30, 45, 60, 90].map((d) => <option key={d} value={d}>{d} días</option>)}
            </select>
          </div>
          <label className="flex items-start gap-2 text-sm sm:mt-7">
            <input type="checkbox" className="mt-1" checked={bloq} onChange={(e) => setBloq(e.target.checked)} />
            <span><b>Bloquear el crédito</b><span className="block text-muted">Nadie le fía sin autorización con motivo.</span></span>
          </label>
        </div>
        <div>
          <label htmlFor="cr-notas" className="etiqueta">Notas</label>
          <textarea id="cr-notas" className="campo !h-20 py-2" maxLength={500} placeholder="Paga los viernes, autoriza a su hija para recoger…" value={notas} onChange={(e) => setNotas(e.target.value)} />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          <button className="btn-oscuro h-11" disabled={enviando}>{enviando ? "Guardando…" : "Guardar crédito"}</button>
          {msg && <p role={msg.ok ? "status" : "alert"} className={`text-sm font-semibold ${msg.ok ? "text-cruz" : "text-alerta"}`}>{msg.t}</p>}
        </div>
      </form>
    </section>
  );
}
