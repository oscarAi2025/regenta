import Link from "next/link";
import { CabeceraPublica } from "./Cabecera";
import { Pie } from "./Pie";
import { BarraMovil } from "./BarraMovil";
import { BotonDemo } from "./BotonDemo";
import { Cumplimiento } from "./Cumplimiento";
import { PAGINAS, type Pagina } from "@/content/paginas";
import { SITIO } from "@/lib/sitio";

/** Página índice de un silo (/software o /para): enlaza a todas sus páginas con su promesa. */
export function IndiceSilo({ grupo, h1, entradilla, ruta }: { grupo: Pagina["grupo"]; h1: string; entradilla: string; ruta: string }) {
  const paginas = PAGINAS.filter((p) => p.grupo === grupo);
  const ld = [
    { "@context": "https://schema.org", "@type": "CollectionPage", name: h1, url: `${SITIO}${ruta}`, inLanguage: "es-CO",
      hasPart: paginas.map((p) => ({ "@type": "WebPage", name: p.titulo, url: `${SITIO}/${p.grupo}/${p.ruta}` })) },
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Regenta", item: `${SITIO}/` }, { "@type": "ListItem", position: 2, name: h1, item: `${SITIO}${ruta}` }] },
  ];
  return (
    <div className="bg-paper text-ink min-h-screen pb-20 sm:pb-0">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      <CabeceraPublica />
      <main>
        <section className="fondo-hero text-white relative overflow-hidden">
          <div className="rejilla absolute inset-0" aria-hidden="true" />
          <div className="relative max-w-6xl mx-auto px-4 sm:px-6 pt-10 pb-14">
            <nav aria-label="Ruta" className="text-sm text-white/60"><Link href="/" className="hover:underline">Regenta</Link> / {h1}</nav>
            <h1 className="mt-3 font-cond text-[42px] sm:text-[62px] leading-[0.95]" style={{ fontWeight: 700 }}>{h1}</h1>
            <p className="mt-4 text-lg text-white/75 max-w-2xl">{entradilla}</p>
            <div className="mt-7"><BotonDemo texto="Probar gratis ahora" className="btn-cta h-14 px-8 text-lg" /></div>
          </div>
        </section>
        <Cumplimiento />
        <section className="max-w-6xl mx-auto px-4 sm:px-6 py-14">
          <ul className="grid md:grid-cols-2 gap-4">
            {paginas.map((p, i) => (
              <li key={p.ruta}><Link href={`/${p.grupo}/${p.ruta}`} className={`tarjeta block h-full p-6 border-t-[6px] ${["border-t-teal-500", "border-t-sky-500", "border-t-amber-400", "border-t-violet-500"][i % 4]} hover:shadow-[0_24px_50px_-30px_rgba(16,42,67,.5)] transition`}>
                <p className="text-sm font-semibold text-teal-700">{p.corto}</p>
                <h2 className="mt-1 font-cond text-[28px] leading-tight" style={{ fontWeight: 700 }}>{p.h1}</h2>
                <p className="mt-2 text-muted leading-relaxed">{p.descripcion}</p>
                <p className="mt-3 font-semibold text-teal-700">Ver más</p>
              </Link></li>
            ))}
          </ul>
        </section>
      </main>
      <Pie />
      <BarraMovil />
    </div>
  );
}
