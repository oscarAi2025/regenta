"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

type Lote = { lote_id: string; nombre: string; lote: string; unidades: number; unidades_por_caja: number; motivo: string | null };
const n = (s: string) => Number(String(s).replace(/\D/g, "")) || 0;

/** Lotes que entraron sin costo: sin él no hay margen ni valor de inventario. Se pone por unidad o por caja. */
export function CostosPendientes({ lotes, compras = [] }: { lotes: Lote[]; compras?: { id: string; numero: number; numero_factura: string; proveedor: string }[] }) {
  const [abierto, setAbierto] = useState(false), [v, setV] = useState<Record<string, string>>({}), [porCaja, setPorCaja] = useState<Record<string, boolean>>({});
  const [msg, setMsg] = useState<Record<string, string>>({});
  const router = useRouter();
  async function guardar(l: Lote) {
    const valor = n(v[l.lote_id] ?? ""), unidad = porCaja[l.lote_id] && l.unidades_por_caja > 1 ? valor / l.unidades_por_caja : valor;
    if (!valor) { setMsg({ ...msg, [l.lote_id]: "Escribe el costo" }); return; }
    const r = await fetch("/api/inventario/costos", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ lote_id: l.lote_id, costo_unidad: Math.round(unidad * 10000) / 10000 }) }).catch(() => null);
    const j = await r?.json().catch(() => ({}));
    setMsg({ ...msg, [l.lote_id]: r?.ok ? "Guardado" : j?.error ?? "Sin conexión" });
    if (r?.ok) router.refresh();
  }
  return (
    <section className="mt-4 tarjeta p-4 sm:p-5 border-aviso" aria-labelledby="sin-costo-t">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div><h2 id="sin-costo-t" className="titulo text-xl">Costos por completar</h2><p className="text-sm text-muted">{[compras.length ? `${compras.length} compra${compras.length === 1 ? "" : "s"} recibida${compras.length === 1 ? "" : "s"} sin costos` : "", lotes.length ? `${lotes.length} lote(s) sin costo` : ""].filter(Boolean).join(" y ")}: sin el costo no ves el margen ni el valor del inventario.</p></div>
        {lotes.length > 0 && <button onClick={() => setAbierto(!abierto)} className="btn-borde">{abierto ? "Ocultar" : "Completar costos de lotes"}</button>}
      </div>
      {compras.length > 0 && <ul className="mt-3 flex flex-wrap gap-2" aria-label="Compras por costear">{compras.map((k) => (
        <li key={k.id}><a href={`/compras/${k.id}`} className="btn-borde h-9 px-3 text-sm">Costear compra N.º {k.numero} · {k.proveedor} · {k.numero_factura}</a></li>
      ))}</ul>}
      {abierto && <ul className="mt-3 divide-y divide-line">{lotes.map((l) => (
        <li key={l.lote_id} className="py-3 flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-1"><p className="font-semibold">{l.nombre}</p><p className="text-sm text-muted">Lote {l.lote} · {l.unidades.toLocaleString("es-CO")} und{l.motivo ? ` · ${l.motivo}` : ""}</p></div>
          <label className="text-sm font-semibold">Costo sin IVA<input inputMode="numeric" aria-label={`Costo de ${l.nombre} lote ${l.lote}`} value={v[l.lote_id] ? n(v[l.lote_id]).toLocaleString("es-CO") : ""} onChange={(e) => setV({ ...v, [l.lote_id]: e.target.value })} className="campo h-10 w-32 num font-normal" placeholder="$" /></label>
          {l.unidades_por_caja > 1 && <label className="text-sm flex items-center gap-1.5 h-10"><input type="checkbox" checked={!!porCaja[l.lote_id]} onChange={(e) => setPorCaja({ ...porCaja, [l.lote_id]: e.target.checked })} />por caja de {l.unidades_por_caja}</label>}
          <button onClick={() => guardar(l)} className="btn-oscuro h-10 text-sm">Guardar</button>
          {msg[l.lote_id] && <span role="status" className="text-sm text-muted">{msg[l.lote_id]}</span>}
        </li>
      ))}</ul>}
    </section>
  );
}
