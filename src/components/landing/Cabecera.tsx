import { BotonDemo } from "@/components/landing/BotonDemo";
import Link from "next/link";
import { Marca } from "@/components/Marca";
import { wa } from "@/lib/sitio";

/** Barra superior de las páginas públicas: marca con lo que es, a quién sirve y las dos acciones de siempre. */
export function CabeceraPublica() {
  return (
    <>
    <Link href="/funciones/regenta-ia" className="block degradado-marca text-white text-center text-sm font-semibold py-2 px-4 hover:brightness-110">
      <span className="text-amber-300" aria-hidden="true">✦ </span><span className="sm:hidden">Nuevo: Regenta IA. Pruébala gratis</span><span className="hidden sm:inline">Nuevo: Regenta IA te dice qué pedir, qué se vence y qué vender primero. Pruébala gratis.</span>
    </Link>
    <header className="sticky top-0 z-30 bg-white/90 backdrop-blur border-b border-line/70">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-[76px] flex items-center justify-between gap-3">
        <Link href="/" aria-label="Regenta, inicio" className="shrink-0"><Marca /></Link>
        <nav className="flex items-center gap-2 sm:gap-4 text-[15px]" aria-label="Página">
          <Link href="/software" className="hidden xl:inline font-medium hover:text-teal-700">Software</Link>
          <Link href="/software/distribuidoras-medicamentos" className="hidden xl:inline font-medium hover:text-teal-700">Distribuidoras</Link>
          <Link href="/funciones" className="hidden lg:inline font-medium hover:text-teal-700">Funciones</Link>
          <Link href="/precios" className="hidden md:inline font-medium hover:text-teal-700">Tarifas</Link>
          <Link href="/guias" className="hidden lg:inline font-medium hover:text-teal-700">Guías</Link>
          <a href={wa("Hola, quiero conocer Regenta para mi droguería o distribuidora.")} className="hidden md:inline font-semibold text-teal-700 hover:underline">WhatsApp</a>
          <BotonDemo texto="Probar gratis" className="btn-cta h-11 px-5 whitespace-nowrap" />
        </nav>
      </div>
    </header>
    </>
  );
}
