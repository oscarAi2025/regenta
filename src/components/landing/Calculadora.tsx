"use client";
import { useState } from "react";

const n = (s: string) => Number(s.replace(/\D/g, "")) || 0;
const f = (x: number) => "$" + Math.round(x).toLocaleString("es-CO");

/** Con las cifras de la propia droguería: cuánto se pierde al año por vencimientos. */
export function Calculadora({ precioMes }: { precioMes: number }) {
  const [inv, setInv] = useState("40.000.000");
  const [pct, setPct] = useState("2");
  const perdida = n(inv) * (Number(pct.replace(",", ".")) || 0) / 100;
  const meses = perdida / precioMes;
  return (
    <div className="grid lg:grid-cols-2 gap-8 items-center">
      <div className="grid sm:grid-cols-2 gap-4">
        <div><label htmlFor="calc-inv" className="etiqueta text-white">Tu inventario a costo</label>
          <input id="calc-inv" inputMode="numeric" value={inv} onChange={(e) => setInv(n(e.target.value) ? n(e.target.value).toLocaleString("es-CO") : "")} className="campo h-12 text-lg num text-ink" /></div>
        <div><label htmlFor="calc-pct" className="etiqueta text-white">% que se te vence al año</label>
          <input id="calc-pct" inputMode="decimal" value={pct} onChange={(e) => { const v = e.target.value.replace(/[^\d,.]/g, "").slice(0, 4); setPct(Number(v.replace(",", ".")) > 100 ? "100" : v); }} className="campo h-12 text-lg num text-ink" /></div>
        <p className="sm:col-span-2 text-sm text-white/65">Cambia las cifras por las tuyas. Si no sabes cuánto se te vence, ese es el primer problema que Regenta te resuelve.</p>
      </div>
      <div role="status" aria-live="polite">
        <p className="text-white/75">Al año botas</p>
        <p className="font-cond text-[56px] sm:text-[72px] leading-none num text-[#ffb4ab]" style={{ fontWeight: 700 }}>{f(perdida)}</p>
        <p className="mt-2 text-white/85 text-lg">{meses >= 1 ? <>Eso paga <b className="text-white">{meses - Math.floor(meses) >= 0.5 ? `casi ${Math.ceil(meses)}` : Math.floor(meses)} meses</b> de Regenta Esencial.</> : "Aun así, cada lote que no se vence es plata en tu bolsillo."}</p>
      </div>
    </div>
  );
}
