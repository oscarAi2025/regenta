import Link from "next/link";
import { CabeceraPublica } from "./Cabecera";
import { Pie } from "./Pie";
import { BarraMovil } from "./BarraMovil";
import { BotonDemo } from "./BotonDemo";
import { PAGINAS, type Pagina } from "@/content/paginas";
import { guia } from "@/content/guias";
import { SITIO, wa } from "@/lib/sitio";

/** Plantilla de las páginas por función y por perfil: promesa, captura, beneficios, cómo funciona, preguntas, guías y CTA. */
export function PaginaProducto({ p }: { p: Pagina }) {
  const url = `${SITIO}/${p.grupo}/${p.ruta}`;
  const ld = [
    { "@context": "https://schema.org", "@type": "WebPage", name: p.titulo, description: p.descripcion, url, inLanguage: "es-CO", about: { "@type": "SoftwareApplication", name: "Regenta", applicationCategory: "BusinessApplication", operatingSystem: "Web" } },
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Regenta", item: `${SITIO}/` },
      { "@type": "ListItem", position: 2, name: p.grupo === "funciones" ? "Funciones" : "Para quién", item: `${SITIO}/${p.grupo === "funciones" ? "funciones" : ""}` },
      { "@type": "ListItem", position: 3, name: p.corto, item: url }] },
    { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: p.preguntas.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) },
  ];
  const otras = PAGINAS.filter((x) => x.grupo === "funciones" && x.ruta !== p.ruta);
  return (
    <div className="bg-paper text-ink min-h-screen pb-20 sm:pb-0">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      <CabeceraPublica />
      <main>
        <section className="bg-ink text-white">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-10 pb-14 grid lg:grid-cols-[1fr_1.1fr] gap-10 items-center">
            <div>
              <nav aria-label="Ruta" className="text-sm text-white/60"><Link href="/" className="hover:underline">Regenta</Link> / {p.grupo === "funciones" ? <Link href="/funciones" className="hover:underline">Funciones</Link> : "Para quién"}</nav>
              <h1 className="font-cond text-[42px] sm:text-[60px] leading-[0.95] tracking-[-0.01em] mt-3" style={{ fontWeight: 700 }}>{p.h1}</h1>
              <p className="mt-5 text-lg text-white/75 leading-relaxed max-w-[34em]">{p.entradilla}</p>
              <div className="mt-7 flex flex-wrap gap-3">
                <BotonDemo texto="Probar la demo gratis" className="btn-primario h-14 px-7 text-lg" />
                <a href={wa(`Hola, quiero ver ${p.corto} de Regenta.`)} className="btn h-14 px-6 text-lg border-2 border-white/30 text-white hover:border-white">Hablar por WhatsApp</a>
              </div>
            </div>
            {p.captura && <img src={p.captura.src} alt={p.captura.alt} width={1440} height={900} className="rounded-2xl border-4 border-white/10 w-full h-auto shadow-2xl" />}
          </div>
        </section>
        <section className="max-w-6xl mx-auto px-4 sm:px-6 py-14 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          {p.beneficios.map(([t, d]) => <div key={t} className="tarjeta p-5"><h2 className="font-cond text-2xl leading-tight" style={{ fontWeight: 700 }}>{t}</h2><p className="mt-2 text-muted leading-relaxed">{d}</p></div>)}
        </section>
        {p.pasos && (
          <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-14">
            <h2 className="font-cond text-[34px] leading-none" style={{ fontWeight: 700 }}>Cómo funciona</h2>
            <ol className="mt-6 grid md:grid-cols-3 gap-6">
              {p.pasos.map((x, i) => <li key={x} className="flex gap-4"><span className="font-cond text-[52px] leading-[0.8] text-cruz num" style={{ fontWeight: 700 }} aria-hidden="true">{i + 1}</span><p className="text-lg">{x}</p></li>)}
            </ol>
          </section>
        )}
        <section className="max-w-3xl mx-auto px-4 sm:px-6 pb-14">
          <h2 className="font-cond text-[34px] leading-none" style={{ fontWeight: 700 }}>Preguntas</h2>
          <dl className="mt-5 grid gap-4">{p.preguntas.map(([q, a]) => <div key={q} className="tarjeta p-5"><dt className="font-semibold text-lg">{q}</dt><dd className="mt-1 text-muted leading-relaxed">{a}</dd></div>)}</dl>
        </section>
        {p.guias.length > 0 && (
          <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-14">
            <h2 className="font-cond text-[30px] leading-none" style={{ fontWeight: 700 }}>Guías relacionadas</h2>
            <ul className="mt-5 grid md:grid-cols-3 gap-3">{p.guias.map((s) => guia(s)).filter(Boolean).map((g) => <li key={g!.slug}><Link href={`/guias/${g!.slug}`} className="tarjeta block p-4 h-full hover:border-ink"><span className="font-semibold">{g!.h1}</span></Link></li>)}</ul>
          </section>
        )}
        <section className="bg-surface border-y border-line">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-12">
            <h2 className="font-cond text-[30px] leading-none" style={{ fontWeight: 700 }}>Más de Regenta</h2>
            <ul className="mt-5 flex flex-wrap gap-2">{otras.map((x) => <li key={x.ruta}><Link href={`/funciones/${x.ruta}`} className="btn-borde h-10 px-4">{x.corto}</Link></li>)}<li><Link href="/precios" className="btn-borde h-10 px-4">Precios</Link></li></ul>
          </div>
        </section>
        <section className="bg-ink text-white">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14 flex flex-wrap items-center justify-between gap-6">
            <p className="font-cond text-[34px] sm:text-[44px] leading-[1] max-w-[16em]" style={{ fontWeight: 700 }}>Míralo funcionando ahora, con datos de 8 semanas.</p>
            <BotonDemo texto="Probar la demo gratis" className="btn-primario h-14 px-7 text-lg" />
          </div>
        </section>
      </main>
      <Pie />
      <BarraMovil />
    </div>
  );
}
