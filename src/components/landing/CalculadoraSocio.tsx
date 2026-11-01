"use client";
import { useState } from "react";
import { precioSocio, PLANES } from "@/lib/planes";
import { pesos } from "@/lib/formato";

const n = (s: string) => Number(s.replace(/\D/g, "")) || 0;

/** «¿Cuánto me sale Regenta?»: el visitante pone lo que le compra al mes a Farmagenéricos y ve su precio por plan. */
export function CalculadoraSocio() {
  const [compras, setCompras] = useState("2.000.000");
  const c = n(compras);
  return (
    <div className="grid md:grid-cols-[1fr_1.2fr] gap-6 items-end">
      <div>
        <label htmlFor="calc-compras" className="etiqueta text-white">¿Cuánto le compras al mes a Farmagenéricos?</label>
        <input id="calc-compras" inputMode="numeric" value={compras} onChange={(e) => setCompras(n(e.target.value) ? n(e.target.value).toLocaleString("es-CO") : "")} className="campo h-14 text-xl num text-ink" />
        <p className="mt-2 text-sm text-white/60">Pon 0 si todavía no le compras: verás el precio normal.</p>
      </div>
      <div className="grid grid-cols-2 gap-3" role="status" aria-live="polite">
        {(["esencial", "pro"] as const).map((plan) => {
          const final = precioSocio(plan, c), base = PLANES.find((p) => p.id === plan)!.precio!;
          return (
            <div key={plan} className="rounded-2xl bg-white/10 p-4">
              <p className="text-white/70">{plan === "esencial" ? "Esencial" : "Pro"}</p>
              <p className="font-cond text-[40px] leading-none num mt-1" style={{ fontWeight: 700 }}>{final === 0 ? "Gratis" : pesos(final)}</p>
              <p className="text-sm text-white/60 mt-1">{final < base ? <>antes <s>{pesos(base)}</s> al mes</> : "al mes"}</p>
            </div>
          );
        })}
      </div>
    </div>
  );
}
