/** Mientras llega una pantalla del panel. Además de dar respuesta inmediata al tocar el menú, separa la página en su
 *  propio límite de Suspense: React solo la hidrata cuando el HTML llegó completo. Sin él, en pantallas largas
 *  (Productos con 50 filas) el JavaScript en caché a veces empezaba antes y React daba el error 418. */
export default function Cargando() {
  return (
    <main className="p-4 sm:p-6 grid gap-5" aria-busy="true" aria-label="Cargando">
      <div className="h-9 w-56 rounded-lg bg-line/60 animate-pulse" />
      <div className="tarjeta h-64 animate-pulse" />
    </main>
  );
}
