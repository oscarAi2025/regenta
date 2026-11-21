"use client";
import { useMemo, useState } from "react";
import { libroXlsx } from "@/lib/xlsx";

export type LineaPedido = { id: string; nombre: string; laboratorio: string | null; upc: number; existencias: number; venta_dia: number; dias_cobertura: number | null; tendencia: number | null; sugerido_cajas: number };

const semana = (v: number) => (v * 7 >= 10 ? `${Math.round(v * 7)}` : (v * 7).toLocaleString("es-CO", { maximumFractionDigits: 1 }));

/** Pedido sugerido editable: se ajustan las cajas y se copia, se envía por WhatsApp o se descarga. */
export function Pedido({ lineas, farmagenericos = false }: { lineas: LineaPedido[]; farmagenericos?: boolean }) {
  const [cajas, setCajas] = useState<Record<string, number>>(() => Object.fromEntries(lineas.map((l) => [l.id, l.sugerido_cajas])));
  const [copiado, setCopiado] = useState(false);
  const [fg, setFg] = useState<{ enviando: boolean; ok?: string; error?: string; enlace?: string }>({ enviando: false });
  const elegidas = useMemo(() => lineas.filter((l) => (cajas[l.id] ?? 0) > 0), [lineas, cajas]);
  const texto = () => ["Pedido", ...elegidas.map((l) => `${cajas[l.id]} × ${l.nombre}${l.laboratorio ? ` (${l.laboratorio})` : ""}`)].join("\n");

  async function copiar() { await navigator.clipboard.writeText(texto()).catch(() => {}); setCopiado(true); setTimeout(() => setCopiado(false), 2000); }
  function excel() {
    const libro = libroXlsx([{ nombre: "Pedido", columnas: [{ titulo: "Producto", ancho: 48, tipo: "texto" }, { titulo: "Laboratorio", ancho: 24, tipo: "texto" }, { titulo: "Cajas", ancho: 8, tipo: "entero" }],
      filas: elegidas.map((l) => [l.nombre, l.laboratorio ?? "", cajas[l.id]]) }]);
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([libro as BlobPart], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }));
    a.download = `pedido-${new Date().toISOString().slice(0, 10)}.xlsx`; a.click();
  }

  /** Guarda el pedido y abre el WhatsApp de Farmagenéricos con el pedido escrito. La pestaña se abre antes de esperar al
   *  servidor: abierta después, el navegador la bloquea como ventana emergente. */
  async function pedirFarmagenericos() {
    const w = window.open("about:blank", "_blank");
    setFg({ enviando: true });
    const r = await fetch("/api/pedidos-farmagenericos", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ lineas: elegidas.map((l) => ({ producto_id: l.id, cajas: cajas[l.id] })) }) }).then(async (x) => ({ ok: x.ok, j: await x.json().catch(() => ({})) })).catch(() => ({ ok: false, j: {} as Record<string, string> }));
    if (!r.ok) { w?.close(); setFg({ enviando: false, error: r.j.error ?? "No se pudo enviar el pedido. Revisa tu conexión." }); return; }
    if (w) w.location.href = r.j.whatsapp;
    setFg({ enviando: false, ok: `Pedido guardado: ${r.j.productos} productos, ${r.j.cajas} cajas. Envíalo en el WhatsApp de Farmagenéricos.`, enlace: r.j.whatsapp });
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
                <td className="px-4 py-3"><p className="font-semibold">{l.nombre}</p><p className="text-muted">{l.laboratorio ?? "Sin laboratorio"}{l.upc > 1 ? ` · caja x ${l.upc}` : ""}</p></td>
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
        <button onClick={excel} className="btn-borde h-10">Descargar en Excel</button>
        <a href={`https://wa.me/?text=${encodeURIComponent(texto())}`} target="_blank" rel="noopener" className={`${farmagenericos ? "btn-borde" : "btn-primario"} h-10`}>{farmagenericos ? "Enviar a otro proveedor" : "Enviar por WhatsApp"}</a>
        {farmagenericos && <button onClick={pedirFarmagenericos} disabled={fg.enviando || !elegidas.length} className="btn-primario h-10">{fg.enviando ? "Enviando…" : "Pedir a Farmagenéricos"}</button>}
        {fg.ok && <p role="status" className="basis-full text-sm font-semibold text-cruz">{fg.ok} {fg.enlace && <a href={fg.enlace} target="_blank" rel="noopener" className="underline">Abrir WhatsApp</a>}</p>}
        {fg.error && <p role="alert" className="basis-full text-sm font-semibold text-alerta">{fg.error}</p>}
      </div>
    </section>
  );
}
