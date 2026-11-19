import Link from "next/link";
import { Cabecera } from "@/components/ui/Cabecera";

// Control especial va en los planes superiores (Pro, Cadena y Socio). En Esencial, cada página del módulo devuelve esto
// ANTES de leer datos (un layout no basta: Next arma la página en paralelo y sus datos irían en la respuesta).
// La venta con fórmula en la caja sigue funcionando igual en todos los planes.
export function InvitacionPro({ dueno }: { dueno: boolean }) {
  return (
    <main className="px-4 sm:px-6 py-6 max-w-3xl">
      <Cabecera titulo="Control especial" sub="Disponible en los planes Pro y Cadena" />
      <section className="mt-6 rounded-2xl border border-line bg-surface p-6" aria-labelledby="pro-titulo">
        <h2 id="pro-titulo" className="text-lg font-semibold">Lleva el control especial sin papeles</h2>
        <ul className="mt-3 grid gap-2 text-[15px] list-disc pl-5">
          <li>Libro de control especial que se llena solo con cada venta y no se puede borrar ni editar.</li>
          <li>Informe mensual (Anexo 13) al Fondo Rotatorio de tu departamento, en Excel o para imprimir, también en ceros.</li>
          <li>Aviso por correo en los primeros 10 días de cada mes hasta que lo marques como presentado.</li>
          <li>Ficha de cada medicamento (principio activo, concentración, CUM) y la plantilla de tu fondo.</li>
        </ul>
        <p className="mt-4 text-sm text-muted">Tu plan actual es Esencial: la caja ya pide y guarda la fórmula de los medicamentos de control especial; el libro y el informe mensual vienen con Pro.</p>
        <div className="mt-5 flex flex-wrap gap-2">
          {dueno ? (
            <Link href="/contratar?plan=pro" className="btn-primario h-11 inline-flex items-center">Pasarme a Pro</Link>
          ) : (
            <p className="text-sm">Pídele al dueño de la droguería que cambie a Pro en Mi droguería.</p>
          )}
          <Link href="/inicio" className="btn-borde h-11 inline-flex items-center">Volver al inicio</Link>
        </div>
      </section>
    </main>
  );
}
