"use client";
import { useState } from "react";
import { pesos } from "@/lib/formato";
import { leerCantidad } from "@/lib/pedidos";
import { MarcaFormula, existencias } from "./Productos";
import { precioDe, type Linea } from "./tipos";

/** Una línea de la venta: cantidad con − y + o escrita (clic en el número), descuento, aviso de precio cambiado desde el
 *  pedido y de unidades que van en domicilios abiertos. La usan la caja y el editor de pedidos. */
export function LineaVenta({ l, sobra, domicilio, onCambio, onQuitar, onListo }: {
  l: Linea; sobra: boolean; domicilio?: { unidades: number; pedidos: number } | null;
  onCambio: (cambio: Partial<Pick<Linea, "cantidad" | "descuento">>) => void; onQuitar: () => void; onListo?: () => void;
}) {
  const precio = precioDe(l);
  const [editando, setEditando] = useState<string | null>(null);
  const [error, setError] = useState("");
  const terminar = (guardar: boolean) => {
    if (editando === null) return;
    if (guardar) {
      const c = leerCantidad(editando);
      if ("error" in c) { setError(c.error); return false; }
      onCambio({ cantidad: c.n });
    }
    setEditando(null); setError("");
    onListo?.();
    return true;
  };
  return (
    <li className="py-3">
      <div className="flex justify-between gap-3">
        <p className="leading-snug text-[15px]">{l.p.nombre}{(l.p.control_especial || l.p.requiere_formula) && <span className="ml-1.5 inline-block align-middle"><MarcaFormula p={l.p} /></span>}</p>
        <button onClick={onQuitar} aria-label={`Quitar ${l.p.nombre}`} className="text-muted hover:text-alerta shrink-0 -mt-0.5 text-xl leading-none">×</button>
      </div>
      <div className="mt-2 flex items-center justify-between gap-3">
        <div className="flex items-center gap-1 min-w-0">
          <button aria-label="Uno menos" onClick={() => onCambio({ cantidad: Math.max(1, l.cantidad - 1) })} className="size-10 sm:size-8 rounded-lg border border-line text-lg leading-none shrink-0">−</button>
          {editando !== null ? (
            <input aria-label={`Cantidad de ${l.p.nombre}`} autoFocus inputMode="numeric" value={editando} maxLength={6}
              onChange={(e) => { setEditando(e.target.value.replace(/[^\d]/g, "")); setError(""); }}
              onFocus={(e) => e.currentTarget.select()}
              onKeyDown={(e) => {
                if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); terminar(true); }
                if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); terminar(false); }
              }}
              onBlur={() => { if (terminar(true) === false) { setEditando(null); } }}
              aria-invalid={!!error} aria-describedby={error ? `err-${l.key}` : undefined}
              className="num w-14 h-10 sm:h-8 rounded-lg border-2 border-ink px-1 text-center font-semibold outline-none" />
          ) : (
            <button onClick={() => { setEditando(String(l.cantidad)); setError(""); }} aria-label={`Cantidad de ${l.p.nombre}: ${l.cantidad}. Escribir otra`} title="Clic para escribir la cantidad"
              className="num min-w-8 px-1 h-10 sm:h-8 rounded-lg text-center font-semibold hover:bg-paper underline decoration-dotted decoration-muted underline-offset-4">{l.cantidad}</button>
          )}
          <button aria-label="Uno más" onClick={() => onCambio({ cantidad: Math.min(10000, l.cantidad + 1) })} className="size-10 sm:size-8 rounded-lg border border-line text-lg leading-none shrink-0">+</button>
          <span className="ml-2 text-sm text-muted">{l.presentacion === "caja" ? (l.p.unidades_por_caja > 1 ? `caja x${l.p.unidades_por_caja}` : "und") : "unidad"} · {pesos(precio)}</span>
        </div>
        <span className="num font-semibold text-right">
          {l.descuento > 0 && <span className="block text-xs text-muted line-through">{pesos(precio * l.cantidad)}</span>}
          {pesos(l.descuento > 0 ? Math.round(precio * l.cantidad * (100 - l.descuento) / 100) : precio * l.cantidad)}
        </span>
      </div>
      <label className="mt-1 inline-flex items-center gap-1.5 text-sm text-muted">Desc.
        <input aria-label={`Descuento de ${l.p.nombre} en porcentaje`} inputMode="decimal" className="num w-14 h-8 rounded-lg border border-line px-2 text-right"
          value={l.descuento || ""} placeholder="0" onChange={(e) => onCambio({ descuento: Math.min(99, Math.max(0, Number(e.target.value.replace(",", ".").replace(/[^\d.]/g, "")) || 0)) })} />%
      </label>
      {error && <p id={`err-${l.key}`} role="alert" className="mt-1 text-sm text-alerta">{error}</p>}
      {l.antes !== undefined && l.antes !== precio && (
        <p className="mt-1 text-sm font-semibold text-aviso">Cambió el precio: antes {pesos(l.antes)}, ahora {pesos(precio)}</p>
      )}
      {domicilio && domicilio.unidades > 0 && (
        <p className="mt-1 text-sm text-muted">{domicilio.unidades} und en domicilios abiertos{domicilio.pedidos > 1 ? ` (${domicilio.pedidos} pedidos)` : ""} · no se reservan</p>
      )}
      {sobra && <p className="mt-1 text-sm text-alerta">Solo hay {existencias(l.p).toLowerCase()} en existencia</p>}
    </li>
  );
}
