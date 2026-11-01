import { BotonDemo } from "@/components/landing/BotonDemo";
import Link from "next/link";
import { Isotipo } from "@/components/Marca";
import { GUIAS } from "@/content/guias";
import { CORREO, TELEFONO, wa } from "@/lib/sitio";

export function Pie() {
  return (
    <footer className="bg-ink text-white/75">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 grid md:grid-cols-[1.2fr_1fr_1fr] gap-8 text-sm">
        <div>
          <p className="inline-flex items-center gap-2 text-white font-semibold"><Isotipo size={26} claro /> Regenta by Farmagenéricos Colombia</p>
          <p className="mt-3 max-w-xs">Software de caja, inventario por lote e inteligencia artificial para droguerías de Colombia, hecho por un distribuidor farmacéutico.</p>
          <ul className="mt-4 grid gap-1.5">
            <li><Link href="/funciones" className="hover:text-white hover:underline">Funciones</Link></li>
            <li><Link href="/precios" className="hover:text-white hover:underline">Precios y Plan Socio</Link></li>
            <li><Link href="/por-que-regenta" className="hover:text-white hover:underline">Por qué Regenta</Link></li>
            <li><Link href="/para/regentes" className="hover:text-white hover:underline">Para regentes</Link></li>
            <li><Link href="/para/duenos-de-drogueria" className="hover:text-white hover:underline">Para dueños</Link></li>
          </ul>
        </div>
        <div>
          <p className="text-white font-semibold"><Link href="/guias" className="hover:underline">Guías para regentes</Link></p>
          <ul className="mt-3 grid gap-1.5">{GUIAS.slice(0, 9).map((g) => <li key={g.slug}><Link href={`/guias/${g.slug}`} className="hover:text-white hover:underline">{g.h1}</Link></li>)}</ul>
        </div>
        <div>
          <p className="text-white font-semibold">Contacto</p>
          <ul className="mt-3 grid gap-1.5">
            <li><a href={wa("Hola, quiero conocer Regenta.")} className="hover:text-white hover:underline">WhatsApp {TELEFONO}</a></li>
            <li><a href={`mailto:${CORREO}`} className="hover:text-white hover:underline">{CORREO}</a></li>
            <li><BotonDemo texto="Probar la demo" className="hover:text-white hover:underline" /></li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
