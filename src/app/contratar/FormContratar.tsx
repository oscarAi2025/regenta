"use client";
import Link from "next/link";
import { useState } from "react";
import { pesos } from "@/lib/formato";

type PlanVenta = { id: "esencial" | "pro"; nombre: string; precio: number; para: string };

/** Formulario de compra: plan, periodo, medio de pago y datos de contacto. La pasarela recibe el pago; aquí nada de tarjetas. */
export function FormContratar({ plan: inicial, planes, activos }: { plan: "esencial" | "pro"; planes: PlanVenta[]; activos: { qr: boolean; wompi: boolean; stripe: boolean } }) {
  const [plan, setPlan] = useState(inicial);
  const [periodo, setPeriodo] = useState<"mes" | "anio">("mes");
  const [proveedor, setProveedor] = useState<"qr" | "wompi" | "stripe">(activos.qr ? "qr" : activos.stripe ? "stripe" : "wompi");
  const [f, setF] = useState({ nombre: "", empresa: "", nit: "", email: "", telefono: "", acepta: false });
  const [error, setError] = useState("");
  // Campo del error (para llevar a la persona hasta él: en el celular el mensaje quedaba debajo de la barra fija).
  const [campoMal, setCampoMal] = useState<string | null>(null);
  const marcar = (msg: string) => {
    const id = /NIT|cédula/i.test(msg) ? "c-nit" : /celular/i.test(msg) ? "c-tel" : /correo/i.test(msg) ? "c-email" : /nombre/i.test(msg) && !/droguer/i.test(msg) ? "c-nombre" : /droguer|empresa/i.test(msg) ? "c-empresa" : null;
    setError(msg); setCampoMal(id);
    if (id) { const el = document.getElementById(id); el?.scrollIntoView({ block: "center", behavior: "smooth" }); el?.focus({ preventScroll: true }); }
  };
  const [enviando, setEnviando] = useState(false);
  const elegido = planes.find((p) => p.id === plan)!;
  const total = periodo === "anio" ? elegido.precio * 10 : elegido.precio;

  async function pagar(e: React.FormEvent) {
    e.preventDefault();
    if (enviando) return;
    // Mismas reglas que el servidor, antes de enviar.
    if (!/^[\d.\s-]{6,15}$/.test(f.nit.trim())) { marcar("Escribe el NIT de la droguería (o tu cédula) sin letras"); return; }
    if (!/^[\d\s+()-]{7,20}$/.test(f.telefono.trim())) { marcar("Escribe un celular válido"); return; }
    setEnviando(true); setError(""); setCampoMal(null);
    try {
      const r = await fetch("/api/pagos", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ plan, periodo, proveedor, ...f }) });
      const j = await r.json();
      if (!r.ok) { marcar(j.error ?? "No se pudo iniciar el pago"); return; }
      location.href = j.url;
    } catch { setError("Sin conexión con el servidor: revisa internet e intenta de nuevo."); } finally { setEnviando(false); }
  }

  return (
    <form onSubmit={pagar} className="tarjeta p-5 sm:p-8 grid gap-6" aria-label="Contratar Regenta">
      <fieldset>
        <legend className="font-cond text-2xl" style={{ fontWeight: 700 }}>1. Tu plan</legend>
        <div className="mt-3 grid sm:grid-cols-2 gap-3" role="group" aria-label="Plan">
          {planes.map((p) => (
            <button type="button" key={p.id} aria-pressed={plan === p.id} onClick={() => setPlan(p.id)}
              className={`rounded-2xl border-2 p-4 text-left ${plan === p.id ? "border-teal-600 bg-teal-50" : "border-line"}`}>
              <span className="flex items-center justify-between gap-2"><span className="font-cond text-2xl" style={{ fontWeight: 700 }}>{p.nombre}</span>{plan === p.id && <span className="pastilla h-7 text-[12px] bg-teal-600 text-white">✓ Seleccionado</span>}</span>
              <span className="block text-sm text-muted">{p.para}</span>
              <span className="block mt-1 num font-semibold">{pesos(p.precio)} / mes</span>
            </button>
          ))}
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2 rounded-xl bg-paper p-1" role="group" aria-label="Periodo">
          {([["mes", "Mensual"], ["anio", "Anual · 2 meses gratis"]] as const).map(([k, t]) => (
            <button type="button" key={k} aria-pressed={periodo === k} onClick={() => setPeriodo(k)} className={`h-11 rounded-lg text-sm font-semibold ${periodo === k ? "bg-ink text-white" : "text-muted"}`}>{t}</button>
          ))}
        </div>
      </fieldset>

      <fieldset>
        <legend className="font-cond text-2xl" style={{ fontWeight: 700 }}>2. Cómo pagas</legend>
        <div className="mt-3 grid gap-3" role="group" aria-label="Medio de pago">
          {activos.qr && (
            <button type="button" aria-pressed={proveedor === "qr"} onClick={() => setProveedor("qr")} className={`rounded-2xl border-2 p-4 text-left ${proveedor === "qr" ? "border-teal-600 bg-teal-50" : "border-line"}`}>
              <span className="block font-semibold">QR Bancolombia</span>
              <span className="block text-sm text-muted">Escaneas el QR desde la app de cualquier banco, Nequi o Daviplata (Bre-B) y nos envías el comprobante.</span>
            </button>
          )}
          {activos.wompi && (
            <button type="button" aria-pressed={proveedor === "wompi"} onClick={() => setProveedor("wompi")} className={`rounded-2xl border-2 p-4 text-left ${proveedor === "wompi" ? "border-teal-600 bg-teal-50" : "border-line"}`}>
              <span className="block font-semibold">Pago en Colombia</span>
              <span className="block text-sm text-muted">Tarjeta, PSE, Nequi, Daviplata, Botón Bancolombia o código QR Bancolombia. Pasarela Wompi.</span>
            </button>
          )}
          {activos.stripe && (
            <button type="button" aria-pressed={proveedor === "stripe"} onClick={() => setProveedor("stripe")} className={`rounded-2xl border-2 p-4 text-left ${proveedor === "stripe" ? "border-teal-600 bg-teal-50" : "border-line"}`}>
              <span className="block font-semibold">Tarjeta con renovación automática</span>
              <span className="block text-sm text-muted">Visa, Mastercard o American Express; se cobra solo cada {periodo === "anio" ? "año" : "mes"}. Pasarela Stripe; en tu extracto aparece IA DEV INVESTMENTS LLC.</span>
            </button>
          )}
        </div>
        {proveedor === "qr" && <p className="mt-2 text-sm text-muted">Al continuar ves el QR y el monto exacto. Pagas este {periodo === "anio" ? "año" : "mes"}; antes del siguiente te avisamos para renovar.</p>}
        {proveedor === "wompi" && <p className="mt-2 text-sm text-muted">Con Wompi pagas este {periodo === "anio" ? "año" : "mes"}; antes del siguiente te enviamos el enlace para renovar.</p>}
      </fieldset>

      <fieldset className="grid sm:grid-cols-2 gap-3">
        <legend className="font-cond text-2xl mb-3" style={{ fontWeight: 700 }}>3. Tus datos</legend>
        <div><label htmlFor="c-nombre" className="etiqueta">Tu nombre</label><input id="c-nombre" aria-invalid={campoMal === "c-nombre"} aria-describedby={campoMal === "c-nombre" ? "c-error" : undefined} className="campo" required autoComplete="name" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></div>
        <div><label htmlFor="c-empresa" className="etiqueta">Droguería o empresa</label><input id="c-empresa" aria-invalid={campoMal === "c-empresa"} aria-describedby={campoMal === "c-empresa" ? "c-error" : undefined} className="campo" required autoComplete="organization" value={f.empresa} onChange={(e) => setF({ ...f, empresa: e.target.value })} /></div>
        <div><label htmlFor="c-nit" className="etiqueta">NIT de la droguería <span className="font-normal text-muted">(o tu cédula)</span></label><input id="c-nit" aria-invalid={campoMal === "c-nit"} aria-describedby={campoMal === "c-nit" ? "c-error" : undefined} className="campo num" required inputMode="numeric" placeholder="900123456" value={f.nit} onChange={(e) => setF({ ...f, nit: e.target.value })} /></div>
        <div><label htmlFor="c-tel" className="etiqueta">Celular (WhatsApp)</label><input id="c-tel" aria-invalid={campoMal === "c-tel"} aria-describedby={campoMal === "c-tel" ? "c-error" : undefined} className="campo num" required inputMode="tel" autoComplete="tel" value={f.telefono} onChange={(e) => setF({ ...f, telefono: e.target.value })} /></div>
        <div className="sm:col-span-2"><label htmlFor="c-email" className="etiqueta">Correo</label><input id="c-email" aria-invalid={campoMal === "c-email"} aria-describedby={campoMal === "c-email" ? "c-error" : undefined} type="email" className="campo" required autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        <label className="sm:col-span-2 flex items-start gap-3 text-[15px] py-2 cursor-pointer"><input type="checkbox" required className="mt-0.5 size-6 shrink-0 accent-teal-600" checked={f.acepta} onChange={(e) => setF({ ...f, acepta: e.target.checked })} />
          <span>Acepto los <Link href="/terminos" className="underline">términos y condiciones</Link> y autorizo el tratamiento de mis datos según la <Link href="/privacidad" className="underline">política de datos</Link> para activar y facturar mi plan.</span></label>
      </fieldset>

      <div className="sticky bottom-2 z-20 rounded-2xl degradado-marca text-white p-3 sm:p-5 flex flex-wrap items-center justify-between gap-2 sm:gap-3 shadow-[0_20px_40px_-20px_rgba(14,116,144,.8)]">
        <div><p className="text-white/80 text-sm">Total a pagar hoy</p><p className="num font-cond text-[clamp(28px,8vw,40px)] leading-none" style={{ fontWeight: 700 }}>{pesos(total)}</p>
          <p className="text-white/75 text-sm hidden min-[400px]:block [@media(max-height:500px)]:hidden">{elegido.nombre} · {periodo === "anio" ? `12 meses por el precio de 10 (ahorras ${pesos(elegido.precio * 2)})` : "1 mes"}</p></div>
        {error && <p id="c-error" role="alert" className="basis-full order-first rounded-lg bg-white text-alerta font-semibold px-3 py-2 text-[15px]">{error}</p>}
        <button disabled={enviando} className="btn-cta h-12 sm:h-14 px-5 sm:px-8 text-base sm:text-lg disabled:opacity-60">{enviando ? "Abriendo el pago…" : proveedor === "qr" ? "Ver el QR para pagar" : "Pagar de forma segura"}</button>
      </div>
      <p className="text-sm font-semibold text-teal-800">✓ Incluye certificado digital y habilitación de tu NIT ante la DIAN, sin costo adicional.</p>
      <p className="text-xs text-muted">{proveedor === "qr" ? "Pagas desde la app de tu banco: Regenta no ve ni guarda los datos de tu cuenta." : "El pago lo procesa la pasarela; Regenta no ve ni guarda los datos de tu tarjeta."}</p>
    </form>
  );
}
