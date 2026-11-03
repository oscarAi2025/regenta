"use client";
import { useEffect, useState } from "react";
import { pesos } from "@/lib/formato";

/** Abonado o saldo de una factura: se actualiza al instante con lo que confirma el servidor al guardar un abono
 *  (no depende de que la página termine de recargarse). */
export function Valor({ venta, campo, inicial }: { venta: string; campo: "abonado" | "saldo"; inicial: number }) {
  const [v, setV] = useState(inicial);
  useEffect(() => setV(inicial), [inicial]);
  useEffect(() => {
    const f = (e: Event) => { const d = (e as CustomEvent<{ venta: string; abonado: number; saldo: number }>).detail; if (d.venta === venta) setV(d[campo]); };
    window.addEventListener("regenta:abono", f);
    return () => window.removeEventListener("regenta:abono", f);
  }, [venta, campo]);
  return <>{pesos(v)}</>;
}
