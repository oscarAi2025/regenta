"use client";
import { useEffect } from "react";

/** Botones del documento (no salen en el papel), WhatsApp de la cotización e impresión automática con ?auto=1. */
export function Barra({ auto, whatsapp }: { auto: boolean; whatsapp: string | null }) {
  useEffect(() => {
    if (!auto) return;
    const t = setTimeout(() => window.print(), 300);
    return () => clearTimeout(t);
  }, [auto]);
  return (
    <div className="barra">
      <button onClick={() => window.print()}>Imprimir o guardar PDF</button>
      {whatsapp && <a href={whatsapp} target="_blank" rel="noopener">Enviar por WhatsApp</a>}
      <a href="/pedidos">Volver a pedidos</a>
    </div>
  );
}
