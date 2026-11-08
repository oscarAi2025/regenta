/** Mientras llega una pantalla de la consola. Como en el panel (src/app/(app)/loading.tsx): da a cada página su propio
 *  límite de Suspense para que React la hidrate solo con el HTML completo. Sin él, en celulares grandes con el
 *  JavaScript en caché, /admin/clientes daba de vez en cuando el error React 418 (batería del 08/11/2026). */
export default function Cargando() {
  return (
    <div role="status" className="p-4 sm:p-6 grid gap-5" aria-busy="true" aria-label="Cargando">
      <div className="h-9 w-56 rounded-lg bg-line/60 animate-pulse" />
      <div className="tarjeta h-64 animate-pulse" />
    </div>
  );
}
