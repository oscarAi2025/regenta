"use client";
import { useEffect } from "react";

/** Botones de la tirilla (no salen en el papel) e impresión automática al abrirla con ?auto=1. */
export function AutoImprimir({ auto }: { auto: boolean }) {
  useEffect(() => {
    if (!auto) return;
    // Espera a que carguen las fuentes y el QR antes de mandar a la impresora.
    const t = setTimeout(() => window.print(), 300);
    return () => clearTimeout(t);
  }, [auto]);
  return (
    <>
      <button onClick={() => window.print()}>Imprimir</button>
      <button onClick={() => (window.history.length > 1 ? window.history.back() : window.close())}>Volver</button>
    </>
  );
}
