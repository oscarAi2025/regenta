"use client";
import { imprimirFactura, imprimirTiquete } from "@/lib/impresion";

/** Reimprime la venta: la factura electrónica en tamaño carta (con logo y datos completos) o la tirilla de la térmica.
 *  El tiquete POS también puede sacarse en carta si el cliente lo pide. */
export function Imprimir({ id, factura }: { id: string; factura: boolean }) {
  return (
    <div className="flex flex-wrap gap-2">
      {factura ? <>
        <button onClick={() => imprimirFactura(id)} className="btn-primario h-11">Imprimir factura</button>
        <a href={`/tiquete/factura/${id}`} className="btn-borde h-11 inline-flex items-center">Ver factura</a>
        <button onClick={() => imprimirTiquete(id)} className="btn-borde h-11">Tirilla</button>
      </> : <>
        <button onClick={() => imprimirTiquete(id)} className="btn-primario h-11">Imprimir tiquete</button>
        <a href={`/tiquete/${id}`} className="btn-borde h-11 inline-flex items-center">Ver tirilla</a>
        <a href={`/tiquete/factura/${id}`} className="btn-borde h-11 inline-flex items-center">Tamaño carta</a>
      </>}
    </div>
  );
}
