import { BotonDemo } from "@/components/landing/BotonDemo";
import Link from "next/link";
import { Marca } from "@/components/Marca";
import { GUIAS } from "@/content/guias";
import { CORREO, TELEFONO, wa } from "@/lib/sitio";

export function Pie() {
  return (
    <footer className="bg-ink text-white/75">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 grid md:grid-cols-[1.2fr_1fr_1fr] gap-8 text-sm">
        <div>
          <Marca claro />
          <p className="mt-3 max-w-xs">Software de facturación electrónica y gestión para droguerías, farmacias y distribuidoras farmacéuticas de Colombia, hecho por un distribuidor del sector.</p>
          <ul className="mt-4 grid gap-1.5">
            <li><Link href="/funciones" className="inline-block py-1.5 sm:py-0.5 hover:text-white hover:underline">Funciones</Link></li>
            <li><Link href="/precios" className="inline-block py-1.5 sm:py-0.5 hover:text-white hover:underline">Tarifas y Plan Socio</Link></li>
            <li><Link href="/por-que-regenta" className="inline-block py-1.5 sm:py-0.5 hover:text-white hover:underline">Por qué Regenta</Link></li>
            <li><Link href="/contratar" className="inline-block py-1.5 sm:py-0.5 hover:text-white hover:underline">Contratar en línea</Link></li>
            <li><Link href="/privacidad" className="inline-block py-1.5 sm:py-0.5 hover:text-white hover:underline">Política de datos</Link></li>
            <li><Link href="/terminos" className="inline-block py-1.5 sm:py-0.5 hover:text-white hover:underline">Términos y condiciones</Link></li>
            <li><Link href="/funciones/facturacion-electronica" className="inline-block py-1.5 sm:py-0.5 hover:text-white hover:underline">Facturación electrónica</Link></li>
            <li><Link href="/software" className="inline-block py-1.5 sm:py-0.5 hover:text-white hover:underline">Software para el sector farmacéutico</Link></li>
            <li><Link href="/software/facturacion-electronica-droguerias" className="inline-block py-1.5 sm:py-0.5 hover:text-white hover:underline">Facturación electrónica para droguerías</Link></li>
            <li><Link href="/software/distribuidoras-medicamentos" className="inline-block py-1.5 sm:py-0.5 hover:text-white hover:underline">Software para distribuidoras de medicamentos</Link></li>
            <li><Link href="/software/facturacion-electronica-sector-salud" className="inline-block py-1.5 sm:py-0.5 hover:text-white hover:underline">Facturación para el sector salud</Link></li>
            <li><Link href="/software/pos-drogueria" className="inline-block py-1.5 sm:py-0.5 hover:text-white hover:underline">POS para droguería</Link></li>
            <li><Link href="/software/farmacias" className="inline-block py-1.5 sm:py-0.5 hover:text-white hover:underline">Software para farmacias</Link></li>
            <li><Link href="/software/inventario-farmacia" className="inline-block py-1.5 sm:py-0.5 hover:text-white hover:underline">Inventario de farmacia</Link></li>
            <li><Link href="/para" className="inline-block py-1.5 sm:py-0.5 hover:text-white hover:underline">¿Para quién es Regenta?</Link></li>
            <li><Link href="/para/regentes" className="inline-block py-1.5 sm:py-0.5 hover:text-white hover:underline">Para regentes</Link></li>
            <li><Link href="/para/duenos-de-drogueria" className="inline-block py-1.5 sm:py-0.5 hover:text-white hover:underline">Para dueños</Link></li>
          </ul>
        </div>
        <div>
          <p className="text-white font-semibold"><Link href="/guias" className="hover:underline">Guías para regentes</Link></p>
          <ul className="mt-3 grid gap-1.5">{GUIAS.slice(0, 9).map((g) => <li key={g.slug}><Link href={`/guias/${g.slug}`} className="inline-block py-1.5 sm:py-0.5 hover:text-white hover:underline">{g.h1}</Link></li>)}</ul>
        </div>
        <div>
          <p className="text-white font-semibold">Contacto</p>
          <ul className="mt-3 grid gap-1.5">
            <li><a href={wa("Hola, quiero conocer Regenta.")} className="inline-block py-1.5 sm:py-0.5 hover:text-white hover:underline">WhatsApp {TELEFONO}</a></li>
            <li><a href={`mailto:${CORREO}`} className="inline-block py-1.5 sm:py-0.5 hover:text-white hover:underline">{CORREO}</a></li>
            <li><BotonDemo texto="Probar la demo" className="inline-block py-1.5 sm:py-0.5 hover:text-white hover:underline" /></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10">
        <p className="max-w-6xl mx-auto px-4 sm:px-6 py-5 text-xs text-white/50">Regenta es un producto de Farmagenéricos Colombia, establecimiento de IA DEV INVESTIMENTS COLOMBIA S.A.S., NIT 901.845.370-5, Ibagué, Tolima.</p>
      </div>
    </footer>
  );
}
