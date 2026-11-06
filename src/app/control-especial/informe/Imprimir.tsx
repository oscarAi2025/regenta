"use client";

/** Imprimir o guardar en PDF (los botones no salen en el papel). */
export function Imprimir() {
  return (
    <div className="flex flex-wrap gap-2 print:hidden">
      <button onClick={() => window.print()} className="btn-primario h-11">Imprimir o guardar PDF</button>
      <a href="/control-especial" className="btn-borde h-11 inline-flex items-center">Volver al libro</a>
    </div>
  );
}
