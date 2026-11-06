/** Mientras llega un documento imprimible (tirillas, actas, informes) o una pantalla de la consola.
 *  Su función real es dar a la página su propio límite de Suspense: estas rutas viven fuera del panel (que ya tiene
 *  src/app/(app)/loading.tsx) y su HTML llega por partes, mientras los scripts de Next se cargan con `async`. Sin el
 *  límite, con el JavaScript en caché React a veces hidrataba antes de que llegara todo el documento y daba el error 418
 *  (medido: 1 de 100 visitas al acta de recepción, 3 de 150 al informe de control especial). Con el límite, React solo
 *  hidrata la página cuando su HTML llegó completo. */
export function CargandoDocumento() {
  return (
    <div role="status" className="p-4 sm:p-6 grid gap-4 justify-items-center" aria-busy="true" aria-label="Cargando">
      <div className="h-9 w-full max-w-md rounded-lg bg-line/60 animate-pulse print:hidden" />
      <div className="h-64 w-full max-w-md rounded-xl bg-line/40 animate-pulse print:hidden" />
    </div>
  );
}
