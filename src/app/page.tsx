import type { Metadata } from "next";
import Link from "next/link";
import { Avisos } from "@/components/landing/Avisos";
import { Calculadora } from "@/components/landing/Calculadora";
import { FormDemo } from "@/components/landing/FormDemo";
import { CabeceraPublica } from "@/components/landing/Cabecera";
import { Pie } from "@/components/landing/Pie";
import { BarraMovil } from "@/components/landing/BarraMovil";
import { GUIAS } from "@/content/guias";
import { PLANES, DOC_EXTRA, NOTA_PRECIOS } from "@/lib/planes";
import { CORREO, SITIO, TELEFONO, wa } from "@/lib/sitio";

const TITULO = "Software para droguerías: POS, lotes y alertas INVIMA | Regenta";
const DESCRIPCION = "Programa de caja para droguerías en Colombia que predice qué pedir, avisa qué se te va a vencer y cruza las alertas del INVIMA con tu inventario. En la nube. Prueba la demo sin registrarte.";

export const metadata: Metadata = {
  title: { absolute: TITULO },
  description: DESCRIPCION,
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
  openGraph: { type: "website", locale: "es_CO", siteName: "Regenta", title: TITULO, description: DESCRIPCION, url: "/", images: [{ url: "/capturas/og.png", width: 1200, height: 630 }] },
  twitter: { card: "summary_large_image", title: TITULO, description: DESCRIPCION, images: ["/capturas/og.png"] },
};

const pesos = (n: number) => "$" + n.toLocaleString("es-CO");

const PREGUNTAS: [string, string][] = [
  ["¿Puedo probarla antes de pagar?", "Sí, ahora mismo: el botón «Probar la demo» te deja entrar a una droguería de ejemplo con ventas de 8 semanas, sin registrarte y sin tarjeta. Vende, recibe mercancía, mira el pedido sugerido y las alertas."],
  ["¿De dónde salen las predicciones?", "De tus propias ventas: Regenta calcula cuánto vendes por día de cada producto (con más peso a las últimas dos semanas), para cuántos días te alcanza lo que tienes y cuántas cajas pedir. Con el mismo ritmo calcula qué lotes no alcanzarás a vender antes de su fecha. No es una caja negra: cada número se explica en pantalla."],
  ["¿Cómo funcionan las alertas del INVIMA?", "Regenta lee las alertas sanitarias de medicamentos que publica el INVIMA y las cruza con tu inventario por lote, por registro sanitario y por nombre. Solo te avisa cuando algo te toca, y guarda quién lo revisó, cuándo y qué hizo, para tu evidencia ante la secretaría de salud."],
  ["¿Puedo vender pastillas sueltas?", "Sí. Cada producto tiene precio por caja y por unidad; el inventario descuenta unidades exactas del lote que vence antes. Y Regenta no deja vender un lote vencido."],
  ["¿Hace factura electrónica y POS electrónico DIAN?", "Cada venta queda numerada con tu resolución y en cola para la DIAN. La emisión se está integrando con un proveedor tecnológico autorizado por la DIAN y se activa en tu cuenta al terminar; en la demostración te mostramos el estado exacto."],
  ["¿Tengo que digitar todos mis productos?", "No. Buscas en un catálogo de casi 10.000 productos y solo pones tu precio, o subes tu Excel con existencias, lote, vencimiento y registro sanitario. En el plan Pro te los cargamos nosotros."],
  ["¿Hay que instalar algo?", "No. Funciona en el navegador del computador de la caja, en una tableta o en el celular. Cada droguería solo ve sus datos."],
  ["¿Mis empleados pueden ver costos o borrar ventas?", "No. La cajera vende; bodega recibe mercancía; los costos y la utilidad solo los ve el dueño o el administrador. Ninguna venta se borra: se anula con motivo y queda quién lo hizo."],
];

function Captura({ src, alt }: { src: string; alt: string }) {
  return (
    <div className="rounded-[18px] bg-ink p-1.5 shadow-[0_30px_60px_-30px_rgba(16,42,67,.55)]">
      <img src={src} alt={alt} width={1440} height={900} loading="lazy" decoding="async" className="rounded-[13px] w-full h-auto bg-paper" />
    </div>
  );
}

function Cta({ claro = false, texto = "Probar la demo ahora" }: { claro?: boolean; texto?: string }) {
  return (
    <div className="flex flex-wrap items-center gap-3">
      <a href="/demo" className="btn-primario h-14 px-7 text-lg">{texto}</a>
      <a href={wa("Hola, quiero conocer Regenta para mi droguería.")} className={`btn h-14 px-6 text-lg border-2 ${claro ? "border-white/35 text-white hover:border-white" : "border-line bg-surface text-ink hover:border-ink"}`}>Hablar por WhatsApp</a>
    </div>
  );
}

export default function Portada() {
  const ld = [
    { "@context": "https://schema.org", "@type": "SoftwareApplication", name: "Regenta", applicationCategory: "BusinessApplication", applicationSubCategory: "Software POS para droguerías",
      operatingSystem: "Web", inLanguage: "es-CO", description: DESCRIPCION, url: SITIO,
      offers: PLANES.filter((p) => p.precio).map((p) => ({ "@type": "Offer", name: p.nombre, price: p.precio, priceCurrency: "COP", url: `${SITIO}/#precios` })),
      publisher: { "@type": "Organization", name: "Farmagenéricos Colombia", email: CORREO, telephone: TELEFONO },
      featureList: ["Caja POS con lector de código de barras", "Venta por caja o por unidad", "Inventario por lote y vencimiento (FEFO)", "Pedido sugerido con las ventas de la droguería", "Riesgo de vencimiento por lote", "Alertas sanitarias del INVIMA cruzadas con el inventario", "Carga de productos desde Excel", "Usuarios con roles"] },
    { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: PREGUNTAS.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) },
  ];

  return (
    <div className="bg-paper text-ink pb-20 sm:pb-0">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      <CabeceraPublica />

      <main>
        {/* 1. La promesa, con la pérdida delante y la acción a un clic. */}
        <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-10 pb-16 lg:pt-14 lg:pb-24 grid lg:grid-cols-[1.15fr_.85fr] gap-12 items-center">
          <div>
            <p className="font-semibold text-cruz text-lg">Para regentes, auxiliares y dueños de droguería</p>
            <h1 className="font-cond text-[48px] sm:text-[74px] lg:text-[86px] leading-[0.9] tracking-[-0.02em] mt-3" style={{ fontWeight: 700 }}>
              Deja de perder plata en vencidos y agotados.
            </h1>
            <p className="mt-6 text-lg sm:text-xl text-muted max-w-[34em] leading-relaxed">
              Regenta es la caja de tu droguería que, con tus propias ventas, te dice qué pedir, qué se te va a vencer antes de venderlo y qué alerta del INVIMA toca tu inventario.
            </p>
            <div className="mt-8"><Cta /></div>
            <p className="mt-4 text-[15px] text-muted">Entras en un clic a una droguería de ejemplo con 8 semanas de ventas. Sin registro, sin tarjeta, desde el celular.</p>
          </div>
          <div className="flex justify-center lg:justify-end"><Avisos /></div>
        </section>

        {/* 2. Lo que no encontramos en otro programa, dicho con precisión. */}
        <section className="bg-ink text-white">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14 grid lg:grid-cols-[1fr_1.2fr] gap-10 items-center">
            <h2 className="font-cond text-[34px] sm:text-[46px] leading-[1]" style={{ fontWeight: 700 }}>Revisamos 15 programas para droguerías en Colombia. Ninguno ofrece cruzar las alertas del INVIMA con tu inventario.</h2>
            <div className="grid gap-4 text-white/80 text-lg">
              <p>Regenta sí: lee cada alerta sanitaria de medicamentos y te avisa si tienes <b className="text-white">ese lote</b>, <b className="text-white">ese registro sanitario</b> o <b className="text-white">ese producto</b>. Y guarda quién la revisó y qué hizo, para la visita de la secretaría de salud.</p>
              <p className="text-sm text-white/55">Según lo que publican en sus páginas 15 programas de caja y facturación usados por droguerías en Colombia, revisados el 1 de noviembre de 2026.</p>
            </div>
          </div>
        </section>

        {/* 3. Los tres avisos que cambian el negocio, con capturas reales. */}
        <section className="max-w-6xl mx-auto px-4 sm:px-6 py-16 lg:py-24 grid gap-20">
          <article className="grid lg:grid-cols-[.85fr_1.15fr] gap-10 items-center">
            <div>
              <h2 className="font-cond text-[36px] sm:text-[48px] leading-[1]" style={{ fontWeight: 700 }}>El pedido sale solo. Tú solo lo revisas.</h2>
              <p className="mt-4 text-lg text-muted leading-relaxed">Regenta mira cuánto vendes de cada producto, para cuántos días te alcanza y cuánto tarda tu proveedor. Te arma el pedido en cajas completas, lo ajustas y lo mandas por WhatsApp o en Excel.</p>
              <ul className="mt-5 grid gap-2 text-[17px]">
                <li>Lo que se agota esta semana, primero.</li>
                <li>Flechas que te dicen qué se está vendiendo más o menos que antes.</li>
                <li>Lo que no rota hace 45 días, aparte: no lo vuelvas a pedir.</li>
              </ul>
            </div>
            <Captura src="/capturas/prediccion.webp" alt="Pedido sugerido de Regenta con existencias, venta por semana, días de cobertura y cajas a pedir" />
          </article>

          <article className="grid lg:grid-cols-[1.15fr_.85fr] gap-10 items-center">
            <div className="lg:order-2">
              <h2 className="font-cond text-[36px] sm:text-[48px] leading-[1]" style={{ fontWeight: 700 }}>Sabes qué se va a vencer meses antes, en pesos.</h2>
              <p className="mt-4 text-lg text-muted leading-relaxed">Con tu ritmo de venta y vendiendo primero lo que vence antes, Regenta calcula cuántas unidades de cada lote no alcanzarás a vender antes de su fecha y cuánta plata son. Aún estás a tiempo de exhibirlas, ofertarlas o devolverlas.</p>
              <p className="mt-3 text-lg text-muted leading-relaxed">Y en la caja, lo vencido simplemente no se puede vender.</p>
            </div>
            <div className="lg:order-1"><Captura src="/capturas/vencimiento.webp" alt="Lotes que se vencerían sin venderse, con fecha, unidades en riesgo y valor a costo" /></div>
          </article>

          <article className="grid lg:grid-cols-[.85fr_1.15fr] gap-10 items-center">
            <div>
              <h2 className="font-cond text-[36px] sm:text-[48px] leading-[1]" style={{ fontWeight: 700 }}>Una alerta del INVIMA no te toma por sorpresa.</h2>
              <p className="mt-4 text-lg text-muted leading-relaxed">Cuando sale una alerta de un medicamento falsificado o defectuoso, Regenta la cruza con tus lotes y registros sanitarios. Si te toca, lo ves en el inicio, lo separas con un clic y queda la constancia.</p>
            </div>
            <Captura src="/capturas/alertas.webp" alt="Alerta del INVIMA cruzada con el inventario: la droguería tiene el lote alertado" />
          </article>

          <article className="grid lg:grid-cols-[1.15fr_.85fr] gap-10 items-center">
            <div className="lg:order-2">
              <h2 className="font-cond text-[36px] sm:text-[48px] leading-[1]" style={{ fontWeight: 700 }}>Y una caja que se aprende en cinco minutos.</h2>
              <p className="mt-4 text-lg text-muted leading-relaxed">Escanea o escribe dos letras, elige caja o unidad y cobra en efectivo, Nequi, Daviplata, tarjeta, transferencia o Bre-B. Si se cae la red a mitad del cobro, la venta no se duplica.</p>
            </div>
            <div className="lg:order-1"><Captura src="/capturas/caja.webp" alt="Caja de Regenta con búsqueda de productos, precios por caja y por unidad y el tiquete de la venta" /></div>
          </article>
        </section>

        {/* 4. La pérdida, con sus números. */}
        <section className="bg-ink text-white">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 lg:py-20">
            <h2 className="font-cond text-[36px] sm:text-[52px] leading-[1] max-w-[16em]" style={{ fontWeight: 700 }}>¿Cuánta plata se te vence al año?</h2>
            <div className="mt-10"><Calculadora precioMes={PLANES[0].precio!} /></div>
            <div className="mt-10"><Cta claro texto="Ver mis vencimientos en la demo" /></div>
          </div>
        </section>

        {/* 5. Antes y después. */}
        <section className="max-w-5xl mx-auto px-4 sm:px-6 py-16 lg:py-24">
          <h2 className="font-cond text-[36px] sm:text-[48px] leading-[1]" style={{ fontWeight: 700 }}>El cuaderno y el Excel contra Regenta</h2>
          <div className="mt-8 tarjeta overflow-x-auto">
            <table className="w-full min-w-[560px] text-[16px]">
              <thead><tr className="border-b border-line text-left"><th className="p-4 font-semibold text-muted">En el día a día</th><th className="p-4 font-semibold text-muted">Cuaderno o Excel</th><th className="p-4 font-semibold text-cruz">Con Regenta</th></tr></thead>
              <tbody className="divide-y divide-line">
                {[
                  ["Qué pedir", "A ojo, mirando la estantería", "Pedido sugerido con tus ventas, en cajas"],
                  ["Vencimientos", "Revisión mensual a mano", "Riesgo por lote, en pesos, meses antes"],
                  ["Vender lo vencido", "Depende de que alguien lo vea", "La caja no lo deja vender"],
                  ["Alertas del INVIMA", "Si alguien las lee y busca", "Cruzadas con tus lotes y registros"],
                  ["Pastillas sueltas", "Se descuadra el inventario", "Descuenta unidades del lote correcto"],
                  ["Evidencia para la visita", "Papeles sueltos", "Quién revisó qué y cuándo"],
                ].map(([a, b, c]) => <tr key={a}><td className="p-4 font-semibold">{a}</td><td className="p-4 text-muted">{b}</td><td className="p-4">{c}</td></tr>)}
              </tbody>
            </table>
          </div>
        </section>

        {/* 6. Para cada persona del mostrador. */}
        <section className="bg-surface border-y border-line">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 grid md:grid-cols-3 gap-8">
            {[
              ["Regente", "Vencimientos, alertas del INVIMA y recepción de mercancía por lote, con la evidencia guardada para la visita de la secretaría de salud."],
              ["Auxiliar de farmacia", "Una caja rápida con lector, caja o unidad en un toque, el cambio calculado y el producto que conviene vender primero a la vista."],
              ["Dueño", "Ventas, utilidad y medios de pago del día; el pedido sugerido y la plata parada en la estantería, desde el celular."],
            ].map(([t, d]) => (
              <div key={t}><h3 className="font-cond text-[28px]" style={{ fontWeight: 700 }}>{t}</h3><p className="mt-2 text-muted text-lg leading-relaxed">{d}</p></div>
            ))}
          </div>
        </section>

        {/* 7. Precios claros. */}
        <section id="precios" className="max-w-6xl mx-auto px-4 sm:px-6 py-16 lg:py-24 scroll-mt-20">
          <h2 className="font-cond text-[36px] sm:text-[52px] leading-[1]" style={{ fontWeight: 700 }}>Precios claros, sin sorpresas</h2>
          <p className="mt-3 text-lg text-muted max-w-2xl">Todo incluido: predicción, alertas INVIMA, lotes, carga desde Excel y actualizaciones. Sin costo de instalación.</p>
          <div className="mt-10 grid md:grid-cols-3 gap-5 items-stretch">
            {PLANES.map((p) => (
              <div key={p.id} className={`rounded-2xl p-6 flex flex-col ${p.destacado ? "bg-ink text-white ring-4 ring-cruz" : "tarjeta"}`}>
                {p.destacado && <p className="text-sm font-semibold text-marca">Recomendado</p>}
                <h3 className="font-cond text-[30px] mt-1" style={{ fontWeight: 700 }}>{p.nombre}</h3>
                <p className={p.destacado ? "text-white/70" : "text-muted"}>{p.para}</p>
                <p className="mt-4 font-cond text-[44px] leading-none num" style={{ fontWeight: 700 }}>{p.precio ? pesos(p.precio) : "A tu medida"}{p.precio && <span className="text-base font-sans font-normal opacity-70"> /mes</span>}</p>
                <ul className={`mt-5 grid gap-2 flex-1 ${p.destacado ? "text-white/85" : ""}`}>{p.incluye.map((x) => <li key={x} className="flex gap-2"><span className="text-cruz font-bold" aria-hidden="true">✓</span>{x}</li>)}</ul>
                <a href={p.precio ? "/demo" : wa("Hola, quiero una cotización de Regenta para varias sedes.")} className={`mt-6 h-12 ${p.destacado ? "btn-primario" : "btn-borde"}`}>{p.precio ? "Probar la demo gratis" : "Pedir cotización"}</a>
              </div>
            ))}
          </div>
          <p className="mt-6 text-sm text-muted max-w-3xl">{NOTA_PRECIOS} Documento adicional: {pesos(DOC_EXTRA)}.</p>
        </section>

        {/* 8. Guías (silo SEO). */}
        <section className="bg-surface border-y border-line">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14">
            <h2 className="font-cond text-[32px] sm:text-[42px] leading-[1]" style={{ fontWeight: 700 }}>Guías para regentes</h2>
            <ul className="mt-6 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {GUIAS.map((g) => <li key={g.slug}><Link href={`/guias/${g.slug}`} className="block rounded-xl border border-line p-4 h-full hover:border-ink"><span className="font-semibold">{g.h1}</span></Link></li>)}
            </ul>
          </div>
        </section>

        <section id="preguntas" className="max-w-3xl mx-auto px-4 sm:px-6 py-16 lg:py-24">
          <h2 className="font-cond text-[36px] sm:text-[48px] leading-[1]" style={{ fontWeight: 700 }}>Preguntas antes de probar</h2>
          <div className="mt-8 divide-y divide-line border-y border-line">
            {PREGUNTAS.map(([q, a]) => (
              <details key={q} className="group py-4">
                <summary className="cursor-pointer list-none flex justify-between gap-4 font-semibold text-lg">{q}<span className="text-cruz text-2xl leading-none group-open:rotate-45 transition-transform" aria-hidden="true">+</span></summary>
                <p className="mt-2 text-muted leading-relaxed">{a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* 9. Cierre: dos caminos, los dos inmediatos. */}
        <section id="demo" className="bg-ink text-white scroll-mt-16">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 lg:py-20 grid lg:grid-cols-[1fr_1fr] gap-12">
            <div>
              <h2 className="font-cond text-[42px] sm:text-[60px] leading-[0.95]" style={{ fontWeight: 700 }}>La próxima alerta del INVIMA puede estar ya en tu estantería.</h2>
              <p className="mt-5 text-lg text-white/75 max-w-[28em]">Entra a la demo en un clic, o déjanos tus datos y te mostramos Regenta con tus propios productos en 20 minutos.</p>
              <div className="mt-8"><Cta claro /></div>
            </div>
            <FormDemo />
          </div>
        </section>
      </main>

      <Pie />
      <BarraMovil />
    </div>
  );
}
