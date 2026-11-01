"use client";
import Link from "next/link";
import { useState } from "react";
import { pesos } from "@/lib/formato";

type PlanVenta = { id: "esencial" | "pro"; nombre: string; precio: number; para: string };

/** Formulario de compra: plan, periodo, medio de pago y datos de contacto. La pasarela recibe el pago; aquí nada de tarjetas. */
export function FormContratar({ plan: inicial, planes, activos }: { plan: "esencial" | "pro"; planes: PlanVenta[]; activos: { wompi: boolean; stripe: boolean } }) {
  const [plan, setPlan] = useState(inicial);
  const [periodo, setPeriodo] = useState<"mes" | "anio">("mes");
  const [proveedor, setProveedor] = useState<"wompi" | "stripe">(activos.wompi ? "wompi" : "stripe");
  const [f, setF] = useState({ nombre: "", empresa: "", nit: "", email: "", telefono: "", acepta: false });
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const elegido = planes.find((p) => p.id === plan)!;
  const total = periodo === "anio" ? elegido.precio * 10 : elegido.precio;

  async function pagar(e: React.FormEvent) {
    e.preventDefault();
    if (enviando) return;
    setEnviando(true); setError("");
    try {
      const r = await fetch("/api/pagos", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ plan, periodo, proveedor, ...f }) });
      const j = await r.json();
      if (!r.ok) { setError(j.error ?? "No se pudo iniciar el pago"); return; }
      location.href = j.url;
    } catch { setError("Sin conexión con el servidor: revisa internet e intenta de nuevo."); } finally { setEnviando(false); }
  }

  return (
    <form onSubmit={pagar} className="tarjeta p-5 sm:p-8 grid gap-6" aria-label="Contratar Regenta">
      <fieldset>
        <legend className="font-cond text-2xl" style={{ fontWeight: 700 }}>1. Tu plan</legend>
        <div className="mt-3 grid sm:grid-cols-2 gap-3" role="radiogroup" aria-label="Plan">
          {planes.map((p) => (
            <button type="button" key={p.id} role="radio" aria-checked={plan === p.id} onClick={() => setPlan(p.id)}
              className={`rounded-2xl border-2 p-4 text-left ${plan === p.id ? "border-teal-600 bg-teal-50" : "border-line"}`}>
              <span className="block font-cond text-2xl" style={{ fontWeight: 700 }}>{p.nombre}</span>
              <span className="block text-sm text-muted">{p.para}</span>
              <span className="block mt-1 num font-semibold">{pesos(p.precio)} / mes</span>
            </button>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-paper p-1" role="radiogroup" aria-label="Periodo">
          {([["mes", "Mensual"], ["anio", "Anual · 2 meses gratis"]] as const).map(([k, t]) => (
            <button type="button" key={k} role="radio" aria-checked={periodo === k} onClick={() => setPeriodo(k)} className={`h-11 rounded-lg text-sm font-semibold ${periodo === k ? "bg-ink text-white" : "text-muted"}`}>{t}</button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="font-cond text-2xl" style={{ fontWeight: 700 }}>2. Cómo pagas</legend>
        <div className="mt-3 grid gap-3" role="radiogroup" aria-label="Medio de pago">
          {activos.wompi && (
            <button type="button" role="radio" aria-checked={proveedor === "wompi"} onClick={() => setProveedor("wompi")} className={`rounded-2xl border-2 p-4 text-left ${proveedor === "wompi" ? "border-teal-600 bg-teal-50" : "border-line"}`}>
              <span className="block font-semibold">Pago en Colombia</span>
              <span className="block text-sm text-muted">Tarjeta, PSE, Nequi, Daviplata, Botón Bancolombia o código QR Bancolombia. Pasarela Wompi.</span>
            </button>
          )}
          {activos.stripe && (
            <button type="button" role="radio" aria-checked={proveedor === "stripe"} onClick={() => setProveedor("stripe")} className={`rounded-2xl border-2 p-4 text-left ${proveedor === "stripe" ? "border-teal-600 bg-teal-50" : "border-line"}`}>
              <span className="block font-semibold">Tarjeta con renovación automática</span>
              <span className="block text-sm text-muted">Visa, Mastercard o American Express; se cobra solo cada {periodo === "anio" ? "año" : "mes"}. Pasarela Stripe.</span>
            </button>
          )}
        </div>
        {proveedor === "wompi" && <p className="mt-2 text-sm text-muted">Con Wompi pagas este {periodo === "anio" ? "año" : "mes"}; antes del siguiente te enviamos el enlace para renovar.</p>}
      </fieldset>

      <fieldset className="grid sm:grid-cols-2 gap-3">
        <legend className="font-cond text-2xl mb-3" style={{ fontWeight: 700 }}>3. Tus datos</legend>
        <div><label htmlFor="c-nombre" className="etiqueta">Tu nombre</label><input id="c-nombre" className="campo" required autoComplete="name" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></div>
        <div><label htmlFor="c-empresa" className="etiqueta">Droguería o empresa</label><input id="c-empresa" className="campo" required autoComplete="organization" value={f.empresa} onChange={(e) => setF({ ...f, empresa: e.target.value })} /></div>
        <div><label htmlFor="c-nit" className="etiqueta">NIT o cédula <span className="font-normal text-muted">(para tu factura)</span></label><input id="c-nit" className="campo num" inputMode="numeric" value={f.nit} onChange={(e) => setF({ ...f, nit: e.target.value })} /></div>
        <div><label htmlFor="c-tel" className="etiqueta">Celular (WhatsApp)</label><input id="c-tel" className="campo num" required inputMode="tel" autoComplete="tel" value={f.telefono} onChange={(e) => setF({ ...f, telefono: e.target.value })} /></div>
        <div className="sm:col-span-2"><label htmlFor="c-email" className="etiqueta">Correo</label><input id="c-email" type="email" className="campo" required autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        <label className="sm:col-span-2 flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={f.acepta} onChange={(e) => setF({ ...f, acepta: e.target.checked })} />
          <span>Autorizo el tratamiento de mis datos según la <Link href="/privacidad" className="underline">política de datos</Link> para activar y facturar mi plan.</span></label>
      </fieldset>

      <div className="rounded-2xl degradado-marca text-white p-5 flex flex-wrap items-center justify-between gap-4">
        <div><p className="text-white/80 text-sm">Total a pagar hoy</p><p className="num font-cond text-[40px] leading-none" style={{ fontWeight: 700 }}>{pesos(total)}</p>
          <p className="text-white/75 text-sm">{elegido.nombre} · {periodo === "anio" ? `12 meses por el precio de 10 (ahorras ${pesos(elegido.precio * 2)})` : "1 mes"}</p></div>
        <button disabled={enviando} className="btn-cta h-14 px-8 text-lg disabled:opacity-60">{enviando ? "Abriendo el pago…" : "Pagar de forma segura"}</button>
      </div>
      {error && <p role="alert" className="text-alerta font-semibold">{error}</p>}
      <p className="text-sm font-semibold text-teal-800">✓ Incluye certificado digital y habilitación de tu NIT ante la DIAN, sin costo adicional.</p>
      <p className="text-xs text-muted">El pago lo procesa la pasarela; Regenta no ve ni guarda los datos de tu tarjeta o tu cuenta.</p>
    </form>
  );
}
