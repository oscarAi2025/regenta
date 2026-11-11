"use client";
import { useState } from "react";
import { useRefrescar } from "@/lib/refrescar";
import { pesosExactos } from "@/lib/compras";
import type { CostoPorRevisar } from "@/lib/reportes";

const leer = (s: string) => Number(String(s).replace(/\./g, "").replace(",", ".").replace(/[^\d.]/g, "")) || 0;
const redondo = (n: number) => Math.round(n * 10000) / 10000;

/** Aviso de los lotes vendidos con un costo por unidad que no cuadra con lo cobrado (casi siempre el costo de la caja
 *  escrito como costo por unidad). No entran en la ganancia hasta corregirlos; se corrigen aquí mismo, con un clic si el
 *  costo era el de la caja. */
export function CostosPorRevisar({ lotes, netas }: { lotes: CostoPorRevisar[]; netas: number }) {
  const refrescar = useRefrescar();
  const [valor, setValor] = useState<Record<string, string>>({});
  const [msg, setMsg] = useState<Record<string, { ok: boolean; t: string }>>({});
  const [enviando, setEnviando] = useState<string | null>(null);

  async function corregir(l: CostoPorRevisar, costo: number, motivo: string) {
    if (!(costo > 0)) { setMsg({ ...msg, [l.lote_id]: { ok: false, t: "Escribe el costo por unidad" } }); return; }
    setEnviando(l.lote_id);
    const r = await fetch("/api/inventario/costos", { method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ lote_id: l.lote_id, costo_unidad: redondo(costo), motivo }) }).catch(() => null);
    const j = await r?.json().catch(() => ({}));
    setEnviando(null);
    setMsg({ ...msg, [l.lote_id]: { ok: !!r?.ok, t: r?.ok ? "Costo corregido" : j?.error ?? "Sin conexión: inténtalo de nuevo" } });
    if (r?.ok) void refrescar();
  }

  return (
    <section className="tarjeta p-5 border-2 border-aviso" aria-labelledby="revisar-t">
      <h2 id="revisar-t" className="titulo text-xl">Costos que no cuadran</h2>
      <p className="mt-1 text-sm text-muted">
        {pesosExactos(netas)} vendidos (sin IVA) tienen un costo por unidad mayor que tres veces lo que se cobró por unidad. No entran en la
        ganancia hasta que lo corrijas: casi siempre es el costo de la caja escrito como costo por unidad.
      </p>
      <ul className="mt-3 divide-y divide-line">
        {lotes.map((l) => {
          const deCaja = l.unidades_por_caja > 1 ? l.costo_unidad / l.unidades_por_caja : null;
          const m = msg[l.lote_id];
          return (
            <li key={l.lote_id} className="py-3 grid gap-2">
              <div>
                <p className="font-semibold">{l.producto}</p>
                <p className="text-sm text-muted num">Lote {l.lote} · costo registrado <b className="text-alerta">{pesosExactos(l.costo_unidad)} por unidad</b> · se cobró {pesosExactos(l.cobrado_unidad)} por unidad sin IVA · {l.unidades.toLocaleString("es-CO")} und vendidas</p>
              </div>
              {l.desde_compra ? (
                <p className="text-sm">Este lote entró con una compra: corrige el costo en <a href="/compras" className="underline font-semibold">Compras</a>.</p>
              ) : m?.ok ? (
                <p role="status" className="text-sm font-semibold text-cruz">{m.t}</p>
              ) : (
                <div className="flex flex-wrap items-end gap-2">
                  {deCaja !== null && (
                    <button disabled={enviando === l.lote_id} onClick={() => corregir(l, deCaja, `Era el costo de la caja x ${l.unidades_por_caja}`)} className="btn-oscuro h-10 text-sm">
                      Era el costo de la caja: dejar {pesosExactos(redondo(deCaja))} por unidad
                    </button>
                  )}
                  <label className="text-sm font-semibold">Otro costo por unidad sin IVA
                    <input inputMode="decimal" aria-label={`Costo por unidad de ${l.producto}, lote ${l.lote}`} className="campo h-10 w-36 num font-normal" placeholder="$"
                      value={valor[l.lote_id] ?? ""} onChange={(e) => setValor({ ...valor, [l.lote_id]: e.target.value })} /></label>
                  <button disabled={enviando === l.lote_id} onClick={() => corregir(l, leer(valor[l.lote_id] ?? ""), "Costo por unidad mal registrado")} className="btn-borde h-10 text-sm">Guardar</button>
                </div>
              )}
              {m && !m.ok && <p role="alert" className="text-sm text-alerta">{m.t}</p>}
            </li>
          );
        })}
      </ul>
    </section>
  );
}
