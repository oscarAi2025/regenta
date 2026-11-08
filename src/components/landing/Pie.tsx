import { BotonDemo } from "@/components/landing/BotonDemo";
import Link from "next/link";
import { Marca } from "@/components/Marca";
import { GUIAS } from "@/content/guias";
import { CORREO, LINKEDIN, TELEFONO, wa } from "@/lib/sitio";

/** Enlaces del pie: 44 px de alto en pantallas táctiles (celular, tableta, horizontal o vertical); 32 px con ratón. */
const ENLACE = "inline-flex items-center min-h-11 [@media(pointer:fine)]:min-h-8 hover:text-white hover:underline";

export function Pie() {
  return (
    <footer className="bg-ink text-white/75">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12 grid md:grid-cols-[1.2fr_1fr_1fr] gap-8 text-sm">
        <div>
          <Marca claro />
          <p className="mt-3 max-w-xs">Software de facturación electrónica y gestión para droguerías, farmacias y distribuidoras farmacéuticas de Colombia, hecho por un distribuidor del sector.</p>
          <ul className="mt-4 grid gap-1.5">
            <li><Link href="/funciones" className={ENLACE}>Funciones</Link></li>
            <li><Link href="/precios" className={ENLACE}>Tarifas y Plan Socio</Link></li>
            <li><Link href="/por-que-regenta" className={ENLACE}>Por qué Regenta</Link></li>
            <li><Link href="/contratar" className={ENLACE}>Contratar en línea</Link></li>
            <li><Link href="/privacidad" className={ENLACE}>Política de datos</Link></li>
            <li><Link href="/terminos" className={ENLACE}>Términos y condiciones</Link></li>
            <li><Link href="/funciones/facturacion-electronica" className={ENLACE}>Facturación electrónica</Link></li>
            <li><Link href="/software" className={ENLACE}>Software para el sector farmacéutico</Link></li>
            <li><Link href="/software/facturacion-electronica-droguerias" className={ENLACE}>Facturación electrónica para droguerías</Link></li>
            <li><Link href="/software/distribuidoras-medicamentos" className={ENLACE}>Software para distribuidoras de medicamentos</Link></li>
            <li><Link href="/software/facturacion-electronica-sector-salud" className={ENLACE}>Facturación para el sector salud</Link></li>
            <li><Link href="/software/pos-drogueria" className={ENLACE}>POS para droguería</Link></li>
            <li><Link href="/software/farmacias" className={ENLACE}>Software para farmacias</Link></li>
            <li><Link href="/software/inventario-farmacia" className={ENLACE}>Inventario de farmacia</Link></li>
            <li><Link href="/para" className={ENLACE}>¿Para quién es Regenta?</Link></li>
            <li><Link href="/para/regentes" className={ENLACE}>Para regentes</Link></li>
            <li><Link href="/para/duenos-de-drogueria" className={ENLACE}>Para dueños</Link></li>
          </ul>
        </div>
        <div>
          <p className="text-white font-semibold"><Link href="/guias" className="inline-flex items-center min-h-11 [@media(pointer:fine)]:min-h-0 hover:underline">Guías para regentes</Link></p>
          <ul className="mt-3 grid gap-1.5">{GUIAS.slice(0, 9).map((g) => <li key={g.slug}><Link href={`/guias/${g.slug}`} className={ENLACE}>{g.h1}</Link></li>)}</ul>
        </div>
        <div>
          <p className="text-white font-semibold">Contacto</p>
          <ul className="mt-3 grid gap-1.5">
            <li><a href={wa("Hola, quiero conocer Regenta.")} className={ENLACE}>WhatsApp {TELEFONO}</a></li>
            <li><a href={`mailto:${CORREO}`} className={ENLACE}>{CORREO}</a></li>
            <li><a href={LINKEDIN} target="_blank" rel="me noopener" aria-label="Regenta en LinkedIn (se abre en otra pestaña)" className={`${ENLACE} gap-2`}><svg aria-hidden="true" viewBox="0 0 24 24" className="h-4 w-4 fill-current"><path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.64-1.85 3.37-1.85 3.6 0 4.27 2.37 4.27 5.46v6.28zM5.34 7.43a2.06 2.06 0 1 1 0-4.13 2.06 2.06 0 0 1 0 4.13zM7.12 20.45H3.56V9h3.56v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.73v20.54C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.73C24 .77 23.2 0 22.22 0z"/></svg>Síguenos en LinkedIn</a></li>
            <li><BotonDemo texto="Probar la demo" className={ENLACE} /></li>
          </ul>
        </div>
      </div>
      <div className="border-t border-white/10">
        <p className="max-w-6xl mx-auto px-4 sm:px-6 py-5 text-xs text-white/50">Regenta es un producto de Farmagenéricos Colombia, establecimiento de IA DEV INVESTIMENTS COLOMBIA S.A.S., NIT 901.845.370-5, Ibagué, Tolima.</p>
      </div>
    </footer>
  );
}
