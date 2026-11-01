"use client";
import { useEffect, useState } from "react";
import { ChatDemo } from "./ChatDemo";

/** Cuenta hasta el valor una sola vez al cargar (sin animación si el sistema pide movimiento reducido). */
function Cuenta({ hasta, pesos = false }: { hasta: number; pesos?: boolean }) {
  const [v, setV] = useState(hasta);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let raf = 0; const t0 = performance.now();
    const paso = (t: number) => { const k = Math.min(1, (t - t0) / 1400); setV(Math.round(hasta * (1 - Math.pow(1 - k, 3)))); if (k < 1) raf = requestAnimationFrame(paso); };
    setV(0); raf = requestAnimationFrame(paso);
    return () => cancelAnimationFrame(raf);
  }, [hasta]);
  return <>{pesos ? "$" + v.toLocaleString("es-CO") : v.toLocaleString("es-CO")}</>;
}

/** Portada: el producto en acción (ejemplo): el día de la droguería, la factura, la alerta y la IA. */
export function HeroProducto() {
  return (
    <div role="group" className="relative w-full max-w-[520px] mx-auto lg:mx-0" aria-label="Ejemplo de Regenta en una droguería">
      <div className="entra rounded-3xl bg-white/[.06] border border-white/15 backdrop-blur p-4 sm:p-5 text-white" style={{ animationDelay: "150ms" }}>
        <div className="flex items-center justify-between text-sm"><span className="font-semibold">Hoy en tu droguería</span><span className="text-white/50">Ejemplo</span></div>
        <dl className="mt-3 grid grid-cols-3 gap-2">
          <div className="rounded-2xl bg-white/[.07] p-3"><dt className="text-[12px] text-white/60">Vendido hoy</dt><dd className="num font-cond text-[22px] sm:text-[26px] leading-tight text-teal-300" style={{ fontWeight: 700 }}><Cuenta hasta={2184300} pesos /></dd></div>
          <div className="rounded-2xl bg-white/[.07] p-3"><dt className="text-[12px] text-white/60">Para pedir</dt><dd className="num font-cond text-[22px] sm:text-[26px] leading-tight text-sky-300" style={{ fontWeight: 700 }}><Cuenta hasta={18} /> prod.</dd></div>
          <div className="rounded-2xl bg-white/[.07] p-3"><dt className="text-[12px] text-white/60">Se puede vencer</dt><dd className="num font-cond text-[22px] sm:text-[26px] leading-tight text-amber-300" style={{ fontWeight: 700 }}><Cuenta hasta={412000} pesos /></dd></div>
        </dl>
      </div>
      <div className="mt-4"><ChatDemo /></div>
      <p className="flota hidden sm:flex absolute -left-8 -top-5 items-center gap-2 rounded-2xl bg-white text-ink px-3.5 py-2.5 text-[13px] font-semibold shadow-[0_18px_40px_-16px_rgba(0,0,0,.6)]">
        <span className="size-6 rounded-full bg-emerald-500 text-white grid place-items-center text-[12px]" aria-hidden="true">✓</span>Factura electrónica SETT1024 emitida
      </p>
      <p className="flota-2 hidden sm:flex absolute -right-6 bottom-24 max-w-[230px] items-start gap-2 rounded-2xl bg-white text-ink px-3.5 py-2.5 text-[13px] shadow-[0_18px_40px_-16px_rgba(0,0,0,.6)]">
        <span className="mt-0.5 size-6 shrink-0 rounded-full bg-red-600 text-white grid place-items-center text-[12px] font-bold" aria-hidden="true">!</span>
        <span><b>Alerta INVIMA 329-2026</b><br />Tienes 40 und del lote F0537A</span>
      </p>
    </div>
  );
}
