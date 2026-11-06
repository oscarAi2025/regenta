"use client";
import type { RefObject } from "react";
import { pesos } from "@/lib/formato";
import type { Medio } from "./tipos";

export const MEDIOS: { id: Medio; label: string }[] = [
  { id: "efectivo", label: "Efectivo" }, { id: "nequi", label: "Nequi" }, { id: "daviplata", label: "Daviplata" },
  { id: "bre_b", label: "Bre-B" }, { id: "qr", label: "QR Bancolombia" }, { id: "transferencia", label: "Transferencia" }, { id: "tarjeta", label: "Tarjeta" },
];
const conMiles = (v: string) => (v.replace(/[^\d]/g, "") ? Number(v.replace(/[^\d]/g, "")).toLocaleString("es-CO") : "");

/** El cobro: medio de pago, pago mixto, recibido y cambio, y la confirmación. */
export function Cobro({ aCredito, medio, setMedio, otro, setOtro, otroNum, restante, recibido, setRecibido, recibidoNum, cambio, recibidoRef,
  confirmar, error, enviando, total, tipoDoc, volver, precios }: {
  aCredito: boolean; medio: Medio; setMedio: (m: Medio) => void; otro: { medio: Medio; valor: string } | null; setOtro: (o: { medio: Medio; valor: string } | null) => void;
  otroNum: number; restante: number; recibido: string; setRecibido: (v: string) => void; recibidoNum: number; cambio: number; recibidoRef: RefObject<HTMLInputElement | null>;
  confirmar: () => void; error: string; enviando: boolean; total: number; tipoDoc: "pos" | "factura"; volver: () => void; precios: number;
}) {
  return (
    <div className="px-6 pt-5">
      {precios > 0 && <p className="mb-3 rounded-xl bg-aviso-soft text-aviso px-4 py-2.5 text-sm font-semibold">{precios === 1 ? "Un producto cambió" : `${precios} productos cambiaron`} de precio desde el pedido: se cobra el precio de hoy (míralo en cada línea).</p>}
      {!aCredito && <>
        <p className="text-sm font-semibold mb-2">Medio de pago</p>
        <div className="grid grid-cols-3 gap-2" role="group" aria-label="Medio de pago">
          {MEDIOS.map((m) => (
            <button key={m.id} aria-pressed={medio === m.id} onClick={() => setMedio(m.id)}
              className={`h-11 rounded-lg border-2 text-sm font-semibold ${medio === m.id ? "border-ink bg-ink text-white" : "border-line"}`}>{m.label}</button>
          ))}
        </div>
        {medio === "efectivo" && (
          <div className="mt-4">
            {otro ? (
              <div className="mb-3 rounded-xl bg-paper p-3 grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
                <div><label htmlFor="otro-medio" className="text-sm font-semibold">Parte con</label>
                  <select id="otro-medio" className="campo !h-11" value={otro.medio} onChange={(e) => setOtro({ ...otro, medio: e.target.value as Medio })}>
                    {MEDIOS.filter((m) => m.id !== "efectivo").map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                  </select></div>
                <div><label htmlFor="otro-valor" className="text-sm font-semibold">Valor</label>
                  <input id="otro-valor" inputMode="numeric" className="campo !h-11 num" value={otro.valor} onChange={(e) => setOtro({ ...otro, valor: conMiles(e.target.value) })} /></div>
                <button type="button" aria-label="Quitar pago mixto" onClick={() => setOtro(null)} className="h-11 px-3 text-muted text-sm">Quitar</button>
                {otroNum > 0 && <p className="col-span-3 text-sm">Resto en efectivo: <span className="num font-semibold">{pesos(restante)}</span></p>}
              </div>
            ) : (
              <button type="button" onClick={() => setOtro({ medio: "tarjeta", valor: "" })} className="mb-3 block text-sm font-semibold text-cruz">+ Pago mixto (parte con otro medio)</button>
            )}
            <label htmlFor="recibido" className="text-sm font-semibold">{otroNum > 0 ? "Efectivo recibido" : "Recibido"}</label>
            <input id="recibido" ref={recibidoRef} inputMode="numeric" value={recibido} onChange={(e) => setRecibido(conMiles(e.target.value))}
              onKeyDown={(e) => { if (e.key === "Enter") confirmar(); }}
              placeholder={restante.toLocaleString("es-CO")} className="num mt-1 w-full h-14 rounded-xl border-2 border-line focus:border-ink outline-none px-4 text-2xl font-cond" style={{ fontWeight: 700 }} />
            <div className="mt-2 flex flex-wrap gap-2">
              {[restante, 20000, 50000, 100000].filter((v, i, a) => v >= restante && a.indexOf(v) === i).map((v) => (
                <button key={v} onClick={() => setRecibido(v.toLocaleString("es-CO"))} className="num px-3 h-9 rounded-lg border border-line text-sm font-semibold">{v === restante ? "Exacto" : pesos(v)}</button>
              ))}
            </div>
            {recibidoNum >= restante && <p className="mt-3 flex justify-between text-lg"><span>Cambio</span><span className="num font-cond text-2xl" style={{ fontWeight: 700 }}>{pesos(cambio)}</span></p>}
          </div>
        )}
      </>}
      {error && <p role="alert" className="mt-3 text-alerta text-sm">{error}</p>}
      <button onClick={confirmar} disabled={enviando} className="mt-4 w-full h-14 rounded-xl bg-cruz text-cruz-ink text-lg font-semibold disabled:opacity-60">
        {enviando ? "Registrando…" : aCredito ? `Facturar a crédito ${pesos(total)}` : tipoDoc === "factura" ? `Facturar ${pesos(total)}` : `Confirmar ${pesos(total)}`}
      </button>
      <button onClick={volver} className="mt-2 w-full h-10 text-muted text-sm">Volver a la venta <kbd>Esc</kbd></button>
    </div>
  );
}
