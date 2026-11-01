import Link from "next/link";
import { Isotipo } from "@/components/Marca";
import { GUIAS } from "@/content/guias";
import { CORREO, TELEFONO, wa } from "@/lib/sitio";

export function Pie() {
  return (
    <footer className="bg-ink text-white/75">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 grid md:grid-cols-[1.2fr_1fr_1fr] gap-8 text-sm">
        <div>
          <p className="inline-flex items-center gap-2 text-white font-semibold"><Isotipo size={26} /> Regenta by Farmagenéricos Colombia</p>
          <p className="mt-3 max-w-xs">Programa de caja, inventario por lote y predicción para droguerías de Colombia.</p>
        </div>
        <div>
          <p className="text-white font-semibold">Guías para regentes</p>
          <ul className="mt-3 grid gap-1.5">{GUIAS.map((g) => <li key={g.slug}><Link href={`/guias/${g.slug}`} className="hover:text-white hover:underline">{g.h1}</Link></li>)}</ul>
        </div>
        <div>
          <p className="text-white font-semibold">Contacto</p>
          <ul className="mt-3 grid gap-1.5">
            <li><a href={wa("Hola, quiero conocer Regenta.")} className="hover:text-white hover:underline">WhatsApp {TELEFONO}</a></li>
            <li><a href={`mailto:${CORREO}`} className="hover:text-white hover:underline">{CORREO}</a></li>
            <li><a href="/demo" className="hover:text-white hover:underline">Probar la demo</a></li>
          </ul>
        </div>
      </div>
    </footer>
  );
}
