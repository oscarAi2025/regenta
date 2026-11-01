import { BotonDemo } from "@/components/landing/BotonDemo";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { GUIAS, guia } from "@/content/guias";
import { CabeceraPublica } from "@/components/landing/Cabecera";
import { Pie } from "@/components/landing/Pie";
import { BarraMovil } from "@/components/landing/BarraMovil";
import { SITIO, wa } from "@/lib/sitio";

export const dynamicParams = false;
export function generateStaticParams() { return GUIAS.map((g) => ({ slug: g.slug })); }

export async function generateMetadata({ params }: { params: Promise<{ slug: string }> }): Promise<Metadata> {
  const g = guia((await params).slug);
  if (!g) return {};
  return { title: { absolute: g.titulo }, description: g.descripcion, alternates: { canonical: `/guias/${g.slug}` }, robots: { index: true, follow: true },
    openGraph: { type: "article", locale: "es_CO", siteName: "Regenta", title: g.titulo, description: g.descripcion, url: `/guias/${g.slug}`, images: [{ url: "/capturas/og.png", width: 1200, height: 630 }], modifiedTime: g.actualizada } };
}

const fecha = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric" });

export default async function PaginaGuia({ params }: { params: Promise<{ slug: string }> }) {
  const g = guia((await params).slug);
  if (!g) notFound();
  const url = `${SITIO}/guias/${g.slug}`;
  const ld = [
    { "@context": "https://schema.org", "@type": "Article", headline: g.h1, description: g.descripcion, inLanguage: "es-CO", datePublished: g.actualizada, dateModified: g.actualizada, mainEntityOfPage: url,
      author: { "@type": "Organization", name: "Farmagenéricos Colombia" }, publisher: { "@type": "Organization", name: "Farmagenéricos Colombia" }, image: `${SITIO}/capturas/og.png` },
    { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: [
      { "@type": "ListItem", position: 1, name: "Regenta", item: `${SITIO}/` }, { "@type": "ListItem", position: 2, name: "Guías", item: `${SITIO}/guias` }, { "@type": "ListItem", position: 3, name: g.h1, item: url }] },
    { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: g.preguntas.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) },
  ];
  const mitad = Math.ceil(g.bloques.length / 2);
  return (
    <div className="bg-paper text-ink min-h-screen">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      <CabeceraPublica />
      <main className="max-w-3xl mx-auto px-4 sm:px-6 pt-8 pb-16">
        <nav aria-label="Ruta" className="text-sm text-muted"><Link href="/" className="hover:underline">Regenta</Link> / <Link href="/guias" className="hover:underline">Guías</Link></nav>
        <h1 className="font-cond text-[38px] sm:text-[54px] leading-[1] tracking-[-0.01em] mt-3" style={{ fontWeight: 700 }}>{g.h1}</h1>
        <p className="mt-3 text-sm text-muted">Actualizada el {fecha(g.actualizada)} · Farmagenéricos Colombia</p>
        <p className="mt-6 text-xl leading-relaxed">{g.entradilla}</p>
        <article className="mt-8 grid gap-8 text-[17px] leading-relaxed">
          {g.bloques.map((b, i) => (
            <section key={b.h2}>
              <h2 className="font-cond text-[28px] leading-tight" style={{ fontWeight: 700 }}>{b.h2}</h2>
              {b.p?.map((t) => <p key={t} className="mt-3">{t}</p>)}
              {b.lista && <ul className="mt-3 grid gap-2 list-disc pl-5">{b.lista.map((t) => <li key={t}>{t}</li>)}</ul>}
              {b.pasos && <ol className="mt-3 grid gap-2 list-decimal pl-5">{b.pasos.map((t) => <li key={t}>{t}</li>)}</ol>}
              {b.nota && <p className="mt-3 rounded-xl bg-aviso-soft text-aviso px-4 py-3 text-[15px]">{b.nota}</p>}
              {i === mitad - 1 && (
                <aside className="mt-8 rounded-2xl bg-ink text-white p-6">
                  <p className="font-cond text-2xl" style={{ fontWeight: 700 }}>{g.cta.titulo}</p>
                  <p className="mt-2 text-white/80">{g.cta.texto}</p>
                  <div className="mt-4 flex flex-wrap gap-2"><BotonDemo className="btn-primario" /><a href={wa(`Hola, leí la guía «${g.h1}» y quiero conocer Regenta.`)} className="btn border-2 border-white/30 text-white">Escribir por WhatsApp</a></div>
                </aside>
              )}
            </section>
          ))}
          <section>
            <h2 className="font-cond text-[28px] leading-tight" style={{ fontWeight: 700 }}>Preguntas frecuentes</h2>
            <dl className="mt-3 grid gap-4">{g.preguntas.map(([q, a]) => <div key={q}><dt className="font-semibold">{q}</dt><dd className="mt-1">{a}</dd></div>)}</dl>
          </section>
          <section className="border-t border-line pt-6">
            <h2 className="font-semibold text-lg">Fuentes</h2>
            <ul className="mt-2 grid gap-1.5 text-[15px]">{g.fuentes.map(([t, u]) => <li key={u}><a href={u} target="_blank" rel="noopener" className="text-cruz underline">{t}</a></li>)}</ul>
            <p className="mt-3 text-sm text-muted">Esta guía es informativa y no reemplaza la asesoría de tu contador o de tu secretaría de salud.</p>
          </section>
        </article>
        <section className="mt-12">
          <h2 className="font-cond text-2xl" style={{ fontWeight: 700 }}>Sigue leyendo</h2>
          <ul className="mt-3 grid sm:grid-cols-2 gap-3">
            {g.relacionadas.map((s) => guia(s)!).map((r) => <li key={r.slug}><Link href={`/guias/${r.slug}`} className="tarjeta block p-4 hover:border-ink"><span className="font-semibold">{r.h1}</span><span className="block text-sm text-muted mt-1">{r.descripcion}</span></Link></li>)}
          </ul>
          <p className="mt-6"><Link href="/" className="font-semibold text-cruz underline">Software de facturación y gestión para droguerías y distribuidoras</Link></p>
        </section>
      </main>
      <Pie />
      <BarraMovil />
    </div>
  );
}
