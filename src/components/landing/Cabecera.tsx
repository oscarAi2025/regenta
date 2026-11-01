import Link from "next/link";
import { Marca } from "@/components/Marca";
import { wa } from "@/lib/sitio";

/** Barra superior de las páginas públicas: marca, guías y las dos acciones de siempre. */
export function CabeceraPublica() {
  return (
    <header className="sticky top-0 z-30 bg-paper/95 backdrop-blur border-b border-line/70">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between gap-3">
        <Link href="/" aria-label="Regenta, inicio"><Marca /></Link>
        <nav className="flex items-center gap-2 sm:gap-4 text-[15px]" aria-label="Página">
          <Link href="/#precios" className="hidden md:inline font-medium hover:underline">Precios</Link>
          <Link href="/guias" className="hidden md:inline font-medium hover:underline">Guías</Link>
          <a href={wa("Hola, quiero conocer Regenta para mi droguería.")} className="hidden sm:inline font-semibold hover:underline">WhatsApp</a>
          <a href="/demo" className="btn-primario h-10 px-4 whitespace-nowrap">Probar la demo</a>
        </nav>
      </div>
    </header>
  );
}
