import type { Metadata } from "next";
import Link from "next/link";
import { Marca, Isotipo } from "@/components/Marca";
import { Tiquete } from "@/components/landing/Tiquete";
import { FormDemo } from "@/components/landing/FormDemo";
import { CORREO, SITIO, TELEFONO, wa } from "@/lib/sitio";

const TITULO = "Regenta: software POS para droguerías con inventario por lote y vencimiento";
const DESCRIPCION = "Programa de caja para droguerías y farmacias en Colombia: vende por caja o por unidad, sale primero el lote que vence antes, carga tus productos desde un catálogo de casi 10.000 referencias o desde Excel. En la nube, sin instalar nada.";

export const metadata: Metadata = {
  title: { absolute: TITULO },
  description: DESCRIPCION,
  alternates: { canonical: "/" },
  robots: { index: true, follow: true },
  openGraph: { type: "website", locale: "es_CO", siteName: "Regenta", title: TITULO, description: DESCRIPCION, url: "/", images: [{ url: "/capturas/og.png", width: 1200, height: 630 }] },
  twitter: { card: "summary_large_image", title: TITULO, description: DESCRIPCION, images: ["/capturas/og.png"] },
};

const PREGUNTAS: [string, string][] = [
  ["¿Regenta sirve para una droguería pequeña de una sola caja?", "Sí. Está pensada para el mostrador de barrio: una pantalla para vender, otra para recibir mercancía y un inicio que te dice qué se vence y qué se acabó. Si creces a varias cajas, cada usuario entra con su propio rol."],
  ["¿Puedo vender pastillas sueltas o por blíster?", "Sí. Cada producto tiene precio por caja y, si quieres, precio por unidad. En la caja eliges cómo lo vendes y el inventario descuenta las unidades exactas."],
  ["¿Cómo controla los vencimientos?", "Cada entrada de mercancía se registra con su lote y fecha de vencimiento. Al vender, Regenta descuenta primero el lote que vence antes, y en la caja te muestra lo que conviene vender pronto."],
  ["¿Tengo que digitar todos mis productos?", "No. Buscas en el catálogo Regenta de casi 10.000 productos (con código de barras en la mayoría) y solo pones tu precio. Si ya tienes tu lista en Excel, la subes completa con existencias, lote y vencimiento."],
  ["¿Hace factura electrónica ante la DIAN?", "La emisión del documento equivalente POS electrónico y de la factura electrónica se está integrando con un proveedor tecnológico autorizado por la DIAN. Cada venta ya queda numerada con tu resolución y en cola para enviarse; en la demostración te mostramos el estado exacto."],
  ["¿Hay que instalar algo? ¿Funciona en el celular?", "No se instala nada: entras desde el navegador del computador de la caja, una tableta o el celular. Tus datos quedan en la nube y cada droguería solo ve los suyos."],
  ["¿Mis cajeros pueden ver costos o borrar ventas?", "No. La cajera vende y ve sus ventas; los costos y la utilidad solo los ve el dueño o el administrador. Ninguna venta se borra: se anula con motivo y queda registrado quién lo hizo."],
  ["¿Cuánto cuesta?", "Estamos abriendo Regenta con las primeras droguerías. Pide la demostración y te damos el plan según tus cajas y tu volumen de ventas."],
];

const PASOS: [string, string][] = [
  ["Te creamos la cuenta", "Con el NIT, la razón social y tu resolución de numeración. Te ayudamos por WhatsApp."],
  ["Cargas tus productos", "Del catálogo Regenta o desde tu Excel, con existencias, lote y vencimiento."],
  ["Vendes", "Escanea, cobra en efectivo, Nequi, Daviplata, tarjeta, transferencia o Bre-B y entrega el tiquete."],
];

function Captura({ src, alt, ancho = 1440, alto = 900 }: { src: string; alt: string; ancho?: number; alto?: number }) {
  return (
    <div className="rounded-[18px] bg-ink p-1.5 shadow-[0_30px_60px_-30px_rgba(16,42,67,.55)]">
      <img src={src} alt={alt} width={ancho} height={alto} loading="lazy" decoding="async" className="rounded-[13px] w-full h-auto bg-paper" />
    </div>
  );
}

export default function Portada() {
  const ld = [
    { "@context": "https://schema.org", "@type": "SoftwareApplication", name: "Regenta", applicationCategory: "BusinessApplication", applicationSubCategory: "Punto de venta para droguerías",
      operatingSystem: "Web", inLanguage: "es-CO", description: DESCRIPCION, url: SITIO,
      publisher: { "@type": "Organization", name: "Farmagenéricos Colombia", email: CORREO, telephone: TELEFONO },
      featureList: ["Caja POS con lector de código de barras", "Venta por caja o por unidad", "Inventario por lote y vencimiento", "Carga de productos desde Excel", "Usuarios con roles", "Medios de pago: efectivo, Nequi, Daviplata, tarjeta, transferencia y Bre-B"] },
    { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: PREGUNTAS.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) },
  ];

  return (
    <div className="bg-paper text-ink">
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(ld) }} />

      <header className="max-w-6xl mx-auto px-4 sm:px-6 h-20 flex items-center justify-between gap-4">
        <Link href="/" aria-label="Regenta, inicio"><Marca /></Link>
        <nav className="flex items-center gap-2 sm:gap-5 text-[15px]" aria-label="Página">
          <a href="#como-funciona" className="hidden md:inline font-medium hover:underline">Cómo funciona</a>
          <a href="#preguntas" className="hidden md:inline font-medium hover:underline">Preguntas</a>
          <Link href="/entrar" className="font-semibold hover:underline px-2">Entrar</Link>
          <a href="#demo" className="btn-oscuro h-10 px-4 whitespace-nowrap">Pedir demo</a>
        </nav>
      </header>

      <main>
        {/* Portada: el tiquete es la promesa. */}
        <section className="max-w-6xl mx-auto px-4 sm:px-6 pt-6 pb-16 lg:pb-24 grid lg:grid-cols-[1.15fr_.85fr] gap-12 items-center">
          <div>
            <p className="font-semibold text-cruz">Programa de caja e inventario para droguerías</p>
            <h1 className="font-cond text-[46px] sm:text-[72px] lg:text-[84px] leading-[0.92] tracking-[-0.02em] mt-3" style={{ fontWeight: 700 }}>
              La caja que sabe qué lote vence primero.
            </h1>
            <p className="mt-6 text-lg sm:text-xl text-muted max-w-[34em] leading-relaxed">
              Regenta vende por caja o por pastilla, descuenta el lote que vence antes y te avisa lo que se está acabando. Todo en la nube, desde el computador del mostrador o el celular.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <a href="#demo" className="btn-primario h-13 px-7 text-lg" style={{ height: 52 }}>Pedir demostración</a>
              <a href={wa("Hola, quiero conocer Regenta para mi droguería.")} className="btn-borde text-lg" style={{ height: 52 }}>Escribir por WhatsApp</a>
            </div>
            <p className="mt-5 text-sm text-muted">Hecho en Colombia por Farmagenéricos Colombia, distribuidor farmacéutico.</p>
          </div>
          <div className="flex justify-center lg:justify-end pb-4"><Tiquete /></div>
        </section>

        {/* Tres problemas del mostrador, contados como pasan. */}
        <section className="bg-ink text-white">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 lg:py-20">
            <h2 className="font-cond text-[36px] sm:text-[48px] leading-[1] max-w-[18em]" style={{ fontWeight: 700 }}>Hecho para lo que pasa detrás del mostrador de una droguería.</h2>
            <div className="mt-10 grid md:grid-cols-3 gap-x-8 gap-y-10">
              {[
                ["Se vence la mercancía en el cajón", "Cada entrada lleva lote y vencimiento. Al vender sale primero el que vence antes, y la caja te muestra lo que conviene mover esta semana."],
                ["El cliente pide tres pastillas", "Precio por caja y precio por unidad en el mismo producto. Vendes suelto sin descuadrar el inventario."],
                ["No sabes cuánto se vendió hoy", "El inicio te dice ventas del día, medios de pago, utilidad y qué está bajo el mínimo, sin abrir una hoja de cálculo."],
              ].map(([t, d]) => (
                <div key={t} className="border-t-2 border-marca pt-4">
                  <h3 className="font-cond text-2xl" style={{ fontWeight: 600 }}>{t}</h3>
                  <p className="mt-2 text-white/75 leading-relaxed">{d}</p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {/* El producto, con capturas reales. */}
        <section className="max-w-6xl mx-auto px-4 sm:px-6 py-16 lg:py-24 grid gap-20">
          <article className="grid lg:grid-cols-[.8fr_1.2fr] gap-10 items-center">
            <div>
              <h2 className="font-cond text-[34px] sm:text-[44px] leading-[1.02]" style={{ fontWeight: 700 }}>Una caja que se aprende en cinco minutos.</h2>
              <p className="mt-4 text-lg text-muted leading-relaxed">Escaneas o escribes dos letras, eliges caja o unidad y cobras. Teclas rápidas para el mostrador con fila: <kbd>F2</kbd> buscar, <kbd>F9</kbd> cobrar. El cambio sale calculado.</p>
              <ul className="mt-5 grid gap-2 text-[17px]">
                <li>Efectivo, Nequi, Daviplata, tarjeta, transferencia o Bre-B.</li>
                <li>Si se cae la red a mitad del cobro, la venta no se duplica.</li>
                <li>Cada venta queda con su número de resolución.</li>
              </ul>
            </div>
            <Captura src="/capturas/caja.webp" alt="Pantalla de la caja de Regenta con productos en el tiquete y el panel de cobro" />
          </article>

          <article className="grid lg:grid-cols-[1.2fr_.8fr] gap-10 items-center">
            <div className="lg:order-2">
              <h2 className="font-cond text-[34px] sm:text-[44px] leading-[1.02]" style={{ fontWeight: 700 }}>Vencimientos a la vista, no en un cuaderno.</h2>
              <p className="mt-4 text-lg text-muted leading-relaxed">El inventario se ordena por lo que vence primero, con semáforo: rojo a 30 días, ámbar a 90. Recibes la mercancía del proveedor escaneando cada producto y poniendo lote, vencimiento y cantidad.</p>
            </div>
            <div className="lg:order-1"><Captura src="/capturas/inventario.webp" alt="Inventario de Regenta ordenado por vencimiento, con lotes en rojo y ámbar" /></div>
          </article>

          <article className="grid lg:grid-cols-[.8fr_1.2fr] gap-10 items-center">
            <div>
              <h2 className="font-cond text-[34px] sm:text-[44px] leading-[1.02]" style={{ fontWeight: 700 }}>Tus productos cargados en una tarde.</h2>
              <p className="mt-4 text-lg text-muted leading-relaxed">Busca en el catálogo Regenta de casi 10.000 productos y solo pon tu precio. ¿Ya tienes tu lista? Súbela en Excel: antes de guardar ves fila por fila qué se crea, qué se actualiza y qué tiene errores.</p>
            </div>
            <Captura src="/capturas/importar.webp" alt="Carga de productos desde Excel con vista previa de lo que se va a crear" />
          </article>

          <article className="grid lg:grid-cols-[1.2fr_.8fr] gap-10 items-center">
            <div className="lg:order-2">
              <h2 className="font-cond text-[34px] sm:text-[44px] leading-[1.02]" style={{ fontWeight: 700 }}>Cada quien ve lo suyo.</h2>
              <p className="mt-4 text-lg text-muted leading-relaxed">El dueño ve ventas, utilidad y costos. La cajera vende. Bodega recibe mercancía y ajusta inventario con motivo. Nada se borra: las ventas se anulan con razón y queda quién lo hizo y cuándo.</p>
            </div>
            <div className="lg:order-1"><Captura src="/capturas/inicio.webp" alt="Inicio del dueño en Regenta con ventas del día, utilidad y productos por revisar" /></div>
          </article>
        </section>

        <section id="como-funciona" className="bg-surface border-y border-line">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 lg:py-20">
            <h2 className="font-cond text-[36px] sm:text-[48px] leading-[1]" style={{ fontWeight: 700 }}>Así empiezas</h2>
            <ol className="mt-10 grid md:grid-cols-3 gap-8">
              {PASOS.map(([t, d], i) => (
                <li key={t} className="flex gap-4">
                  <span className="font-cond text-[56px] leading-[0.8] text-cruz num" style={{ fontWeight: 700 }} aria-hidden="true">{i + 1}</span>
                  <div><h3 className="font-cond text-2xl" style={{ fontWeight: 600 }}>{t}</h3><p className="mt-1.5 text-muted leading-relaxed">{d}</p></div>
                </li>
              ))}
            </ol>
          </div>
        </section>

        {/* Estado del producto, sin maquillaje. */}
        <section className="max-w-6xl mx-auto px-4 sm:px-6 py-16 lg:py-20 grid lg:grid-cols-2 gap-10">
          <div>
            <h2 className="font-cond text-[36px] sm:text-[48px] leading-[1]" style={{ fontWeight: 700 }}>Lo que ya hace y lo que viene</h2>
            <p className="mt-4 text-lg text-muted max-w-[30em]">Regenta está abriendo con sus primeras droguerías. Preferimos decirte exactamente en qué punto está.</p>
          </div>
          <div className="grid sm:grid-cols-2 gap-6">
            <div>
              <h3 className="font-cond text-2xl text-cruz" style={{ fontWeight: 700 }}>Funciona hoy</h3>
              <ul className="mt-3 grid gap-2">{["Caja con lector de código de barras", "Venta por caja y por unidad", "Lotes y vencimientos", "Recibir mercancía y ajustes", "Carga desde Excel", "Ventas del día y anulaciones", "Usuarios por rol"].map((x) => <li key={x} className="border-b border-line pb-2">{x}</li>)}</ul>
            </div>
            <div>
              <h3 className="font-cond text-2xl text-aviso" style={{ fontWeight: 700 }}>En integración</h3>
              <ul className="mt-3 grid gap-2">{["Envío a la DIAN del POS electrónico y la factura electrónica, con proveedor tecnológico autorizado", "Clientes y ventas a crédito", "Varias sedes", "Vender sin internet"].map((x) => <li key={x} className="border-b border-line pb-2">{x}</li>)}</ul>
            </div>
          </div>
        </section>

        <section id="preguntas" className="max-w-3xl mx-auto px-4 sm:px-6 pb-16 lg:pb-24">
          <h2 className="font-cond text-[36px] sm:text-[48px] leading-[1]" style={{ fontWeight: 700 }}>Preguntas de dueños de droguería</h2>
          <div className="mt-8 divide-y divide-line border-y border-line">
            {PREGUNTAS.map(([q, a]) => (
              <details key={q} className="group py-4">
                <summary className="cursor-pointer list-none flex justify-between gap-4 font-semibold text-lg">{q}<span className="text-cruz text-2xl leading-none group-open:rotate-45 transition-transform" aria-hidden="true">+</span></summary>
                <p className="mt-2 text-muted leading-relaxed">{a}</p>
              </details>
            ))}
          </div>
        </section>

        <section id="demo" className="bg-ink text-white scroll-mt-4">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 lg:py-20 grid lg:grid-cols-[.9fr_1.1fr] gap-12">
            <div>
              <h2 className="font-cond text-[40px] sm:text-[56px] leading-[0.95]" style={{ fontWeight: 700 }}>Mírala funcionando con tus productos.</h2>
              <p className="mt-5 text-lg text-white/75 max-w-[28em]">En 20 minutos por videollamada o en tu droguería: cargamos algunos de tus productos y haces una venta de prueba.</p>
              <div className="mt-8 grid gap-2 text-white/85">
                <a href={wa("Hola, quiero una demostración de Regenta.")} className="font-semibold hover:underline">WhatsApp {TELEFONO}</a>
                <a href={`mailto:${CORREO}`} className="hover:underline">{CORREO}</a>
              </div>
            </div>
            <FormDemo />
          </div>
        </section>
      </main>

      <footer className="max-w-6xl mx-auto px-4 sm:px-6 py-10 flex flex-wrap items-center justify-between gap-4 text-sm text-muted">
        <span className="inline-flex items-center gap-2"><Isotipo size={24} /> Regenta by Farmagenéricos Colombia</span>
        <span>{CORREO} · {TELEFONO}</span>
      </footer>
    </div>
  );
}
