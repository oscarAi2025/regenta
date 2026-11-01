import type { Metadata } from "next";
import Link from "next/link";
import { ChatDemo } from "@/components/landing/ChatDemo";
import { Calculadora } from "@/components/landing/Calculadora";
import { FormDemo } from "@/components/landing/FormDemo";
import { CabeceraPublica } from "@/components/landing/Cabecera";
import { Pie } from "@/components/landing/Pie";
import { BarraMovil } from "@/components/landing/BarraMovil";
import { BotonDemo } from "@/components/landing/BotonDemo";
import { Respaldo } from "@/components/landing/Respaldo";
import { GUIAS } from "@/content/guias";
import { PAGINAS } from "@/content/paginas";
import { PLANES, SOCIO } from "@/lib/planes";
import { pesos } from "@/lib/formato";
import { CORREO, SITIO, TELEFONO, wa } from "@/lib/sitio";

const TITULO = "Software para droguerías con IA y alertas INVIMA | Regenta";
const DESCRIPCION = "Software de caja para droguerías con IA: predice qué pedir, avisa qué se vence y cruza las alertas del INVIMA con tu inventario. Prueba la demo gratis.";

export const metadata: Metadata = {
  title: { absolute: TITULO },
  description: DESCRIPCION,
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
  openGraph: { type: "website", locale: "es_CO", siteName: "Regenta", title: TITULO, description: DESCRIPCION, url: "/", images: [{ url: "/capturas/og.png", width: 1200, height: 630 }] },
  twitter: { card: "summary_large_image", title: TITULO, description: DESCRIPCION, images: ["/capturas/og.png"] },
};

const PREGUNTAS: [string, string][] = [
  ["¿Puedo probarla antes de pagar?", "Sí, ahora mismo: «Probar la demo» te deja entrar a una droguería de ejemplo con 8 semanas de ventas, sin registrarte y sin tarjeta."],
  ["¿Qué hace la inteligencia artificial?", "Regenta IA responde en lenguaje normal con los datos de tu droguería (ventas, lotes, pedido sugerido, vencimientos, alertas) y te dice de dónde sale cada cifra. Además, Regenta calcula con tus ventas qué pedir y qué se te va a vencer, y te muestra tus prioridades del día."],
  ["¿Cómo funcionan las alertas del INVIMA?", "Regenta lee las alertas sanitarias de medicamentos del INVIMA y las cruza con tu inventario por lote, registro sanitario y nombre. Solo te avisa cuando algo te toca y guarda la constancia de la revisión."],
  ["¿Por qué Regenta y no otro programa?", "Porque lo hace un distribuidor farmacéutico que surte droguerías: conocemos los agotados, los vencidos y las visitas de la secretaría de salud desde adentro. Y porque, de 15 programas para droguerías que revisamos, ninguno ofrece cruzar las alertas del INVIMA con tu inventario."],
  ["¿Hace factura electrónica y POS electrónico DIAN?", "Cada venta queda numerada con tu resolución y en cola para la DIAN. La emisión se está integrando con un proveedor tecnológico autorizado y se activa en tu cuenta al terminar; en la demostración te mostramos el estado exacto."],
  ["¿Puedo vender pastillas sueltas?", "Sí: precio por caja y por unidad; el inventario descuenta unidades exactas del lote que vence antes, y la caja nunca vende un lote vencido."],
  ["¿Cuánto cuesta?", `Esencial ${pesos(PLANES[0].precio!)} al mes y Pro ${pesos(PLANES[1].precio!)}. Con el ${SOCIO.nombre}, si le compras a Farmagenéricos Colombia, puede salirte gratis.`],
  ["¿Hay que instalar algo?", "No. Funciona en el navegador del computador de la caja, en una tableta o en el celular, y cada droguería solo ve sus datos."],
];

const CAPTURA: Record<string, string> = { "regenta-ia": "/capturas/ia.webp", "pedido-sugerido": "/capturas/prediccion.webp", "control-de-vencimientos": "/capturas/vencimiento.webp", "alertas-invima": "/capturas/alertas.webp", "caja-pos": "/capturas/caja.webp" };

export default function Portada() {
  const funciones = PAGINAS.filter((p) => p.grupo === "funciones");
  const ld = [
    { "@context": "https://schema.org", "@type": "SoftwareApplication", name: "Regenta", applicationCategory: "BusinessApplication", applicationSubCategory: "Software POS para droguerías",
      operatingSystem: "Web", inLanguage: "es-CO", description: DESCRIPCION, url: SITIO, image: `${SITIO}/capturas/og.png`,
      offers: PLANES.filter((p) => p.precio).map((p) => ({ "@type": "Offer", name: p.nombre, price: p.precio, priceCurrency: "COP", url: `${SITIO}/precios` })),
      publisher: { "@type": "Organization", name: "Farmagenéricos Colombia", email: CORREO, telephone: TELEFONO },
      featureList: ["Regenta IA: asistente con los datos de la droguería", "Pedido sugerido con las ventas", "Riesgo de vencimiento por lote", "Alertas sanitarias del INVIMA cruzadas con el inventario", "Caja POS con venta por unidad", "Inventario por lote y vencimiento (FEFO)", "Carga de productos desde Excel", "Usuarios con roles"] },
    { "@context": "https://schema.org", "@type": "Organization", name: "Farmagenéricos Colombia", url: SITIO, email: CORREO, telephone: TELEFONO, logo: `${SITIO}/icon.svg` },
    { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: PREGUNTAS.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) },
  ];

  return (
    <div className="bg-paper text-ink pb-20 sm:pb-0">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      <CabeceraPublica />

      <main>
        {/* 1. Portada oscura: la promesa, la IA en acción y la acción a un clic. */}
        <section className="bg-ink text-white">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-12 pb-16 lg:pt-16 lg:pb-24 grid lg:grid-cols-[1.1fr_.9fr] gap-12 items-center">
            <div>
              <p className="font-semibold text-marca text-lg">Software para droguerías con inteligencia artificial</p>
              <h1 className="font-cond text-[48px] sm:text-[76px] lg:text-[88px] leading-[0.9] tracking-[-0.02em] mt-3" style={{ fontWeight: 700 }}>
                Deja de perder plata en vencidos y agotados.
              </h1>
              <p className="mt-6 text-lg sm:text-xl text-white/75 max-w-[34em] leading-relaxed">
                Regenta es la caja de tu droguería que piensa: te dice qué pedir, qué se te va a vencer antes de venderlo y qué alerta del INVIMA toca tu estantería. Y le preguntas lo que quieras, como a tu regente.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <BotonDemo texto="Probar la demo gratis ahora" className="btn-primario h-14 px-7 text-lg" />
                <a href={wa("Hola, quiero conocer Regenta para mi droguería.")} className="btn h-14 px-6 text-lg border-2 border-white/30 text-white hover:border-white">Hablar por WhatsApp</a>
              </div>
              <p className="mt-4 text-[15px] text-white/60">Un clic, sin registro, sin tarjeta. Entras a una droguería de ejemplo con 8 semanas de ventas.</p>
            </div>
            <div className="flex justify-center lg:justify-end"><ChatDemo /></div>
          </div>
          <div className="border-t border-white/10">
            <dl className="max-w-6xl mx-auto px-4 sm:px-6 py-6 grid grid-cols-2 lg:grid-cols-4 gap-6 text-sm">
              {[["Hecho por un distribuidor", "Farmagenéricos Colombia surte droguerías: conocemos el mostrador por dentro"], ["IA con tus datos", "Modelos Claude de Anthropic, con solo lectura y tus permisos"], ["Alertas oficiales del INVIMA", "Cruzadas con tus lotes y registros sanitarios"], ["Catálogo de casi 10.000 productos", "Para no digitar: buscas y pones tu precio"]].map(([t, d]) => (
                <div key={t}><dt className="font-cond text-xl text-white" style={{ fontWeight: 600 }}>{t}</dt><dd className="text-white/60 mt-1">{d}</dd></div>
              ))}
            </dl>
          </div>
        </section>

        {/* 2. Por qué somos distintos: venimos de adentro del sector. */}
        <section className="max-w-6xl mx-auto px-4 sm:px-6 py-16 lg:py-24 grid lg:grid-cols-[1fr_1.1fr] gap-12 items-start">
          <div>
            <h2 className="font-cond text-[40px] sm:text-[56px] leading-[0.95]" style={{ fontWeight: 700 }}>No es un programa genérico. Lo hicimos desde adentro.</h2>
            <p className="mt-5 text-lg text-muted leading-relaxed max-w-[32em]">Farmagenéricos Colombia es un distribuidor farmacéutico que surte droguerías. Todos los días vemos lo que les cuesta plata: el producto que se agotó el sábado, la caja que se venció al fondo del cajón, la alerta del INVIMA que nadie alcanzó a leer. Regenta nace de ahí, con la técnica de un equipo de software y el criterio de quienes trabajan en el sector.</p>
            <Link href="/por-que-regenta" className="inline-block mt-6 font-semibold text-cruz underline underline-offset-4">Conoce por qué Regenta es distinto</Link>
          </div>
          <ul className="grid sm:grid-cols-2 gap-4">
            {[
              ["Criterio farmacéutico", "Lote y vencimiento en cada movimiento, FEFO, bloqueo de vencidos, registro sanitario y evidencia para la visita de la secretaría de salud."],
              ["Ojo de distribuidor", "Pedido sugerido en cajas, lo que se agota primero, lo que no rota y la plata parada en la estantería."],
              ["Inteligencia artificial útil", "Preguntas en lenguaje normal, respuestas con tus cifras y prioridades del día. Sin cajas negras: te dice de dónde sale cada dato."],
              ["Tecnología seria", "En la nube, seguridad por fila (cada droguería ve solo lo suyo), permisos por rol y nada se borra: todo queda auditado."],
            ].map(([t, d]) => (
              <li key={t} className="tarjeta p-5"><h3 className="font-cond text-2xl" style={{ fontWeight: 700 }}>{t}</h3><p className="mt-2 text-muted leading-relaxed">{d}</p></li>
            ))}
          </ul>
        </section>

        {/* 3. Lo que hace, función por función, con capturas reales y enlace a cada página. */}
        <section className="bg-surface border-y border-line">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 lg:py-24">
            <h2 className="font-cond text-[40px] sm:text-[52px] leading-[1]" style={{ fontWeight: 700 }}>Todo lo que tu droguería necesita, en una sola pantalla</h2>
            <div className="mt-10 grid md:grid-cols-2 gap-5">
              {funciones.map((f, i) => (
                <Link key={f.ruta} href={`/funciones/${f.ruta}`} className={`group rounded-2xl border border-line bg-paper p-5 grid gap-4 hover:border-ink ${i === 0 ? "md:col-span-2 md:grid-cols-[.9fr_1.1fr] items-center" : ""}`}>
                  <div>
                    <p className="text-sm font-semibold text-cruz">{f.corto}</p>
                    <h3 className="font-cond text-[28px] leading-tight mt-1" style={{ fontWeight: 700 }}>{f.h1}</h3>
                    <p className="mt-2 text-muted leading-relaxed">{f.descripcion}</p>
                    <p className="mt-3 font-semibold underline underline-offset-4 group-hover:text-cruz">Ver cómo funciona</p>
                  </div>
                  {CAPTURA[f.ruta] && <img src={CAPTURA[f.ruta]} alt={f.captura?.alt ?? f.h1} width={1440} height={900} loading="lazy" decoding="async" className="rounded-xl border border-line w-full h-auto" />}
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* 4. El diferencial verificado. */}
        <section className="bg-ink text-white">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14 grid lg:grid-cols-[1.2fr_1fr] gap-10 items-center">
            <h2 className="font-cond text-[34px] sm:text-[46px] leading-[1]" style={{ fontWeight: 700 }}>Revisamos 15 programas para droguerías en Colombia. Ninguno ofrece cruzar las alertas del INVIMA con tu inventario.</h2>
            <div className="grid gap-4">
              <p className="text-white/80 text-lg">Regenta sí. Y además te dice qué pedir y qué se te va a vencer con tus propias ventas.</p>
              <div><BotonDemo texto="Verlo en la demo" className="btn-primario h-12 px-6" /></div>
              <p className="text-sm text-white/50">Según lo que publican en sus páginas 15 programas de caja y facturación usados por droguerías en Colombia, revisados el 1 de noviembre de 2026.</p>
            </div>
          </div>
        </section>

        <Respaldo />

        {/* 5. La pérdida, con sus números. */}
        <section className="max-w-6xl mx-auto px-4 sm:px-6 py-16 lg:py-20">
          <div className="rounded-3xl bg-ink text-white p-6 sm:p-10">
            <h2 className="font-cond text-[36px] sm:text-[52px] leading-[1] max-w-[16em]" style={{ fontWeight: 700 }}>¿Cuánta plata se te vence al año?</h2>
            <div className="mt-8"><Calculadora precioMes={PLANES[0].precio!} /></div>
            <div className="mt-8"><BotonDemo texto="Ver mis vencimientos en la demo" className="btn-primario h-14 px-7 text-lg" /></div>
          </div>
        </section>

        {/* 6. Antes y después. */}
        <section className="max-w-5xl mx-auto px-4 sm:px-6 pb-16 lg:pb-24">
          <h2 className="font-cond text-[36px] sm:text-[48px] leading-[1]" style={{ fontWeight: 700 }}>El cuaderno y el Excel contra Regenta</h2>
          <div className="mt-8 tarjeta overflow-x-auto">
            <table className="w-full min-w-[560px] text-[16px]">
              <thead><tr className="border-b border-line text-left"><th className="p-4 font-semibold text-muted">En el día a día</th><th className="p-4 font-semibold text-muted">Cuaderno o Excel</th><th className="p-4 font-semibold text-cruz">Con Regenta</th></tr></thead>
              <tbody className="divide-y divide-line">
                {[
                  ["Qué pedir", "A ojo, mirando la estantería", "Pedido sugerido con tus ventas, en cajas"],
                  ["Preguntas del día", "Buscar en papeles o en Excel", "Le preguntas a Regenta IA y responde con cifras"],
                  ["Vencimientos", "Revisión mensual a mano", "Riesgo por lote, en pesos, meses antes"],
                  ["Vender lo vencido", "Depende de que alguien lo vea", "La caja no lo deja vender"],
                  ["Alertas del INVIMA", "Si alguien las lee y busca", "Cruzadas con tus lotes y registros"],
                  ["Evidencia para la visita", "Papeles sueltos", "Quién revisó qué y cuándo"],
                ].map(([a, b, c]) => <tr key={a}><td className="p-4 font-semibold">{a}</td><td className="p-4 text-muted">{b}</td><td className="p-4">{c}</td></tr>)}
              </tbody>
            </table>
          </div>
        </section>

        {/* 7. Precios y Plan Socio. */}
        <section className="bg-surface border-y border-line">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 lg:py-20 grid lg:grid-cols-[1fr_1fr] gap-10 items-center">
            <div>
              <h2 className="font-cond text-[40px] sm:text-[52px] leading-[1]" style={{ fontWeight: 700 }}>Desde {pesos(PLANES[0].precio!)} al mes. O gratis.</h2>
              <p className="mt-4 text-lg text-muted leading-relaxed">Todo incluido: IA, predicción, alertas INVIMA, lotes y carga desde Excel. Sin costo de instalación. Y con el {SOCIO.nombre}, si le compras a Farmagenéricos Colombia, Regenta puede salirte gratis.</p>
              <div className="mt-6 flex flex-wrap gap-3"><Link href="/precios" className="btn-oscuro h-12 px-6">Ver tarifas y Plan Socio</Link><BotonDemo texto="Probar la demo" className="btn-borde h-12 px-6" /></div>
            </div>
            <ul className="grid gap-3">
              {SOCIO.escalones.map((e) => (
                <li key={e.desde} className="rounded-2xl bg-paper border border-line p-4 flex items-center justify-between gap-4">
                  <span className="text-muted">Compras desde <b className="text-ink num">{pesos(e.desde)}</b> al mes</span><span className="font-semibold text-cruz text-right">{e.etiqueta}</span>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* 8. Para quién. */}
        <section className="max-w-6xl mx-auto px-4 sm:px-6 py-16 grid md:grid-cols-3 gap-6">
          {[
            ["Regente", "Vencimientos, alertas del INVIMA con constancia, recepción por lote y registro sanitario.", "/para/regentes"],
            ["Auxiliar de farmacia", "Caja rápida con lector, caja o unidad en un toque y el producto que conviene vender primero.", "/funciones/caja-pos"],
            ["Dueño", "Ventas, ganancia, pedido sugerido y plata parada en la estantería, desde el celular.", "/para/duenos-de-drogueria"],
          ].map(([t, d, h]) => (
            <Link key={t} href={h} className="tarjeta p-6 hover:border-ink"><h3 className="font-cond text-[30px]" style={{ fontWeight: 700 }}>{t}</h3><p className="mt-2 text-muted text-lg leading-relaxed">{d}</p></Link>
          ))}
        </section>

        {/* 9. Guías (silo SEO). */}
        <section className="bg-surface border-y border-line">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14">
            <div className="flex flex-wrap items-end justify-between gap-3"><h2 className="font-cond text-[32px] sm:text-[42px] leading-[1]" style={{ fontWeight: 700 }}>Guías para regentes y dueños</h2><Link href="/guias" className="font-semibold text-cruz underline underline-offset-4">Ver las {GUIAS.length} guías</Link></div>
            <ul className="mt-6 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {GUIAS.slice(0, 9).map((g) => <li key={g.slug}><Link href={`/guias/${g.slug}`} className="block rounded-xl border border-line p-4 h-full hover:border-ink"><span className="font-semibold">{g.h1}</span></Link></li>)}
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

        {/* 10. Cierre: dos caminos inmediatos. */}
        <section id="demo" className="bg-ink text-white scroll-mt-16">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 lg:py-20 grid lg:grid-cols-[1fr_1fr] gap-12">
            <div>
              <h2 className="font-cond text-[42px] sm:text-[60px] leading-[0.95]" style={{ fontWeight: 700 }}>La próxima alerta del INVIMA puede estar ya en tu estantería.</h2>
              <p className="mt-5 text-lg text-white/75 max-w-[28em]">Entra a la demo en un clic, o déjanos tus datos y te mostramos Regenta con tus propios productos en 20 minutos.</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <BotonDemo texto="Probar la demo gratis ahora" className="btn-primario h-14 px-7 text-lg" />
                <a href={wa("Hola, quiero conocer Regenta para mi droguería.")} className="btn h-14 px-6 text-lg border-2 border-white/30 text-white hover:border-white">Hablar por WhatsApp</a>
              </div>
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
