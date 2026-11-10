/** Mientras llega una pantalla de la consola. Separa la página en su propio límite de Suspense: React la hidrata solo
 *  cuando el HTML llegó completo (sin él aparecía a veces el error 418). El acceso ya se decidió en el layout. */
export default function Cargando() {
  return (
    <div role="status" className="p-4 sm:p-6 grid gap-5" aria-busy="true" aria-label="Cargando">
      <div className="h-9 w-56 rounded-lg bg-line/60 animate-pulse" />
      <div className="tarjeta h-64 animate-pulse" />
    </div>
  );
}
