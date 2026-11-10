"use client";
import { useState } from "react";
import { pesos } from "@/lib/formato";
import type { Producto } from "./tipos";

// Piezas de la lista de productos de la caja (resultados de búsqueda y «Ofrécelos primero»). También las usa el editor
// de pedidos del vendedor.

function diasA(f: string | null) {
  if (!f) return null;
  return Math.round((Date.parse(f + "T00:00:00") - Date.now()) / 864e5);
}

export function Vence({ fecha }: { fecha: string | null }) {
  const d = diasA(fecha);
  if (d === null || d > 90) return null;
  const malo = d <= 30;
  return (
    <span className={`text-[12px] font-semibold px-1.5 py-0.5 rounded ${malo ? "bg-alerta-soft text-alerta" : "bg-aviso-soft text-aviso"}`}>
      {d < 0 ? "Vencido" : d === 0 ? "Vence hoy" : `Vence en ${d} d`}
    </span>
  );
}

/** Marca de dispensación del producto (en resultados y en la tirilla). */
export function MarcaFormula({ p }: { p: Producto }) {
  if (p.control_especial) return <span className="text-[12px] font-semibold px-1.5 py-0.5 rounded bg-alerta-soft text-alerta">Control especial</span>;
  if (p.requiere_formula) return <span className="text-[12px] font-semibold px-1.5 py-0.5 rounded bg-aviso-soft text-aviso">Con fórmula</span>;
  return null;
}

export function existencias(p: Producto) {
  if (p.unidades <= 0) return "Agotado";
  if (p.unidades_por_caja <= 1) return `${p.unidades} und`;
  const c = Math.floor(p.unidades / p.unidades_por_caja), u = p.unidades % p.unidades_por_caja;
  return `${c} caja${c === 1 ? "" : "s"}${u ? ` + ${u} und` : ""}`;
}

export function Fila({ p, activo, onHover, agregar, iva = true }: { p: Producto; activo: boolean; onHover: () => void; agregar: (p: Producto, pr: "caja" | "unidad") => void;
  /** false en una droguería no responsable de IVA: no se le muestra un IVA que no cobra. */ iva?: boolean }) {
  const agotado = p.unidades <= 0;
  return (
    <li role="option" aria-selected={activo} onMouseEnter={onHover}
      className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 ${agotado ? "opacity-55" : ""}`}
      style={activo ? { background: "color-mix(in srgb, var(--cruz-soft) 70%, white)" } : undefined}>
      <div className="min-w-0 flex-1 basis-64">
        <p className="font-semibold leading-snug">{p.nombre}</p>
        <p className="text-sm text-muted flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>{p.laboratorio ?? "Sin laboratorio"}</span>
          <span aria-hidden>·</span>
          <span className={agotado ? "text-alerta font-semibold" : p.unidades <= p.stock_minimo * Math.max(1, p.unidades_por_caja) ? "text-aviso font-semibold" : ""}>{existencias(p)}</span>
          <Vence fecha={p.proximo_vence} />
          <MarcaFormula p={p} />
          {iva && p.iva > 0 && <span className="text-[12px]">IVA {p.iva} %</span>}
        </p>
      </div>
      {agotado && <Alternativas id={p.id} agregar={agregar} />}
      <div className="flex gap-2">
        <button onClick={() => agregar(p, "caja")} disabled={agotado}
          className="num rounded-xl border-2 border-ink px-3 py-2 text-left leading-tight hover:bg-ink hover:text-white disabled:pointer-events-none disabled:opacity-40 disabled:border-line">
          <span className="block text-[11px] font-semibold uppercase tracking-wide opacity-70">{agotado ? "Agotado" : p.unidades_por_caja > 1 ? `Caja x${p.unidades_por_caja}` : "Und"}</span>
          <span className="block font-cond text-lg" style={{ fontWeight: 700 }}>{pesos(p.precio_caja)}</span>
        </button>
        {p.precio_unidad !== null && p.unidades_por_caja > 1 && (
          <button onClick={() => agregar(p, "unidad")} disabled={agotado}
            className="num rounded-xl border-2 border-line px-3 py-2 text-left leading-tight hover:border-ink disabled:pointer-events-none">
            <span className="block text-[11px] font-semibold uppercase tracking-wide opacity-70">Unidad</span>
            <span className="block font-cond text-lg" style={{ fontWeight: 700 }}>{pesos(p.precio_unidad)}</span>
          </button>
        )}
      </div>
    </li>
  );
}

/** Producto agotado: parecidos con existencias (mismo principio activo y concentración) para no perder la venta. */
function Alternativas({ id, agregar }: { id: string; agregar: (p: Producto, pr: "caja" | "unidad") => void }) {
  const [lista, setLista] = useState<Producto[] | null>(null);
  const [cargando, setCargando] = useState(false);
  async function ver() {
    setCargando(true);
    try { const r = await fetch(`/api/productos/alternativas?id=${id}`); const j = await r.json(); setLista(j.productos ?? []); }
    catch { setLista([]); } finally { setCargando(false); }
  }
  if (!lista) return (
    <button onClick={ver} disabled={cargando} className="basis-full sm:basis-auto order-last sm:order-none text-sm font-semibold text-teal-700 underline underline-offset-2 text-left">
      {cargando ? "Buscando…" : "Ver alternativas con existencias"}
    </button>
  );
  return (
    <div className="basis-full order-last rounded-xl bg-teal-50 border border-teal-200 p-3">
      {lista.length === 0 ? <p className="text-sm text-muted">No hay productos parecidos con existencias.</p> : (
        <>
          <p className="text-sm font-semibold text-teal-900">Parecidos que sí tienes. Confirma principio activo y concentración antes de ofrecerlos.</p>
          <ul className="mt-2 grid gap-1.5">
            {lista.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0"><span className="font-semibold">{a.nombre}</span> <span className="text-muted">· {a.laboratorio ?? "Sin laboratorio"} · {existencias(a)}</span></span>
                <button onClick={() => agregar(a, "caja")} className="shrink-0 rounded-lg border-2 border-ink px-2.5 py-1 font-semibold num hover:bg-ink hover:text-white">+ {pesos(a.precio_caja)}</button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
