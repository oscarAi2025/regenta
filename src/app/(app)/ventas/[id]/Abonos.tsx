"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { pesos } from "@/lib/formato";

type Abono = { id: string; fecha: string; medio: string; valor: number; referencia: string | null; anulado: boolean; anulado_motivo: string | null };

/** Abonos de una venta a crédito; la gerencia puede anular uno con motivo. */
export function Abonos({ abonos, puedeAnular }: { abonos: Abono[]; puedeAnular: boolean }) {
  const [abierto, setAbierto] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState("");
  const router = useRouter();
  async function anular(id: string) {
    setError("");
    try {
      const r = await fetch(`/api/cartera/${id}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ motivo }) });
      const j = await r.json();
      if (!r.ok) { setError(j.error ?? "No se pudo anular"); return; }
      setAbierto(null); setMotivo(""); router.refresh();
    } catch { setError("Sin conexión con el servidor"); }
  }
  return (
    <div className="tarjeta p-5">
      <h2 className="titulo text-xl">Abonos</h2>
      {abonos.length === 0 ? <p className="mt-2 text-muted">Aún no hay abonos a esta factura.</p> : (
        <ul className="mt-3 divide-y divide-line">
          {abonos.map((a) => (
            <li key={a.id} className="py-2.5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className={a.anulado ? "line-through text-muted" : ""}>{a.fecha} · {a.medio}{a.referencia ? ` · ${a.referencia}` : ""}</span>
                <span className={`num font-semibold ${a.anulado ? "line-through text-muted" : ""}`}>{pesos(a.valor)}</span>
              </div>
              {a.anulado && <p className="text-sm text-muted">Anulado: {a.anulado_motivo}</p>}
              {!a.anulado && puedeAnular && (abierto === a.id ? (
                <div className="mt-2 flex flex-wrap gap-2">
                  <input aria-label="Motivo de la anulación" className="campo flex-1 min-w-48" placeholder="Motivo (p. ej. se registró dos veces)" value={motivo} onChange={(e) => setMotivo(e.target.value)} />
                  <button onClick={() => anular(a.id)} className="btn-peligro h-11">Anular abono</button>
                  <button onClick={() => setAbierto(null)} className="h-11 px-3 text-muted">Cancelar</button>
                </div>
              ) : <button onClick={() => { setAbierto(a.id); setError(""); }} className="mt-1 text-sm text-alerta underline">Anular este abono</button>)}
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert" className="mt-2 text-sm text-alerta">{error}</p>}
    </div>
  );
}
