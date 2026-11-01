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
import { HeroProducto } from "@/components/landing/HeroProducto";
import { Desfile } from "@/components/landing/Desfile";
import { Sello } from "@/components/landing/Sello";
import { IncluyeTodo } from "@/components/landing/IncluyeTodo";
import { Cumplimiento } from "@/components/landing/Cumplimiento";
import { GUIAS } from "@/content/guias";
import { PAGINAS } from "@/content/paginas";
import { mesAnual, PLANES, SOCIO } from "@/lib/planes";
import { pesos } from "@/lib/formato";
import { CORREO, SITIO, TELEFONO, wa } from "@/lib/sitio";

const TITULO = "Software de facturación y POS para droguerías y farmacias";
const DESCRIPCION = "Facturación electrónica DIAN, POS, inventario por lote, cartera, alertas INVIMA e IA para droguerías, farmacias y distribuidoras, hecho por el sector.";

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
  ["¿Regenta es un software de facturación?", "Sí. Es facturación y gestión en un solo programa: desde la caja emites tiquete POS electrónico o factura electrónica de venta a clientes con NIT o cédula, de contado o a crédito, y además manejas inventario por lote, cartera, pedidos y alertas del INVIMA."],
  ["¿Ya se envía a la DIAN?", "Cada documento queda numerado con tu resolución y en cola para la DIAN. La emisión ante la DIAN se está integrando y se activa en tu cuenta al terminar; en la demostración la emisión es simulada y así lo dice en pantalla."],
  ["¿Sirve para distribuidoras farmacéuticas?", "Sí, para facturar a droguerías y empresas con NIT, vender por caja, dar crédito con plazo y llevar la cartera, con la bodega por lote y vencimiento. Hoy no maneja listas de precio por cliente, cupos de crédito ni preventa en ruta: si los necesitas, te lo decimos antes de que pagues."],
  ["¿Puedo vender pastillas sueltas?", "Sí: precio por caja y por unidad; el inventario descuenta unidades exactas del lote que vence antes, y la caja nunca vende un lote vencido."],
  ["¿Cuánto cuesta?", `Esencial ${pesos(PLANES[0].precio!)} al mes y Pro ${pesos(PLANES[1].precio!)}. Con el ${SOCIO.nombre}, si le compras a Farmagenéricos Colombia, puede salirte gratis.`],
  ["¿Hay que instalar algo?", "No. Funciona en el navegador del computador de la caja, en una tableta o en el celular, y cada droguería solo ve sus datos."],
];

const CAPTURA: Record<string, string> = { "facturacion-electronica": "/capturas/facturacion.webp", "cartera-y-credito": "/capturas/cartera.webp", "regenta-ia": "/capturas/ia.webp", "pedido-sugerido": "/capturas/prediccion.webp", "control-de-vencimientos": "/capturas/vencimiento.webp", "alertas-invima": "/capturas/alertas.webp", "caja-pos": "/capturas/caja.webp" };

export default function Portada() {
  const funciones = PAGINAS.filter((p) => p.grupo === "funciones");
  const ld = [
    { "@context": "https://schema.org", "@type": "SoftwareApplication", name: "Regenta", applicationCategory: "BusinessApplication", applicationSubCategory: "Software de facturación electrónica e inventario para droguerías y distribuidoras farmacéuticas",
      operatingSystem: "Web", inLanguage: "es-CO", description: DESCRIPCION, url: SITIO, image: `${SITIO}/capturas/og.png`,
      offers: PLANES.filter((p) => p.precio).map((p) => ({ "@type": "Offer", name: p.nombre, price: p.precio, priceCurrency: "COP", url: `${SITIO}/precios` })),
      publisher: { "@type": "Organization", name: "Farmagenéricos Colombia", email: CORREO, telephone: TELEFONO },
      featureList: ["Facturación electrónica: tiquete POS y factura de venta con cliente", "Venta a crédito con plazo y cartera con abonos", "Regenta IA: asistente con los datos de la droguería", "Pedido sugerido con las ventas", "Riesgo de vencimiento por lote", "Alertas sanitarias del INVIMA cruzadas con el inventario", "Caja POS con venta por unidad", "Inventario por lote y vencimiento (FEFO)", "Carga de productos desde Excel", "Usuarios con roles"] },
    { "@context": "https://schema.org", "@type": "Organization", name: "Farmagenéricos Colombia", url: SITIO, email: CORREO, telephone: TELEFONO, logo: `${SITIO}/icon.svg` },
    { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: PREGUNTAS.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) },
  ];


  const WA = wa("Hola, quiero conocer Regenta para mi droguería o distribuidora.");
  return (
    <div className="bg-paper text-ink pb-20 sm:pb-0">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />
      <CabeceraPublica />

      <main>
        {/* 1. Héroe: qué es, para quién, quién lo respalda, y el producto en acción. */}
        <section className="fondo-hero text-white relative overflow-hidden">
          <div className="rejilla absolute inset-0" aria-hidden="true" />
          <div className="relative max-w-6xl mx-auto px-4 sm:px-6 pt-10 pb-16 lg:pt-16 lg:pb-24 grid lg:grid-cols-[1.05fr_.95fr] gap-12 items-center">
            <div className="entra">
              <p className="pastilla bg-white/10 border border-white/15 text-white/90"><span className="size-2 rounded-full bg-amber-300" aria-hidden="true" />Respaldado por Farmagenéricos Colombia, mayorista farmacéutico</p>
              <h1 className="mt-5 font-cond text-[44px] sm:text-[66px] lg:text-[74px] leading-[0.95] tracking-[-0.02em]" style={{ fontWeight: 700 }}>
                Facturación electrónica e IA para <span className="texto-degradado">droguerías, farmacias y distribuidoras</span>
              </h1>
              <p className="mt-6 text-lg sm:text-xl text-white/80 max-w-[34em] leading-relaxed">
                Hecho por gente del sector farmacéutico para profesionales del sector. No es un POS genérico: factura ante la DIAN, controla cada lote, te avisa lo que se vence, cruza las alertas del INVIMA y te dice qué vender y qué pedir.
              </p>
              <div className="mt-8 flex flex-wrap items-center gap-3">
                <BotonDemo texto="Probar gratis ahora" className="btn-cta h-14 px-8 text-lg" />
                <a href={WA} className="btn-vidrio h-14 px-6 text-lg">Hablar por WhatsApp</a>
              </div>
              <p className="mt-4 text-[15px] text-white/60">Un clic, sin registro y sin tarjeta. Entras a una droguería de ejemplo con 8 semanas de ventas. <Link href="/precios" className="underline underline-offset-4 text-white/80 hover:text-white">Planes desde {pesos(PLANES[0].precio!)}</Link></p>
              <div className="mt-8"><Sello oscuro /></div>
            </div>
            <HeroProducto />
          </div>
        </section>

        <Cumplimiento />
        <Desfile />

        {/* 2. No es un POS genérico. */}
        <section className="max-w-6xl mx-auto px-4 sm:px-6 py-16 lg:py-24">
          <h2 className="font-cond text-[40px] sm:text-[56px] leading-[0.98] max-w-[15em]" style={{ fontWeight: 700 }}>Un POS genérico cobra. Regenta piensa como un regente.</h2>
          <p className="mt-4 text-lg text-muted max-w-3xl">El programa de la tienda de la esquina no sabe de lotes, vencimientos, alertas sanitarias ni de la visita de la secretaría de salud. Regenta nació para eso.</p>
          <div className="mt-10 grid lg:grid-cols-2 gap-5">
            <div className="rounded-3xl border border-line bg-surface p-6 sm:p-8">
              <p className="font-cond text-2xl text-muted" style={{ fontWeight: 700 }}>POS genérico</p>
              <ul className="mt-5 grid gap-3 text-[17px] text-muted">
                {["Cobra y saca el tiquete", "El inventario es un número por producto", "No distingue lotes ni fechas de vencimiento", "Puede vender un producto vencido", "Las alertas del INVIMA las buscas tú", "Pedir es a ojo", "Los reportes los interpretas tú"].map((t) => (
                  <li key={t} className="flex gap-3"><span className="mt-0.5 size-6 shrink-0 rounded-full bg-line grid place-items-center text-[13px]" aria-hidden="true">✕</span>{t}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-3xl degradado-marca text-white p-6 sm:p-8 shadow-[0_30px_60px_-30px_rgba(14,116,144,.8)]">
              <p className="font-cond text-2xl" style={{ fontWeight: 700 }}>Regenta</p>
              <ul className="mt-5 grid gap-3 text-[17px]">
                {["Tiquete POS y factura electrónica, de contado o a crédito", "Inventario por lote, con fecha de vencimiento y registro sanitario", "Vende primero lo que vence antes, siempre", "La caja bloquea los lotes vencidos", "Alertas del INVIMA cruzadas con tus lotes, con constancia", "Pedido sugerido en cajas con tus ventas reales", "Regenta IA te explica tus cifras y te dice qué hacer"].map((t) => (
                  <li key={t} className="flex gap-3"><span className="mt-0.5 size-6 shrink-0 rounded-full bg-amber-300 text-[#0b1f33] grid place-items-center text-[13px] font-bold" aria-hidden="true">✓</span>{t}</li>
                ))}
              </ul>
              <div className="mt-7 flex flex-wrap gap-3"><BotonDemo texto="Verlo funcionando" className="btn-cta h-12 px-6" /><Link href="/precios" className="btn-vidrio h-12 px-6">Ver planes</Link></div>
            </div>
          </div>
        </section>

        {/* 3. Te guía y te ayuda a vender. */}
        <section className="bg-[#0b1f33] text-white">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 lg:py-24">
            <div className="grid lg:grid-cols-[1fr_1fr] gap-8 items-end">
              <h2 className="font-cond text-[40px] sm:text-[56px] leading-[0.98]" style={{ fontWeight: 700 }}>No solo registra. Te guía y te ayuda a vender más.</h2>
              <p className="text-lg text-white/70">Cada mañana sabes qué hacer primero. En el mostrador, qué ofrecer. Y si algo no está, qué tienes que lo reemplace.</p>
            </div>
            <ul className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 gap-4">
              {[
                ["Ofrécelos primero", "La caja te muestra lo que vence en menos de 60 días para venderlo antes de perderlo.", "text-amber-300", "/funciones/control-de-vencimientos"],
                ["Alternativas con existencias", "Si un producto está agotado, la caja te muestra los parecidos que sí tienes para no perder la venta.", "text-teal-300", "/funciones/caja-pos"],
                ["Prioridades del día", "Alertas, agotados y vencimientos ordenados por lo que más plata te cuesta.", "text-sky-300", "/funciones/regenta-ia"],
                ["Regenta IA", "Pregúntale «¿qué pido esta semana?» o «¿cuánto vendí ayer?» y te responde con tus datos.", "text-violet-300", "/funciones/regenta-ia"],
                ["Pedido sugerido", "Cuántas cajas pedir de cada producto, con tus ventas y el día fuerte de tu semana.", "text-emerald-300", "/funciones/pedido-sugerido"],
                ["Cartera bajo control", "A quién le fiaste, cuánto te deben y qué se vence esta semana.", "text-rose-300", "/funciones/cartera-y-credito"],
              ].map(([t, d, c, h]) => (
                <li key={t}><Link href={h} className="block h-full rounded-3xl bg-white/[.05] border border-white/10 p-6 hover:bg-white/[.09] hover:border-white/25 transition-colors">
                  <p className={`font-cond text-[26px] leading-tight ${c}`} style={{ fontWeight: 700 }}>{t}</p>
                  <p className="mt-2 text-white/70 leading-relaxed">{d}</p>
                </Link></li>
              ))}
            </ul>
            <div className="mt-10 flex flex-wrap gap-3"><BotonDemo texto="Probar gratis ahora" className="btn-cta h-14 px-8 text-lg" /><a href={WA} className="btn-vidrio h-14 px-6 text-lg">Que me lo muestren</a></div>
          </div>
        </section>

        {/* 4. Hecho desde adentro del sector. */}
        <section className="max-w-6xl mx-auto px-4 sm:px-6 py-16 lg:py-24 grid lg:grid-cols-[1fr_1.1fr] gap-12 items-start">
          <div>
            <p className="pastilla bg-teal-50 text-teal-800 border border-teal-200">Del sector, para el sector</p>
            <h2 className="mt-4 font-cond text-[40px] sm:text-[56px] leading-[0.95]" style={{ fontWeight: 700 }}>Lo hace un mayorista farmacéutico que surte droguerías todos los días.</h2>
            <p className="mt-5 text-lg text-muted leading-relaxed max-w-[32em]">Farmagenéricos Colombia distribuye medicamentos a droguerías. Vemos de primera mano el agotado del sábado, la caja vencida al fondo del cajón y la alerta del INVIMA que nadie alcanzó a leer. Regenta junta ese conocimiento con un equipo de software e inteligencia artificial.</p>
            <div className="mt-7 flex flex-wrap gap-3"><Link href="/por-que-regenta" className="btn-oscuro h-12 px-6">Por qué Regenta es distinto</Link><BotonDemo texto="Probar gratis" className="btn-borde h-12 px-6" /></div>
          </div>
          <ul className="grid sm:grid-cols-2 gap-4">
            {[
              ["9.988", "productos en el catálogo maestro para no digitar: buscas y pones tu precio", "from-teal-500 to-cyan-600"],
              ["15", "programas para droguerías revisados: ninguno cruza las alertas del INVIMA con tu inventario", "from-sky-500 to-blue-700"],
              ["0", "lotes vencidos vendidos: la caja no lo permite", "from-amber-400 to-orange-500"],
              ["1 clic", "para entrar a la demo, sin registro: computador, tableta o celular", "from-violet-500 to-indigo-600"],
            ].map(([n, d, g]) => (
              <li key={d} className={`rounded-3xl bg-gradient-to-br ${g} text-white p-6`}>
                <p className="num font-cond text-[52px] leading-none" style={{ fontWeight: 700 }}>{n}</p>
                <p className="mt-3 text-white/90 leading-relaxed">{d}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* 5. Funciones con capturas reales. */}
        <section className="bg-surface border-y border-line">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 lg:py-24">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <h2 className="font-cond text-[40px] sm:text-[52px] leading-[1] max-w-[14em]" style={{ fontWeight: 700 }}>Facturación y gestión, en un solo programa</h2>
              <Link href="/funciones" className="font-semibold text-teal-700 underline underline-offset-4">Ver todas las funciones</Link>
            </div>
            <div className="mt-10 grid md:grid-cols-2 gap-5">
              {funciones.map((f, i) => (
                <Link key={f.ruta} href={`/funciones/${f.ruta}`} className={`group rounded-3xl border border-line bg-paper p-5 sm:p-6 grid gap-4 hover:border-teal-600 hover:shadow-[0_24px_50px_-30px_rgba(14,116,144,.6)] transition ${i === 0 ? "md:col-span-2 md:grid-cols-[.9fr_1.1fr] items-center" : ""}`}>
                  <div>
                    <p className="text-sm font-semibold text-teal-700">{f.corto}</p>
                    <h3 className="font-cond text-[28px] leading-tight mt-1" style={{ fontWeight: 700 }}>{f.h1}</h3>
                    <p className="mt-2 text-muted leading-relaxed">{f.descripcion}</p>
                    <p className="mt-3 font-semibold underline underline-offset-4 group-hover:text-teal-700">Ver cómo funciona</p>
                  </div>
                  {CAPTURA[f.ruta] && <img src={CAPTURA[f.ruta]} alt={f.captura?.alt ?? f.h1} width={1440} height={900} loading="lazy" decoding="async" className="rounded-2xl border border-line w-full h-auto" />}
                </Link>
              ))}
            </div>
          </div>
        </section>

        {/* 6. El diferencial verificado. */}
        <section className="degradado-marca text-white">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14 grid lg:grid-cols-[1.2fr_1fr] gap-10 items-center">
            <h2 className="font-cond text-[34px] sm:text-[46px] leading-[1]" style={{ fontWeight: 700 }}>Revisamos 15 programas para droguerías en Colombia. Ninguno cruza las alertas del INVIMA con tu inventario.</h2>
            <div className="grid gap-4">
              <p className="text-white/90 text-lg">Regenta sí. Y además te dice qué pedir y qué se te va a vencer con tus propias ventas.</p>
              <div className="flex flex-wrap gap-3"><BotonDemo texto="Verlo en la demo" className="btn-cta h-12 px-6" /><Link href="/funciones/alertas-invima" className="btn-vidrio h-12 px-6">Cómo funciona</Link></div>
              <p className="text-sm text-white/60">Según lo que publican en sus páginas 15 programas de caja y facturación usados por droguerías en Colombia, revisados el 1 de noviembre de 2026.</p>
            </div>
          </div>
        </section>

        {/* 7. Para quién. */}
        <section className="max-w-6xl mx-auto px-4 sm:px-6 py-16 lg:py-24">
          <h2 className="font-cond text-[40px] sm:text-[52px] leading-[1]" style={{ fontWeight: 700 }}>Para todo el sector farmacéutico</h2>
          <ul className="mt-10 grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
            {[
              ["Droguerías", "Caja con POS y factura, venta por unidad, vencimientos y pedido.", "/para/droguerias", "border-t-teal-500"],
              ["Farmacias-droguerías", "Todo lo de la droguería, con el control por lote que pide la norma.", "/para/droguerias", "border-t-sky-500"],
              ["Distribuidoras", "Factura a clientes con NIT, crédito con plazo, cartera y bodega por lote.", "/para/distribuidoras", "border-t-amber-400"],
              ["Regentes y dueños", "Evidencia para la visita, alertas, ventas y ganancia desde el celular.", "/para/regentes", "border-t-violet-500"],
            ].map(([t, d, h, c]) => (
              <li key={t}><Link href={h} className={`tarjeta block h-full p-6 border-t-[6px] ${c} hover:shadow-[0_24px_50px_-30px_rgba(16,42,67,.5)] transition`}>
                <h3 className="font-cond text-[28px]" style={{ fontWeight: 700 }}>{t}</h3><p className="mt-2 text-muted leading-relaxed">{d}</p><p className="mt-4 font-semibold text-teal-700">Ver más</p>
              </Link></li>
            ))}
          </ul>
        </section>

        <section className="max-w-6xl mx-auto px-4 sm:px-6 pb-4">
          <p className="font-semibold text-muted">También te puede servir</p>
          <ul className="mt-3 flex flex-wrap gap-2">
            {[["/software/facturacion-electronica-sector-salud", "Software de facturación para el sector salud"], ["/software/pos-drogueria", "Software POS para droguería"], ["/software/farmacias", "Software para farmacias"], ["/software/inventario-farmacia", "Inventario de farmacia por lote"], ["/guias/facturacion-electronica-sector-salud-rips", "Facturación en salud y RIPS"]].map(([h, t]) => (
              <li key={h}><Link href={h} className="pastilla bg-surface border border-line hover:border-teal-600">{t}</Link></li>
            ))}
          </ul>
        </section>

        <Respaldo />

        {/* 8. La pérdida, con sus números. */}
        <section className="max-w-6xl mx-auto px-4 sm:px-6 py-16 lg:py-20">
          <div className="fondo-hero rounded-[32px] text-white p-6 sm:p-10">
            <h2 className="font-cond text-[36px] sm:text-[52px] leading-[1] max-w-[16em]" style={{ fontWeight: 700 }}>¿Cuánta plata se te vence al año?</h2>
            <p className="mt-3 text-white/70 text-lg max-w-2xl">Cada caja vencida es plata que ya pagaste y no vuelve. Haz la cuenta.</p>
            <div className="mt-8"><Calculadora precioMes={PLANES[0].precio!} /></div>
            <div className="mt-8 flex flex-wrap gap-3"><BotonDemo texto="Ver mis vencimientos en la demo" className="btn-cta h-14 px-7 text-lg" /><Link href="/precios" className="btn-vidrio h-14 px-6 text-lg">Ver planes</Link></div>
          </div>
        </section>

        {/* 9. Planes. */}
        <section className="bg-surface border-y border-line">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 lg:py-20">
            <div className="flex flex-wrap items-end justify-between gap-4">
              <h2 className="font-cond text-[40px] sm:text-[52px] leading-[1]" style={{ fontWeight: 700 }}>Desde {pesos(PLANES[0].precio!)} al mes. O gratis.</h2>
              <p className="text-muted max-w-md">Certificado digital y habilitación DIAN incluidos. Precios de lanzamiento, sin instalación ni permanencia. Con el {SOCIO.nombre}, si le compras a Farmagenéricos, puede salirte gratis.</p>
            </div>
            <div className="mt-8"><IncluyeTodo /></div>
            <ul className="mt-8 grid md:grid-cols-3 gap-5">
              {PLANES.map((pl) => (
                <li key={pl.id} className={`rounded-3xl p-6 sm:p-7 flex flex-col ${pl.destacado ? "degradado-marca text-white shadow-[0_30px_60px_-30px_rgba(14,116,144,.8)]" : "bg-paper border border-line"}`}>
                  <p className="font-cond text-[28px]" style={{ fontWeight: 700 }}>{pl.nombre}{pl.destacado && <span className="ml-2 align-middle pastilla h-7 text-[12px] bg-amber-300 text-[#0b1f33]">Recomendado</span>}</p>
                  <p className={`text-sm ${pl.destacado ? "text-white/75" : "text-muted"}`}>{pl.para}</p>
                  <p className="mt-4 num font-cond text-[44px] leading-none" style={{ fontWeight: 700 }}>{pl.precio ? pesos(pl.precio) : "A medida"}<span className={`text-base font-sans ${pl.destacado ? "text-white/70" : "text-muted"}`} style={{ fontWeight: 400 }}>{pl.precio ? " / mes" : ""}</span></p>
                  {pl.precio && <p className={`mt-2 text-sm font-semibold ${pl.destacado ? "text-amber-200" : "text-teal-700"}`}>o {pesos(mesAnual(pl.precio))}/mes pagando el año</p>}
                  <ul className={`mt-5 grid content-start gap-2 text-[15px] flex-1 ${pl.destacado ? "text-white/90" : ""}`}>{pl.incluye.map((x) => <li key={x} className="flex gap-2"><span className={pl.destacado ? "text-amber-300" : "text-teal-600"} aria-hidden="true">✓</span>{x}</li>)}</ul>
                  <div className="mt-6 grid gap-2">
                    {pl.precio ? <Link href={`/contratar?plan=${pl.id}`} className={`${pl.destacado ? "btn-cta" : "btn-oscuro"} h-12`}>Contratar {pl.nombre}</Link>
                      : <a href={wa("Hola, quiero cotizar Regenta plan Cadena para mi distribuidora o mis sedes.")} className="btn-oscuro h-12">Cotizar por WhatsApp</a>}
                    <BotonDemo texto="Probar antes gratis" className={`${pl.destacado ? "btn-vidrio" : "btn-borde"} h-11 w-full`} />
                  </div>
                </li>
              ))}
            </ul>
            <p className="mt-6 text-center"><Link href="/precios#socio" className="font-semibold text-teal-700 underline underline-offset-4">Ver cuánto pagas como socio de Farmagenéricos</Link></p>
          </div>
        </section>

        {/* 10. Guías (silo SEO). */}
        <section className="max-w-6xl mx-auto px-4 sm:px-6 py-14">
          <div className="flex flex-wrap items-end justify-between gap-3"><h2 className="font-cond text-[32px] sm:text-[42px] leading-[1]" style={{ fontWeight: 700 }}>Guías para regentes, dueños y distribuidores</h2><Link href="/guias" className="font-semibold text-teal-700 underline underline-offset-4">Ver las {GUIAS.length} guías</Link></div>
          <ul className="mt-6 grid sm:grid-cols-2 lg:grid-cols-3 gap-3">
            {GUIAS.slice(0, 9).map((g) => <li key={g.slug}><Link href={`/guias/${g.slug}`} className="block rounded-2xl bg-surface border border-line p-4 h-full hover:border-teal-600"><span className="font-semibold">{g.h1}</span></Link></li>)}
          </ul>
        </section>

        <section id="preguntas" className="max-w-3xl mx-auto px-4 sm:px-6 py-16 lg:py-20">
          <h2 className="font-cond text-[36px] sm:text-[48px] leading-[1]" style={{ fontWeight: 700 }}>Preguntas antes de probar</h2>
          <div className="mt-8 divide-y divide-line border-y border-line">
            {PREGUNTAS.map(([q, a]) => (
              <details key={q} className="group py-4">
                <summary className="cursor-pointer list-none flex justify-between gap-4 font-semibold text-lg">{q}<span className="text-teal-600 text-2xl leading-none group-open:rotate-45 transition-transform" aria-hidden="true">+</span></summary>
                <p className="mt-2 text-muted leading-relaxed">{a}</p>
              </details>
            ))}
          </div>
        </section>

        {/* 11. Cierre. */}
        <section id="demo" className="fondo-hero text-white scroll-mt-16 relative overflow-hidden">
          <div className="rejilla absolute inset-0" aria-hidden="true" />
          <div className="relative max-w-6xl mx-auto px-4 sm:px-6 py-16 lg:py-20 grid lg:grid-cols-[1fr_1fr] gap-12">
            <div>
              <h2 className="font-cond text-[42px] sm:text-[60px] leading-[0.95]" style={{ fontWeight: 700 }}>Deja de perder plata en vencidos y agotados desde esta semana.</h2>
              <p className="mt-5 text-lg text-white/75 max-w-[28em]">Entra a la demo en un clic, o déjanos tus datos y te mostramos Regenta con tus propios productos en 20 minutos.</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <BotonDemo texto="Probar gratis ahora" className="btn-cta h-14 px-8 text-lg" />
                <a href={WA} className="btn-vidrio h-14 px-6 text-lg">Hablar por WhatsApp</a>
              </div>
              <div className="mt-8"><Sello oscuro /></div>
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
