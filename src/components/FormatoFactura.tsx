"use client";
import { useState } from "react";

/** Cómo sale la factura electrónica al cobrar: tamaño carta (empresas y droguerías) o la tirilla de la térmica. */
export function FormatoFactura({ inicial }: { inicial: "carta" | "tirilla" }) {
  const [f, setF] = useState(inicial);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  async function cambiar(v: "carta" | "tirilla") {
    const antes = f; setF(v); setMsg(null);
    const r = await fetch("/api/empresa/factura", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ formato: v }) }).catch(() => null);
    const j = await r?.json().catch(() => ({}));
    if (!r?.ok) { setF(antes); setMsg({ ok: false, t: j?.error ?? "Sin conexión: vuelve a intentarlo." }); return; }
    setMsg({ ok: true, t: j.mensaje });
  }
  return (
    <section className="tarjeta p-5 grid gap-3" aria-labelledby="formato-t">
      <div>
        <h2 id="formato-t" className="titulo text-xl">Factura impresa</h2>
        <p className="text-sm text-muted">Cómo sale la factura electrónica al cobrar en tus cajas. El tiquete POS siempre sale en la tirilla. Cada caja puede cambiarlo en «Impresora de esta caja».</p>
      </div>
      <fieldset className="grid sm:grid-cols-2 gap-2">
        <legend className="sr-only">Formato de la factura</legend>
        {([["carta", "Tamaño carta", "Con tu logo, los datos completos del cliente y el lote de cada producto. Para empresas y droguerías."],
           ["tirilla", "Tirilla de la térmica", "En el papel de 80 o 58 mm de la caja. Para el mostrador."]] as const).map(([v, t, d]) => (
          <label key={v} className={`flex gap-3 rounded-xl border-2 p-3 cursor-pointer has-[:focus-visible]:outline has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-marca ${f === v ? "border-ink bg-paper" : "border-line bg-surface hover:border-ink/50"}`}>
            <input type="radio" name="formato-factura" value={v} checked={f === v} onChange={() => void cambiar(v)} className="accent-[var(--ink)] w-4 h-4 mt-1 shrink-0" />
            <span><span className="font-semibold">{t}</span><span className="block text-sm text-muted">{d}</span></span>
          </label>
        ))}
      </fieldset>
      {msg && <p role={msg.ok ? "status" : "alert"} className={`text-sm font-semibold ${msg.ok ? "text-cruz" : "text-alerta"}`}>{msg.t}</p>}
    </section>
  );
}
