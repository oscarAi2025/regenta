"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { pesos } from "@/lib/formato";
import { wa } from "@/lib/sitio";

type Estado = { estado: string; plan: string; periodo: string; monto: number; proveedor?: string; qr?: { llave: string; imagen: string; titular: string } } | { error: string };

/** Consulta el estado del pago cada pocos segundos hasta que la pasarela lo confirme (máximo 2 minutos). */
export function Resultado({ referencia, transaccion }: { referencia: string; transaccion: string }) {
  const [e, setE] = useState<Estado | null>(null);
  useEffect(() => {
    let vivo = true, n = 0;
    const consulta = async () => {
      try {
        const r = await fetch(`/api/pagos/estado?ref=${encodeURIComponent(referencia)}${transaccion ? `&id=${encodeURIComponent(transaccion)}` : ""}`);
        const j = await r.json(); if (!vivo) return; setE(j);
        // El QR se confirma a mano (puede tardar): se sigue consultando cada 15 s mientras la página esté abierta.
        if (j.estado === "pendiente" && (j.proveedor === "qr" || ++n < 40)) setTimeout(consulta, j.proveedor === "qr" ? 15000 : 3000);
      } catch { if (vivo && ++n < 40) setTimeout(consulta, 3000); }
    };
    consulta();
    return () => { vivo = false; };
  }, [referencia, transaccion]);

  if (!e) return <p className="mt-6 text-muted text-lg">Consultando tu pago…</p>;
  if ("error" in e) return <p className="mt-6 text-alerta text-lg">{e.error}. Si pagaste, escríbenos por WhatsApp con tu comprobante.</p>;
  const plan = e.plan === "pro" ? "Pro" : "Esencial";
  if (e.estado === "aprobado") return (
    <div className="mt-6 rounded-3xl degradado-marca text-white p-6 sm:p-8">
      <p className="font-cond text-[34px] leading-tight" style={{ fontWeight: 700 }}>¡Pago aprobado! Bienvenido a Regenta.</p>
      <p className="mt-3 text-white/85 text-lg">Plan {plan}, {e.periodo === "anio" ? "anual" : "mensual"}, {pesos(e.monto)}. Te escribimos por WhatsApp para activar tu cuenta y cargar tus productos.</p>
      <p className="mt-2 text-white/70 text-sm">Referencia {referencia}</p>
      <a href={wa(`Hola, acabo de pagar Regenta plan ${plan}. Referencia ${referencia}.`)} className="btn-cta h-12 px-6 mt-6">Escribir ya por WhatsApp</a>
    </div>
  );
  if (e.estado === "pendiente" && e.proveedor === "qr" && e.qr) return (
    <div className="mt-6 grid gap-5">
      <div className="tarjeta p-6 sm:p-8 grid sm:grid-cols-[auto_1fr] gap-6 items-center">
        {e.qr.imagen ? <img src={e.qr.imagen} alt="Código QR de pago de Regenta (Bancolombia, Bre-B)" width={220} height={220} className="mx-auto rounded-2xl border border-line bg-white p-2" /> : null}
        <div>
          <p className="text-muted">Paga exactamente</p>
          <p className="num font-cond text-[48px] leading-none" style={{ fontWeight: 700 }}>{pesos(e.monto)}</p>
          <p className="mt-2">Plan {plan}, {e.periodo === "anio" ? "anual" : "mensual"}.</p>
          <p className="mt-3 text-[15px]">Escanea el QR desde la app de tu banco, Nequi o Daviplata{e.qr.llave ? <>, o transfiere a la llave Bre-B <b className="num">{e.qr.llave}</b></> : null}. Titular: {e.qr.titular}.</p>
        </div>
      </div>
      <ol className="tarjeta p-6 grid gap-3 text-[15px]">
        <li><b>1.</b> Paga el monto exacto.</li>
        <li><b>2.</b> Envíanos el comprobante por WhatsApp con tu referencia <b className="num">{referencia}</b>.</li>
        <li><b>3.</b> Al ver el pago en la cuenta lo confirmamos: esta página cambia sola y te llega el correo.</li>
      </ol>
      <a href={wa(`Hola, ya pagué Regenta plan ${plan} por QR: ${pesos(e.monto)}. Referencia ${referencia}. Adjunto el comprobante.`)} className="btn-cta h-14 px-8 text-lg justify-self-start">Ya pagué: enviar comprobante por WhatsApp</a>
      <p className="text-sm text-muted">Te enviamos estas mismas instrucciones a tu correo.</p>
    </div>
  );
  if (e.estado === "pendiente") return (
    <div className="mt-6 tarjeta p-6"><p className="text-lg font-semibold">Tu pago está en proceso.</p><p className="mt-2 text-muted">Algunos medios (PSE, QR) tardan unos minutos en confirmar. Puedes dejar esta página abierta: se actualiza sola.</p><p className="mt-2 text-sm text-muted">Referencia {referencia}</p></div>
  );
  return (
    <div className="mt-6 tarjeta p-6">
      <p className="text-lg font-semibold text-alerta">El pago no se aprobó{e.estado === "rechazado" ? ": el banco lo rechazó" : ""}.</p>
      <p className="mt-2 text-muted">{e.estado === "error" ? "Hubo una diferencia en el pago. Escríbenos por WhatsApp con tu referencia y lo revisamos." : "No se cobró nada. Puedes intentar con otro medio de pago."}</p>
      <div className="mt-5 flex flex-wrap gap-3"><Link href={`/contratar?plan=${e.plan}`} className="btn-cta h-12 px-6">Intentar de nuevo</Link><a href={wa(`Hola, tuve un problema pagando Regenta. Referencia ${referencia}.`)} className="btn-borde h-12 px-6">Ayuda por WhatsApp</a></div>
    </div>
  );
}
