"use client";
import Link from "next/link";
import { useEffect, useState } from "react";
import { BotonDemo } from "./BotonDemo";
import { GARANTIA_DIAS, PRECIO_DESDE } from "@/lib/oferta";
import { pesos } from "@/lib/formato";

/** Escritorio: al pasar el héroe aparece abajo una barra con la oferta y las dos acciones (en el celular ya está BarraMovil). */
export function BarraOferta({ texto = `Desde ${pesos(PRECIO_DESDE)} al mes · certificado y habilitación DIAN incluidos · ${GARANTIA_DIAS} días de garantía` }: { texto?: string }) {
  const [ver, setVer] = useState(false);
  useEffect(() => {
    const f = () => setVer(window.scrollY > 700 && window.innerHeight + window.scrollY < document.body.scrollHeight - 500);
    f(); window.addEventListener("scroll", f, { passive: true });
    return () => window.removeEventListener("scroll", f);
  }, []);
  return (
    <div aria-hidden={!ver} className={`hidden sm:flex fixed bottom-4 left-1/2 -translate-x-1/2 z-40 items-center gap-4 rounded-2xl bg-[#0b1f33]/95 backdrop-blur text-white pl-5 pr-2 py-2 shadow-[0_24px_48px_-16px_rgba(0,0,0,.6)] transition-all duration-300 ${ver ? "opacity-100 translate-y-0" : "opacity-0 translate-y-6 pointer-events-none"}`}>
      <p className="text-[15px] whitespace-nowrap hidden lg:block">{texto}</p>
      <div className="flex gap-2" inert={!ver}>
        <BotonDemo texto="Probar gratis" className="btn-vidrio h-11 px-5" />
        <Link href="/contratar?plan=pro&origen=barra" className="btn-cta h-11 px-6">Contratar ahora</Link>
      </div>
    </div>
  );
}
