import type { Metadata } from "next";
import Link from "next/link";
import { CabeceraPublica } from "@/components/landing/Cabecera";
import { Pie } from "@/components/landing/Pie";
import { BarraMovil } from "@/components/landing/BarraMovil";
import { BotonDemo } from "@/components/landing/BotonDemo";
import { PLANES, DOC_EXTRA, NOTA_PRECIOS, SOCIO } from "@/lib/planes";
import { pesos } from "@/lib/formato";
import { SITIO, wa } from "@/lib/sitio";

export const metadata: Metadata = {
  title: { absolute: "Precios de Regenta: software para droguerías desde $89.900" },
  description: "Planes de Regenta para droguerías: Esencial, Pro y Cadena, con IA, alertas INVIMA y lotes incluidos. Con el Plan Socio Farmagenéricos, gratis.",
  alternates: { canonical: "/precios" }, robots: { index: true, follow: true },
};

const FILAS: [string, string, string, string][] = [
  ["Cajas", "1", "Hasta 3", "Por sede"],
  ["Usuarios", "Hasta 3", "Ilimitados", "Ilimitados"],
  ["Documentos electrónicos al mes", "2.000", "5.000", "Según volumen"],
  ["Regenta IA y prioridades del día", "Sí", "Sí", "Sí"],
  ["Pedido sugerido y riesgo de vencimiento", "Sí", "Sí", "Sí"],
  ["Alertas INVIMA cruzadas con el inventario", "Sí", "Sí", "Sí"],
  ["Lotes, FEFO y bloqueo de vencidos", "Sí", "Sí", "Sí"],
  ["Carga de productos", "Desde Excel", "Te la hacemos", "Te la hacemos"],
  ["Soporte", "WhatsApp", "WhatsApp prioritario", "Acompañamiento"],
];

const PREGUNTAS: [string, string][] = [
  ["¿Hay costo de instalación?", "No. Funciona en el navegador y la carga de productos desde Excel está incluida."],
  ["¿Qué pasa si paso de los documentos del plan?", `Cada documento adicional cuesta ${pesos(DOC_EXTRA)}. Te avisamos antes de llegar al tope.`],
  ["¿Cómo funciona el Plan Socio?", `${SOCIO.resumen} ${SOCIO.nota}`],
  ["¿Puedo cancelar?", "Sí, el plan es mensual. Si pagas el año, tienes 2 meses gratis."],
];

export default function Precios() {
  const ld = { "@context": "https://schema.org", "@type": "Product", name: "Regenta", description: "Software para droguerías con IA, alertas INVIMA y control de lotes.", brand: { "@type": "Brand", name: "Regenta" },
    offers: PLANES.filter((p) => p.precio).map((p) => ({ "@type": "Offer", name: p.nombre, price: p.precio, priceCurrency: "COP", url: `${SITIO}/precios` })) };
  return (
    <div className="bg-paper text-ink min-h-screen pb-20 sm:pb-0">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify([ld, { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: PREGUNTAS.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) }]) }} />
      <CabeceraPublica />
      <main>
        <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-10 pb-12">
          <h1 className="font-cond text-[44px] sm:text-[68px] leading-[0.95]" style={{ fontWeight: 700 }}>Precios claros. O gratis con el Plan Socio.</h1>
          <p className="mt-4 text-lg text-muted max-w-2xl">Todo incluido: inteligencia artificial, predicción, alertas INVIMA, lotes y carga desde Excel. Sin costo de instalación.</p>
          <div className="mt-10 grid md:grid-cols-3 gap-5 items-stretch">
            {PLANES.map((p) => (
              <div key={p.id} className={`rounded-2xl p-6 flex flex-col ${p.destacado ? "bg-ink text-white ring-4 ring-cruz" : "tarjeta"}`}>
                {p.destacado && <p className="text-sm font-semibold text-marca">Recomendado</p>}
                <h2 className="font-cond text-[30px] mt-1" style={{ fontWeight: 700 }}>{p.nombre}</h2>
                <p className={p.destacado ? "text-white/70" : "text-muted"}>{p.para}</p>
                <p className="mt-4 font-cond text-[46px] leading-none num" style={{ fontWeight: 700 }}>{p.precio ? pesos(p.precio) : "A tu medida"}{p.precio && <span className="text-base font-sans font-normal opacity-70"> /mes</span>}</p>
                <ul className={`mt-5 grid gap-2 flex-1 ${p.destacado ? "text-white/85" : ""}`}>{p.incluye.map((x) => <li key={x} className="flex gap-2"><span className="text-cruz font-bold" aria-hidden="true">✓</span>{x}</li>)}</ul>
                {p.precio ? <div className="mt-6 grid"><BotonDemo texto="Probar la demo gratis" className={`h-12 ${p.destacado ? "btn-primario" : "btn-borde"}`} /></div>
                  : <a href={wa("Hola, quiero una cotización de Regenta para varias sedes.")} className="mt-6 h-12 btn-borde">Pedir cotización</a>}
              </div>
            ))}
          </div>
          <p className="mt-5 text-sm text-muted max-w-3xl">{NOTA_PRECIOS} Documento adicional: {pesos(DOC_EXTRA)}.</p>
        </section>

        <section id="socio" className="bg-ink text-white scroll-mt-20">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14 grid lg:grid-cols-[1fr_1fr] gap-10 items-center">
            <div>
              <h2 className="font-cond text-[40px] sm:text-[54px] leading-[0.95]" style={{ fontWeight: 700 }}>{SOCIO.nombre}</h2>
              <p className="mt-4 text-lg text-white/80">{SOCIO.resumen} Somos distribuidor farmacéutico: si nos compras, tu software corre por nuestra cuenta.</p>
              <p className="mt-3 text-sm text-white/55">{SOCIO.nota}</p>
              <a href={wa("Hola, quiero el Plan Socio Farmagenéricos para mi droguería.")} className="btn-primario h-12 px-6 mt-6">Quiero el Plan Socio</a>
            </div>
            <ul className="grid gap-3">
              {SOCIO.escalones.map((e) => (
                <li key={e.desde} className="rounded-2xl bg-white/10 p-5 flex items-center justify-between gap-4">
                  <span className="text-white/75">Compras desde <b className="text-white num">{pesos(e.desde)}</b> al mes</span><span className="font-semibold text-marca text-right">{e.beneficio}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="max-w-5xl mx-auto px-4 sm:px-6 py-14">
          <h2 className="font-cond text-[36px] leading-none" style={{ fontWeight: 700 }}>Qué trae cada plan</h2>
          <div className="mt-6 tarjeta overflow-x-auto">
            <table className="w-full min-w-[620px]">
              <thead><tr className="border-b border-line text-left"><th className="p-4"></th>{PLANES.map((p) => <th key={p.id} className="p-4 font-cond text-xl" style={{ fontWeight: 700 }}>{p.nombre}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">{FILAS.map(([t, ...v]) => <tr key={t}><td className="p-4 font-semibold">{t}</td>{v.map((x, i) => <td key={i} className="p-4">{x}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </section>

        <section className="max-w-3xl mx-auto px-4 sm:px-6 pb-16">
          <h2 className="font-cond text-[36px] leading-none" style={{ fontWeight: 700 }}>Preguntas sobre precios</h2>
          <dl className="mt-5 grid gap-4">{PREGUNTAS.map(([q, a]) => <div key={q} className="tarjeta p-5"><dt className="font-semibold text-lg">{q}</dt><dd className="mt-1 text-muted leading-relaxed">{a}</dd></div>)}</dl>
          <p className="mt-6"><Link href="/guias/cuanto-cuesta-software-drogueria" className="font-semibold text-cruz underline underline-offset-4">¿Cuánto cuesta un software para droguería en Colombia? Comparativa con fuentes</Link></p>
        </section>
      </main>
      <Pie />
      <BarraMovil />
    </div>
  );
}
