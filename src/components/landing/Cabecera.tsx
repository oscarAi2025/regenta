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
      <div className="max-w-6xl mx-auto px-3 min-[360px]:px-4 sm:px-6 h-[76px] flex items-center justify-between gap-2 min-[360px]:gap-3">
        <Link href="/" aria-label="Regenta, inicio" className="shrink-0"><Marca /></Link>
        <nav className="flex items-center gap-2 sm:gap-4 text-[15px]" aria-label="Página">
          <Link href="/software" className="hidden xl:inline font-medium hover:text-teal-700">Software</Link>
          <Link href="/software/distribuidoras-medicamentos" className="hidden xl:inline font-medium hover:text-teal-700">Distribuidoras</Link>
          <Link href="/funciones" className="hidden lg:inline font-medium hover:text-teal-700">Funciones</Link>
          <Link href="/precios" className="hidden md:inline font-medium hover:text-teal-700">Tarifas</Link>
          <Link href="/guias" className="hidden lg:inline font-medium hover:text-teal-700">Guías</Link>
          <a href={wa("Hola, quiero conocer Regenta para mi droguería o distribuidora.")} className="hidden md:inline font-semibold text-teal-700 hover:underline">WhatsApp</a>
          {/* En pantallas donde no caben los enlaces: menú desplegable (sin JavaScript), para llegar a Tarifas y lo demás. */}
          <details className="xl:hidden group">
            <summary className="list-none [&::-webkit-details-marker]:hidden cursor-pointer h-11 px-2.5 min-[360px]:px-3 inline-flex items-center gap-1.5 rounded-xl border border-line font-semibold hover:border-ink" aria-label="Menú">
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" /></svg>
              <span className="hidden sm:inline">Menú</span>
            </summary>
            <div className="absolute right-3 sm:right-6 top-full mt-1 w-[min(15rem,calc(100vw-1.5rem))] rounded-2xl border border-line bg-white shadow-xl p-2 grid">
              {([["/precios", "Tarifas"], ["/funciones", "Funciones"], ["/software", "Software"], ["/software/distribuidoras-medicamentos", "Distribuidoras"], ["/guias", "Guías"], ["/entrar", "Entrar a mi cuenta"]] as const).map(([h, t]) => (
                <Link key={h} href={h} className="h-11 px-3 rounded-lg flex items-center font-medium hover:bg-paper">{t}</Link>
              ))}
              <a href={wa("Hola, quiero conocer Regenta para mi droguería o distribuidora.")} className="h-11 px-3 rounded-lg flex items-center font-semibold text-teal-700 hover:bg-paper">WhatsApp</a>
            </div>
          </details>
          {/* En celulares angostos el botón dice solo «Probar»: con el menú, todo cabe en 320 px sin correrse de lado. */}
          <BotonDemo texto={<><span className="sm:hidden">Probar</span><span className="hidden sm:inline">Probar gratis</span></>} className="btn-cta h-11 px-3 min-[360px]:px-5 whitespace-nowrap" />
        </nav>
      </div>
    </header>
    </>
  );
}
