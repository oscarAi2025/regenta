"use client";
import { useMemo, useState } from "react";

export type LineaPedido = { id: string; nombre: string; laboratorio: string | null; upc: number; existencias: number; venta_dia: number; dias_cobertura: number | null; tendencia: number | null; sugerido_cajas: number };

const semana = (v: number) => (v * 7 >= 10 ? `${Math.round(v * 7)}` : (v * 7).toLocaleString("es-CO", { maximumFractionDigits: 1 }));

/** Pedido sugerido editable: se ajustan las cajas y se copia, se envía por WhatsApp o se descarga. */
export function Pedido({ lineas }: { lineas: LineaPedido[] }) {
  const [cajas, setCajas] = useState<Record<string, number>>(() => Object.fromEntries(lineas.map((l) => [l.id, l.sugerido_cajas])));
  const [copiado, setCopiado] = useState(false);
  const elegidas = useMemo(() => lineas.filter((l) => (cajas[l.id] ?? 0) > 0), [lineas, cajas]);
  const texto = () => ["Pedido", ...elegidas.map((l) => `${cajas[l.id]} × ${l.nombre}${l.laboratorio ? ` (${l.laboratorio})` : ""}`)].join("\n");

  async function copiar() { await navigator.clipboard.writeText(texto()).catch(() => {}); setCopiado(true); setTimeout(() => setCopiado(false), 2000); }
  function csv() {
    const filas = [["producto", "laboratorio", "cajas"], ...elegidas.map((l) => [l.nombre, l.laboratorio ?? "", String(cajas[l.id])])];
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + filas.map((f) => f.map((x) => `"${x.replace(/"/g, '""')}"`).join(";")).join("\r\n")], { type: "text/csv;charset=utf-8" }));
    a.download = `pedido-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
  }

  if (!lineas.length) return <p className="tarjeta p-8 text-center text-muted">Con lo que tienes alcanzas para más de 18 días en todo lo que se vende. No hay que pedir nada todavía.</p>;
  return (
    <section className="grid gap-3">
      <p className="text-muted max-w-3xl">Lo que vendes y no te alcanza para los próximos 18 días (3 de entrega del proveedor + 15 de cobertura), en cajas completas. Ajusta las cantidades y envíalo a tu proveedor.</p>
      <div className="tarjeta overflow-x-auto">
        <table className="w-full text-sm min-w-[760px]">
          <thead className="text-left text-muted border-b border-line"><tr><th className="px-4 py-3">Producto</th><th className="px-4 py-3 text-right">Hay</th><th className="px-4 py-3 text-right">Vende por semana</th><th className="px-4 py-3 text-right">Alcanza para</th><th className="px-4 py-3 text-right">Pedir (cajas)</th></tr></thead>
          <tbody className="divide-y divide-line">
            {lineas.map((l) => (
              <tr key={l.id}>
                <td className="px-4 py-3"><p className="font-semibold">{l.nombre}</p><p className="text-muted">{l.laboratorio ?? "Genérico"}{l.upc > 1 ? ` · caja x ${l.upc}` : ""}</p></td>
                <td className="px-4 py-3 text-right num">{l.existencias} und</td>
                <td className="px-4 py-3 text-right num">{semana(l.venta_dia)} und{l.tendencia !== null && l.tendencia >= 1.25 ? <span className="text-cruz font-semibold" title="Se está vendiendo más que antes"> ↑</span> : l.tendencia !== null && l.tendencia <= 0.8 ? <span className="text-aviso font-semibold" title="Se está vendiendo menos que antes"> ↓</span> : null}</td>
                <td className={`px-4 py-3 text-right num font-semibold ${(l.dias_cobertura ?? 0) < 7 ? "text-alerta" : ""}`}>{l.existencias <= 0 ? "Agotado" : `${Math.floor(l.dias_cobertura ?? 0)} días`}</td>
                <td className="px-4 py-3 text-right"><label className="sr-only" htmlFor={`c-${l.id}`}>Cajas de {l.nombre}</label>
                  <input id={`c-${l.id}`} type="number" min={0} value={cajas[l.id] ?? 0} onChange={(e) => setCajas((c) => ({ ...c, [l.id]: Math.max(0, Number(e.target.value) || 0) }))} className="campo num w-20 h-9 text-right" /></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <div className="tarjeta p-4 flex flex-wrap items-center gap-2 sticky bottom-3">
        <p className="flex-1 font-semibold">{elegidas.length} productos · {elegidas.reduce((a, l) => a + cajas[l.id], 0)} cajas</p>
        <button onClick={copiar} className="btn-borde h-10">{copiado ? "Copiado" : "Copiar pedido"}</button>
        <button onClick={csv} className="btn-borde h-10">Descargar Excel</button>
        <a href={`https://wa.me/?text=${encodeURIComponent(texto())}`} target="_blank" rel="noopener" className="btn-primario h-10">Enviar por WhatsApp</a>
      </div>
    </section>
  );
}
