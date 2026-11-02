import type { Metadata } from "next";
import Link from "next/link";
import { CabeceraPublica } from "@/components/landing/Cabecera";
import { Pie } from "@/components/landing/Pie";
import { BotonDemo } from "@/components/landing/BotonDemo";
import { FormDemo } from "@/components/landing/FormDemo";
import { Oferta } from "@/components/landing/Oferta";
import { Sello } from "@/components/landing/Sello";
import { BarraMovil } from "@/components/landing/BarraMovil";
import { GARANTIA_DIAS } from "@/lib/oferta";
import { PLANES } from "@/lib/planes";
import { pesos } from "@/lib/formato";
import { wa } from "@/lib/sitio";

// A donde llega quien sale de la demo: la oferta para cerrar, no la pantalla de entrar.
export const metadata: Metadata = { title: "Ya probaste Regenta", robots: { index: false, follow: true } };

const OBJECIONES: [string, string][] = [
  ["¿Y si no me sirve?", `Tienes ${GARANTIA_DIAS} días de garantía: si en tu primer mes Regenta no le sirve a tu droguería, te devolvemos lo que pagaste. Sin permanencia: cancelas cuando quieras.`],
  ["Ya tengo un programa, ¿pierdo lo que tengo?", "No. Te ayudamos a pasar tus productos desde un Excel, y con el catálogo maestro de 9.988 productos solo buscas y pones tu precio."],
  ["¿Mi cajera va a aprender?", "Es una caja de buscar, Enter y cobrar. La capacitación a tu equipo va incluida y la da gente del sector."],
  ["¿Necesito comprar el certificado digital?", "No. El certificado de firma y la habilitación de tu NIT ante la DIAN van incluidos en el plan."],
  ["¿Y si la DIAN se cae?", "La venta se registra igual y el documento queda en cola: se envía solo cuando la DIAN vuelve a responder. Tu mostrador no se detiene."],
  ["No facturar electrónicamente, ¿qué me puede pasar?", "No expedir factura estando obligado se sanciona con el cierre del establecimiento por tres días (artículo 657 del Estatuto Tributario)."],
];

export default function GraciasDemo() {
  return (
    <div className="bg-paper text-ink pb-20 sm:pb-0">
      <CabeceraPublica />
      <main>
        <section className="fondo-hero text-white relative overflow-hidden">
          <div className="rejilla absolute inset-0" aria-hidden="true" />
          <div className="relative max-w-6xl mx-auto px-4 sm:px-6 py-12 lg:py-16 grid lg:grid-cols-[1.2fr_.8fr] gap-10 items-center">
            <div>
              <p className="pastilla bg-emerald-400/15 border border-emerald-300/40 text-emerald-200">✓ Saliste de la droguería de demostración</p>
              <h1 className="mt-4 font-cond text-[42px] sm:text-[64px] leading-[0.95]" style={{ fontWeight: 700 }}>Lo que acabas de ver puede estar en tu mostrador esta semana.</h1>
              <p className="mt-5 text-lg sm:text-xl text-white/80 max-w-[32em]">Mismo programa, con tus productos y tu NIT: facturas ante la DIAN, vendes primero lo que vence antes y la caja nunca vende un lote vencido.</p>
              <div className="mt-8 flex flex-wrap gap-3">
                <Link href="/contratar?plan=pro&origen=salida-demo" className="btn-cta h-14 px-8 text-lg">Contratar ahora</Link>
                <a href={wa("Hola, acabo de probar la demo de Regenta y quiero ponerlo en mi droguería.")} className="btn-vidrio h-14 px-6 text-lg">Que me llamen por WhatsApp</a>
              </div>
              <p className="mt-4 text-white/65">Desde {pesos(PLANES[0].precio!)} al mes · certificado y habilitación DIAN incluidos · {GARANTIA_DIAS} días de garantía · sin permanencia</p>
            </div>
            <div className="rounded-3xl bg-white/[.06] border border-white/15 p-6">
              <p className="font-cond text-2xl" style={{ fontWeight: 700 }}>Cómo arrancas</p>
              <ol className="mt-4 grid gap-4">
                {[["Hoy", "Contratas en línea en dos minutos."], ["En 24 horas", "Te escribimos por WhatsApp y creamos tu cuenta con tus productos."], ["Esta semana", "Capacitamos a tu equipo y dejamos tu NIT habilitado ante la DIAN."]].map(([c, t]) => (
                  <li key={c} className="flex gap-3"><span className="shrink-0 w-24 font-semibold text-amber-300">{c}</span><span className="text-white/85">{t}</span></li>
                ))}
              </ol>
              <div className="mt-5"><BotonDemo texto="Volver a la demo" className="btn-vidrio h-11 w-full" /></div>
            </div>
          </div>
        </section>

        <section className="max-w-6xl mx-auto px-4 sm:px-6 py-14"><Oferta origen="salida-demo" demo={false} /></section>

        <section className="max-w-3xl mx-auto px-4 sm:px-6 pb-14">
          <h2 className="font-cond text-[34px] sm:text-[44px] leading-[1]" style={{ fontWeight: 700 }}>Lo que nos preguntan antes de contratar</h2>
          <div className="mt-6 divide-y divide-line border-y border-line">
            {OBJECIONES.map(([q, a]) => (
              <details key={q} className="group py-4">
                <summary className="cursor-pointer list-none flex justify-between gap-4 font-semibold text-lg py-1">{q}<span className="text-teal-600 text-2xl leading-none group-open:rotate-45 transition-transform" aria-hidden="true">+</span></summary>
                <p className="mt-2 text-muted leading-relaxed">{a}</p>
              </details>
            ))}
          </div>
        </section>

        <section className="fondo-hero text-white">
          <div className="max-w-6xl mx-auto px-4 sm:px-6 py-14 grid lg:grid-cols-2 gap-10">
            <div>
              <h2 className="font-cond text-[36px] sm:text-[48px] leading-[1]" style={{ fontWeight: 700 }}>¿Prefieres que te lo mostremos con tus productos?</h2>
              <p className="mt-4 text-white/75 text-lg">Déjanos tus datos y en 20 minutos te enseñamos Regenta con tu droguería. Sin compromiso.</p>
              <div className="mt-6"><Sello oscuro /></div>
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
