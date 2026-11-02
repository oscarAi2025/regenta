"use client";
import { imprimirTiquete } from "@/lib/impresion";

/** Reimprime la tirilla con la impresora configurada en esta caja. */
export function Imprimir({ id }: { id: string }) {
  return (
    <div className="flex gap-2">
      <button onClick={() => imprimirTiquete(id)} className="btn-primario h-11">Imprimir tiquete</button>
      <a href={`/tiquete/${id}`} className="btn-borde h-11 inline-flex items-center">Ver tirilla</a>
    </div>
  );
}
