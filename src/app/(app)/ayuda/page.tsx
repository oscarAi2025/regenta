import type { Metadata } from "next";
import { Cabecera } from "@/components/ui/Cabecera";
import { CAPITULOS_VIDEO } from "@/lib/ayuda";
import { CORREO, TELEFONO, wa } from "@/lib/sitio";
import { VideoGuia } from "./VideoGuia";

export const metadata: Metadata = { title: "Ayuda" };

/** Ayuda: el video formativo (con sus capítulos) y la guía de usuario en PDF, para todos los roles. */
export default function PaginaAyuda() {
  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo="Ayuda" sub="Aprende a usar Regenta paso a paso: el video formativo y la guía de usuario, pestaña por pestaña." />
      <VideoGuia capitulos={CAPITULOS_VIDEO} />
      <section className="grid md:grid-cols-2 gap-4" aria-label="Guía y soporte">
        <div className="tarjeta p-5 grid gap-3 content-start">
          <h2 className="titulo text-xl">Guía de usuario en PDF</h2>
          <p className="text-muted">43 páginas con imágenes reales: primer acceso, caja, factura electrónica, inventario por lote, cartera, cumplimiento, reportes y cierre de turno. Imprímela o guárdala en el celular.</p>
          <div className="flex flex-wrap gap-2">
            <a href="/manual/regenta-guia-de-usuario.pdf" target="_blank" rel="noopener" className="btn-primario">Abrir la guía</a>
            <a href="/manual/regenta-guia-de-usuario.pdf" download="Regenta - Guia de usuario.pdf" className="btn-borde">Descargar PDF</a>
          </div>
        </div>
        <div className="tarjeta p-5 grid gap-3 content-start">
          <h2 className="titulo text-xl">¿Necesitas ayuda?</h2>
          <p className="text-muted">Pregúntale a Regenta IA dentro del programa o escríbenos: te acompañamos en tu primera venta.</p>
          <div className="flex flex-wrap gap-2">
            <a href={wa("Hola, necesito ayuda con Regenta.")} target="_blank" rel="noopener" className="btn-oscuro">WhatsApp {TELEFONO}</a>
            <a href={`mailto:${CORREO}`} className="btn-borde">Escribir un correo</a>
          </div>
        </div>
      </section>
    </main>
  );
}
