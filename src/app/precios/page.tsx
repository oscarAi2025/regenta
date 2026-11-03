import type { Metadata } from "next";
import { metaPublica } from "@/lib/seo";
import Link from "next/link";
import { Cambiate } from "@/components/landing/Cambiate";
import { CabeceraPublica } from "@/components/landing/Cabecera";
import { Pie } from "@/components/landing/Pie";
import { BarraMovil } from "@/components/landing/BarraMovil";
import { BotonDemo } from "@/components/landing/BotonDemo";
import { CalculadoraSocio } from "@/components/landing/CalculadoraSocio";
import { IncluyeTodo } from "@/components/landing/IncluyeTodo";
import { Cumplimiento } from "@/components/landing/Cumplimiento";
import { Oferta } from "@/components/landing/Oferta";
import { BarraOferta } from "@/components/landing/BarraOferta";
import { mesAnual, PLANES, DOC_EXTRA, NOTA_PRECIOS, SOCIO } from "@/lib/planes";
import { pesos } from "@/lib/formato";
import { SITIO, wa } from "@/lib/sitio";

export const metadata: Metadata = metaPublica("/precios", "Precio de software para droguería: desde $89.900/mes", "Cuánto cuesta Regenta: Esencial $89.900 y Pro $139.900 al mes, certificado digital incluido. Como socio de Farmagenéricos Colombia, a mitad de precio o gratis.");

const esencial = PLANES.find((p) => p.id === "esencial")!, pro = PLANES.find((p) => p.id === "pro")!;
const precio = (n: number) => (n === 0 ? "Gratis" : pesos(n));

const FILAS: [string, string, string, string][] = [
  ["Cajas", "1", "Hasta 3", "Por sede"],
  ["Usuarios", "Hasta 3", "Ilimitados", "Ilimitados"],
  ["Documentos electrónicos al mes", "2.000", "5.000", "Según volumen"],
  ["Tiquete POS y factura electrónica con cliente", "Sí", "Sí", "Sí"],
  ["Venta a crédito y cartera con abonos", "Sí", "Sí", "Sí"],
  ["Certificado digital y habilitación DIAN", "Incluidos", "Incluidos", "Incluidos por NIT"],
  ["IA predictiva: pedido, vencimientos y patrón semanal", "Sí", "Sí", "Sí"],
  ["Regenta IA y prioridades del día", "Sí", "Sí", "Sí"],
  ["Apoyo en ventas: ofrécelos primero y alternativas", "Sí", "Sí", "Sí"],
  ["Formación del equipo", "Capacitación inicial", "Todo el equipo + primer mes", "Plan por sede"],
  ["Pedido sugerido y riesgo de vencimiento", "Sí", "Sí", "Sí"],
  ["Alertas INVIMA cruzadas con el inventario", "Sí", "Sí", "Sí"],
  ["Lotes, FEFO y bloqueo de vencidos", "Sí", "Sí", "Sí"],
  ["Carga de productos", "Desde Excel", "Te la hacemos", "Te la hacemos"],
  ["Soporte", "WhatsApp", "WhatsApp prioritario", "Acompañamiento"],
];

const PREGUNTAS: [string, string][] = [
  ["¿Tengo que comprarle a Farmagenéricos para usar Regenta?", "No. Puedes usar Regenta con los precios normales sin comprarnos nada. El Plan Socio es un beneficio adicional para quienes ya nos compran o quieren hacerlo."],
  ["¿Cómo se calcula el precio de socio?", SOCIO.nota],
  ["¿Hay costo de instalación?", "No. Funciona en el navegador y la carga de productos desde Excel está incluida."],
  ["Ya tengo un programa, ¿cuánto me cuesta cambiarme?", "Nada aparte. Te pasamos tus productos e inventario en un día, sigues con tu sistema actual hasta que la DIAN apruebe Regenta y no pierdes nada: la importación y la habilitación van incluidas en el plan."],
  ["¿Qué pasa si paso de los documentos del plan?", `Cada documento adicional cuesta ${pesos(DOC_EXTRA)}. Te avisamos antes de llegar al tope.`],
  ["¿Puedo cancelar cuando quiera?", "Sí, el plan es mensual. Si pagas el año completo, tienes 2 meses gratis."],
  ["¿El certificado digital tiene costo?", "No. El certificado digital y la habilitación de tu NIT ante la DIAN van incluidos en todos los planes: no pagas nada aparte."],
];

export default function Precios() {
  const ld = [
    { "@context": "https://schema.org", "@type": "SoftwareApplication", name: "Regenta", applicationCategory: "BusinessApplication", operatingSystem: "Web", description: "Software de facturación electrónica y gestión para droguerías y distribuidoras farmacéuticas, con IA, alertas INVIMA y control de lotes.", image: `${SITIO}/capturas/og.png`,
      offers: PLANES.filter((p) => p.precio).map((p) => ({ "@type": "Offer", name: `Regenta ${p.nombre}`, price: p.precio, priceCurrency: "COP", url: `${SITIO}/contratar?plan=${p.id}`,
        priceSpecification: { "@type": "UnitPriceSpecification", price: p.precio, priceCurrency: "COP", unitText: "MONTH" } })) },
    { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: PREGUNTAS.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) },
  ];
  return (
    <div className="bg-paper text-ink min-h-screen pb-20 sm:pb-0">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      <CabeceraPublica />
      <main>
        <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-10 pb-8">
          <h1 className="font-cond text-[36px] sm:text-[64px] leading-[0.95]" style={{ fontWeight: 700 }}>Precio de Regenta, el software para tu droguería</h1>
          <p className="mt-4 text-lg text-muted max-w-2xl">Todo incluido en cualquier plan: certificado digital y habilitación DIAN, inteligencia artificial, predicción, alertas INVIMA, lotes y carga desde Excel. Sin costo de instalación y sin permanencia.</p>
          <ul className="mt-5 hidden sm:flex flex-wrap gap-2" aria-label="Incluido">
            {["Certificado digital incluido", "Habilitación DIAN incluida", "Sin instalación", "Sin permanencia", "Te pasamos tus productos"].map((t) => <li key={t} className="pastilla bg-teal-50 text-teal-800 border border-teal-200"><span aria-hidden="true">✓</span>{t}</li>)}
          </ul>
          <div className="mt-8 grid md:grid-cols-2 gap-4">
            <a href="#planes" className="tarjeta p-5 hover:border-ink">
              <p className="font-cond text-2xl" style={{ fontWeight: 700 }}>Sin asociarte</p>
              <p className="mt-1 text-muted">Pagas el plan mensual. No tienes que comprarle nada a nadie.</p>
              <p className="mt-3 font-cond text-3xl num" style={{ fontWeight: 700 }}>Desde {pesos(esencial.precio!)} <span className="text-base font-sans font-normal text-muted">al mes</span></p>
            </a>
            <a href="#socio" className="rounded-2xl fondo-hero text-white p-5 ring-4 ring-amber-300 hover:brightness-110">
              <p className="font-cond text-2xl" style={{ fontWeight: 700 }}>Como socio de Farmagenéricos</p>
              <p className="mt-1 text-white/75">Si le compras a Farmagenéricos Colombia, Regenta te sale a mitad de precio o gratis.</p>
              <p className="mt-3 font-cond text-3xl text-marca" style={{ fontWeight: 700 }}>Desde $0 al mes</p>
            </a>
          </div>
        </section>

        <Cumplimiento claro />
        <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-10"><IncluyeTodo titulo="Pagues lo que pagues, te llevas todo esto" /></section>

        <section id="planes" className="max-w-6xl mx-auto px-4 sm:px-6 py-10 scroll-mt-20">
          <h2 className="font-cond text-[36px] sm:text-[46px] leading-none" style={{ fontWeight: 700 }}>Sin asociarte: precio mensual</h2>
          <div className="mt-8 grid md:grid-cols-3 gap-5 items-stretch">
            {PLANES.map((p) => (
              <div key={p.id} className={`rounded-2xl p-6 flex flex-col ${p.destacado ? "bg-surface ring-2 ring-teal-600 shadow-[0_30px_60px_-30px_rgba(14,116,144,.6)]" : "tarjeta"}`}>
                {p.destacado && <p className="text-sm font-semibold text-cruz">Recomendado</p>}
                <h3 className="font-cond text-[30px] mt-1" style={{ fontWeight: 700 }}>{p.nombre}</h3>
                <p className="text-muted">{p.para}</p>
                <p className="mt-4 font-cond text-[46px] leading-none num" style={{ fontWeight: 700 }}>{p.precio ? pesos(p.precio) : "A tu medida"}{p.precio && <span className="text-base font-sans font-normal text-muted"> /mes</span>}</p>
                {p.precio && <p className="mt-2 text-sm"><span className="pastilla h-7 text-[13px] bg-amber-100 text-amber-900">o {pesos(mesAnual(p.precio))}/mes pagando el año</span></p>}
                <ul className="mt-5 grid content-start gap-2 flex-1">{p.incluye.map((x) => <li key={x} className="flex gap-2"><span className="text-cruz font-bold" aria-hidden="true">✓</span>{x}</li>)}</ul>
                {p.precio ? <div className="mt-6 grid gap-2"><Link href={`/contratar?plan=${p.id}`} className={`h-12 ${p.destacado ? "btn-cta" : "btn-oscuro"}`}>Contratar {p.nombre}</Link><BotonDemo texto="Probar antes gratis" className="h-11 w-full btn-borde" /></div>
                  : <a href={wa("Hola, quiero una cotización de Regenta para mi distribuidora o mis sedes.")} className="mt-6 h-12 btn-oscuro">Pedir cotización</a>}
              </div>
            ))}
          </div>
          <p className="mt-5 text-sm text-muted max-w-3xl">{NOTA_PRECIOS} Documento adicional: {pesos(DOC_EXTRA)}.</p>
        </section>

        <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-14"><Oferta origen="precios" /></section>

        <section id="socio" className="fondo-hero text-white scroll-mt-20">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14">
            <h2 className="font-cond text-[40px] sm:text-[56px] leading-[0.95]" style={{ fontWeight: 700 }}>Como socio de Farmagenéricos: a mitad de precio o gratis</h2>
            <p className="mt-4 text-lg text-white/75 max-w-3xl">Somos distribuidor farmacéutico. Si tu droguería nos compra, tu software corre por nuestra cuenta: cuanto más nos compras, menos pagas por Regenta.</p>

            <div className="mt-8 rounded-2xl bg-white text-ink overflow-x-auto">
              <table className="w-full min-w-[560px]">
                <caption className="sr-only">Precio mensual de Regenta según las compras del mes anterior a Farmagenéricos Colombia</caption>
                <thead><tr className="border-b border-line text-left"><th className="p-4">Tus compras a Farmagenéricos en el mes</th><th className="p-4 font-cond text-xl" style={{ fontWeight: 700 }}>Esencial</th><th className="p-4 font-cond text-xl" style={{ fontWeight: 700 }}>Pro</th></tr></thead>
                <tbody className="divide-y divide-line num">
                  <tr><td className="p-4">Menos de {pesos(SOCIO.escalones[0].desde)} (sin descuento)</td><td className="p-4">{pesos(esencial.precio!)}</td><td className="p-4">{pesos(pro.precio!)}</td></tr>
                  {SOCIO.escalones.map((e, i) => (
                    <tr key={e.desde}><td className="p-4">{i + 1 < SOCIO.escalones.length ? <>De {pesos(e.desde)} a {pesos(SOCIO.escalones[i + 1].desde - 1)}</> : <>Desde {pesos(e.desde)}</>}<span className="block text-sm text-muted">{e.etiqueta}</span></td>
                      <td className={`p-4 font-semibold ${e.esencial === 0 ? "text-cruz" : ""}`}>{precio(e.esencial)}</td><td className={`p-4 font-semibold ${e.pro === 0 ? "text-cruz" : ""}`}>{precio(e.pro)}</td></tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="mt-10 rounded-2xl bg-white/5 border border-white/10 p-5 sm:p-6">
              <h3 className="font-cond text-[28px]" style={{ fontWeight: 700 }}>Calcula cuánto te sale</h3>
              <div className="mt-5"><CalculadoraSocio /></div>
            </div>

            <ol className="mt-10 grid md:grid-cols-3 gap-6">
              {["Compras a Farmagenéricos Colombia como siempre, por la línea de pedidos o con tu asesor.", "Al cerrar el mes sumamos tus compras antes de IVA y vemos qué escalón alcanzaste.", "Tu factura de Regenta del mes siguiente sale con ese precio. Si un mes compras menos, pagas según el escalón que alcances."].map((t, i) => (
                <li key={t} className="flex gap-4"><span className="font-cond text-[52px] leading-[0.8] text-marca num" style={{ fontWeight: 700 }} aria-hidden="true">{i + 1}</span><p className="text-white/80">{t}</p></li>
              ))}
            </ol>
            <div className="mt-10 flex flex-wrap gap-3">
              <a href={wa("Hola, quiero el Plan Socio Farmagenéricos para mi droguería.")} className="btn-cta h-14 px-7 text-lg">Quiero ser socio</a>
              <BotonDemo texto="Probar la demo primero" className="btn h-14 px-6 text-lg border-2 border-white/30 text-white hover:border-white" />
            </div>
          </div>
        </section>

        <section className="max-w-5xl mx-auto px-4 sm:px-6 py-14">
          <h2 className="font-cond text-[36px] leading-none" style={{ fontWeight: 700 }}>Qué trae cada plan</h2>
          <div className="mt-6 tarjeta overflow-x-auto">
            <table className="w-full min-w-[620px]">
              <thead><tr className="border-b border-line text-left"><th className="p-4"><span className="sr-only">Función</span></th>{PLANES.map((p) => <th key={p.id} className="p-4 font-cond text-xl" style={{ fontWeight: 700 }}>{p.nombre}</th>)}</tr></thead>
              <tbody className="divide-y divide-line">{FILAS.map(([t, ...v]) => <tr key={t}><td className="p-4 font-semibold">{t}</td>{v.map((x, i) => <td key={i} className="p-4">{x}</td>)}</tr>)}</tbody>
            </table>
          </div>
        </section>

        <Cambiate claro />

        <section className="max-w-3xl mx-auto px-4 sm:px-6 py-16">
          <h2 className="font-cond text-[36px] leading-none" style={{ fontWeight: 700 }}>Preguntas sobre tarifas</h2>
          <dl className="mt-5 grid gap-4">{PREGUNTAS.map(([q, a]) => <div key={q} className="tarjeta p-5"><dt className="font-semibold text-lg">{q}</dt><dd className="mt-1 text-muted leading-relaxed">{a}</dd></div>)}</dl>
          <p className="mt-6"><Link href="/guias/cuanto-cuesta-software-drogueria" className="font-semibold text-cruz underline underline-offset-4">¿Cuánto cuesta un software para droguería en Colombia? Comparativa con fuentes</Link></p>
        </section>
      </main>
      <Pie />
      <BarraMovil />
      <BarraOferta />
    </div>
  );
}
