"use client";

/** Documento imprimible dentro del panel (acta, informe): al imprimir solo sale el documento, sin menú ni botones. */
export function Imprimible({ children, volver, etiqueta }: { children: React.ReactNode; volver: { href: string; texto: string }; etiqueta: string }) {
  return (
    <>
      <style>{`
        @page { size: letter; margin: 14mm 12mm; }
        @media print {
          html, body { background: #fff !important; }
          body * { visibility: hidden !important; }
          #documento, #documento * { visibility: visible !important; }
          #documento { position: absolute; inset: 0 auto auto 0; width: 100%; margin: 0; padding: 0; border: 0 !important; box-shadow: none !important; }
          #documento .no-imprimir { display: none !important; }
          #documento tr, #documento .firma { break-inside: avoid; }
        }
      `}</style>
      <div className="flex flex-wrap gap-2 print:hidden">
        <button type="button" onClick={() => window.print()} className="btn-primario">Imprimir o guardar PDF</button>
        <a href={volver.href} className="btn-borde">{volver.texto}</a>
      </div>
      <article id="documento" aria-label={etiqueta} className="tarjeta bg-white p-4 sm:p-8 text-ink max-w-4xl w-full min-w-0">{children}</article>
    </>
  );
}
