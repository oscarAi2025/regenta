import type { Metadata } from "next";
import Link from "next/link";
import { CabeceraPublica } from "@/components/landing/Cabecera";
import { Pie } from "@/components/landing/Pie";
import { BarraMovil } from "@/components/landing/BarraMovil";
import { BotonDemo } from "@/components/landing/BotonDemo";
import { wa } from "@/lib/sitio";

export const metadata: Metadata = {
  title: { absolute: "Por qué Regenta: hecho por un distribuidor farmacéutico" },
  description: "Regenta lo hace Farmagenéricos Colombia, distribuidor que surte droguerías. Conocemos el mostrador por dentro y lo convertimos en software con IA.",
  alternates: { canonical: "/por-que-regenta" }, robots: { index: true, follow: true },
};

export default function PorQue() {
  return (
    <div className="bg-paper text-ink min-h-screen pb-20 sm:pb-0">
      <CabeceraPublica />
      <main>
        <section className="bg-ink text-white">
          <div className="max-w-4xl mx-auto px-4 sm:px-6 pt-12 pb-16">
            <h1 className="font-cond text-[46px] sm:text-[72px] leading-[0.92]" style={{ fontWeight: 700 }}>Los programas genéricos no saben lo que es un lote. Nosotros vivimos de eso.</h1>
            <p className="mt-6 text-xl text-white/75 leading-relaxed">Regenta lo hace Farmagenéricos Colombia, un distribuidor farmacéutico que surte droguerías. No llegamos al sector desde afuera: llegamos al software desde el sector.</p>
          </div>
        </section>
        <article className="max-w-3xl mx-auto px-4 sm:px-6 py-14 grid gap-10 text-[18px] leading-relaxed">
          <section>
            <h2 className="font-cond text-[34px] leading-tight" style={{ fontWeight: 700 }}>Lo que vemos todos los días</h2>
            <p className="mt-3">Como distribuidor, estamos del otro lado del pedido de las droguerías. Vemos el pedido que llega tarde porque nadie notó que el producto se acababa, la devolución de lo que se venció en la estantería, la urgencia cuando sale una alerta del INVIMA y hay que saber si ese lote está en el mostrador.</p>
            <p className="mt-3">Cada una de esas situaciones es plata que la droguería pierde. Y casi siempre el programa de caja tenía los datos para evitarlo, pero no los usaba.</p>
          </section>
          <section>
            <h2 className="font-cond text-[34px] leading-tight" style={{ fontWeight: 700 }}>Lo que hicimos distinto</h2>
            <ul className="mt-3 grid gap-3 list-disc pl-5">
              <li><b>El lote está en el centro.</b> Cada entrada, venta y ajuste lleva lote y vencimiento; la caja vende primero lo que vence antes y nunca vende lo vencido.</li>
              <li><b>Los datos trabajan solos.</b> Con tus ventas, Regenta calcula qué pedir, qué no alcanzarás a vender antes de su fecha y qué no rota.</li>
              <li><b>El regulador, conectado.</b> Las alertas sanitarias del INVIMA se cruzan con tu inventario y queda la evidencia de lo que hiciste.</li>
              <li><b>Inteligencia artificial que responde con tus cifras.</b> Le preguntas a Regenta IA como a tu regente; ella consulta tus datos, con tus permisos, y te dice de dónde sale cada número.</li>
              <li><b>Nada se borra.</b> Ventas anuladas con motivo, ajustes con motivo, quién hizo qué y cuándo. Así se trabaja en un sector vigilado.</li>
            </ul>
          </section>
          <section>
            <h2 className="font-cond text-[34px] leading-tight" style={{ fontWeight: 700 }}>Y nos conviene que te vaya bien</h2>
            <p className="mt-3">Si tu droguería vende más y bota menos, nos compra mejor. Por eso existe el <Link href="/precios#socio" className="text-cruz underline">Plan Socio Farmagenéricos</Link>: si nos compras, Regenta te puede salir gratis.</p>
          </section>
          <section className="rounded-2xl bg-ink text-white p-6">
            <p className="font-cond text-[30px] leading-tight" style={{ fontWeight: 700 }}>Compruébalo tú: entra a la demo y mira lo que Regenta le dice a una droguería con 8 semanas de ventas.</p>
            <div className="mt-5 flex flex-wrap gap-3"><BotonDemo texto="Probar la demo gratis" className="btn-primario h-12 px-6" /><a href={wa("Hola, quiero conocer Regenta.")} className="btn h-12 px-6 border-2 border-white/30 text-white">Hablar por WhatsApp</a></div>
          </section>
        </article>
      </main>
      <Pie />
      <BarraMovil />
    </div>
  );
}
