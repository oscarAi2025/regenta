import { wa } from "@/lib/sitio";

/** En el celular, la acción siempre a un toque: barra fija abajo. */
export function BarraMovil() {
  return (
    <div className="sm:hidden fixed bottom-0 inset-x-0 z-40 bg-surface/95 backdrop-blur border-t border-line px-3 py-2.5 flex gap-2" style={{ paddingBottom: "max(10px, env(safe-area-inset-bottom))" }}>
      <a href="/demo" className="btn-primario flex-1 h-12">Probar la demo gratis</a>
      <a href={wa("Hola, quiero conocer Regenta para mi droguería.")} className="btn-borde h-12 px-4" aria-label="Escribir por WhatsApp">WhatsApp</a>
    </div>
  );
}
