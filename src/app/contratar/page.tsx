import type { Metadata } from "next";
import Link from "next/link";
import { CabeceraPublica } from "@/components/landing/Cabecera";
import { Pie } from "@/components/landing/Pie";
import { Sello } from "@/components/landing/Sello";
import { metaPublica } from "@/lib/seo";
import { PLANES, SOCIO } from "@/lib/planes";
import { qrActivo, stripeActivo, wompiActivo } from "@/lib/pagos";
import { wa } from "@/lib/sitio";
import { FormContratar } from "./FormContratar";
import { GARANTIA, GARANTIA_DIAS, PILA_VALOR, PRECIO_CONGELADO } from "@/lib/oferta";

// La descripción solo nombra la tarjeta cuando Stripe está activo (no prometer un medio de pago que no está).
export function generateMetadata(): Metadata {
  return stripeActivo()
    ? metaPublica("/contratar", "Contratar Regenta: paga con QR Bancolombia o tarjeta", "Contrata Regenta en línea: paga con el QR Bancolombia desde cualquier banco, Nequi o Daviplata, o con tarjeta. Plan mensual o anual con 2 meses gratis.")
    : metaPublica("/contratar", "Contratar Regenta en línea: paga con QR Bancolombia", "Contrata Regenta en línea: paga con el QR Bancolombia desde cualquier banco, Nequi o Daviplata. Plan mensual o anual con 2 meses gratis.");
}
export const dynamic = "force-dynamic";

export default async function Contratar({ searchParams }: { searchParams: Promise<{ plan?: string; cancelado?: string }> }) {
  const sp = await searchParams;
  const plan = sp.plan === "esencial" ? "esencial" : "pro";
  const activos = { qr: qrActivo(), wompi: wompiActivo(), stripe: stripeActivo() };
  return (
    <div className="bg-paper text-ink min-h-screen">
      <CabeceraPublica />
      <main>
        <section className="fondo-hero text-white relative overflow-hidden">
          <div className="rejilla absolute inset-0" aria-hidden="true" />
          <div className="relative max-w-6xl mx-auto px-4 sm:px-6 pt-10 pb-12">
            <nav aria-label="Ruta" className="text-sm text-white/60"><Link href="/" className="hover:underline">Regenta</Link> / <Link href="/precios" className="hover:underline">Tarifas</Link> / Contratar</nav>
            <h1 className="mt-3 font-cond text-[42px] sm:text-[60px] leading-[0.95]" style={{ fontWeight: 700 }}>Contrata Regenta en dos minutos</h1>
            <p className="mt-4 text-lg text-white/75 max-w-2xl">Eliges el plan, pagas en línea y te escribimos para activar tu cuenta y cargar tus productos. Sin permanencia: cancelas cuando quieras.</p>
            <ul className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-white/85">
              {[`${GARANTIA_DIAS} días de garantía`, "Certificado y habilitación DIAN incluidos", "Capacitación incluida", "Sin permanencia"].map((t) => <li key={t} className="flex gap-2"><span className="text-amber-300 font-bold" aria-hidden="true">✓</span>{t}</li>)}
            </ul>
          </div>
        </section>
        <section className="max-w-6xl mx-auto px-4 sm:px-6 py-10 grid lg:grid-cols-[1.15fr_.85fr] gap-8 items-start">
          {sp.cancelado && <p role="status" className="lg:col-span-2 rounded-2xl bg-aviso-soft text-aviso px-4 py-3 font-semibold">El pago se canceló y no se cobró nada. Puedes intentarlo de nuevo cuando quieras.</p>}
          {activos.qr || activos.wompi || activos.stripe ? <FormContratar plan={plan} activos={activos} planes={PLANES.filter((p) => p.precio).map((p) => ({ id: p.id as "esencial" | "pro", nombre: p.nombre, precio: p.precio!, para: p.para }))} /> : (
            <div className="tarjeta p-6 sm:p-8">
              <h2 className="font-cond text-3xl" style={{ fontWeight: 700 }}>Contrata por WhatsApp</h2>
              <p className="mt-3 text-muted text-lg">El pago en línea se está activando. Mientras tanto te enviamos el enlace de pago por WhatsApp y activamos tu cuenta el mismo día.</p>
              <a href={wa(`Hola, quiero contratar Regenta plan ${plan === "pro" ? "Pro" : "Esencial"}.`)} className="btn-cta h-14 px-8 text-lg mt-6">Contratar por WhatsApp</a>
            </div>
          )}
          <aside className="grid gap-4">
            <div className="rounded-3xl border-2 border-amber-300 bg-amber-50 p-6 flex gap-4 items-start">
              <span className="shrink-0 size-14 rounded-full bg-amber-400 text-[#0b1f33] grid place-items-center font-cond text-2xl" style={{ fontWeight: 700 }} aria-hidden="true">{GARANTIA_DIAS}</span>
              <div><p className="font-cond text-2xl leading-tight" style={{ fontWeight: 700 }}>Riesgo cero</p><p className="mt-1 text-[15px]">{GARANTIA}</p><p className="mt-2 text-sm text-muted">{PRECIO_CONGELADO}</p></div>
            </div>
            <div className="tarjeta p-6">
              <h2 className="font-cond text-2xl" style={{ fontWeight: 700 }}>Lo que recibes</h2>
              <ul className="mt-3 grid gap-2 text-[15px]">
                {PILA_VALOR.map((v) => <li key={v.que} className="flex gap-2"><span className="text-teal-600 font-bold" aria-hidden="true">✓</span><span>{v.que}{v.aparte && <span className="text-muted"> (aparte cuesta {v.aparte})</span>}</span></li>)}
              </ul>
            </div>
            <div className="tarjeta p-6">
              <h2 className="font-cond text-2xl" style={{ fontWeight: 700 }}>Así de simple</h2>
              <ol className="mt-4 grid gap-3">
                {["Pagas en línea con el medio que prefieras.", "Te escribimos por WhatsApp para activar tu cuenta.", "Cargamos tus productos (en Pro lo hacemos nosotros) y empiezas a vender."].map((t, i) => (
                  <li key={t} className="flex gap-3"><span className="size-7 shrink-0 rounded-full degradado-marca text-white grid place-items-center font-semibold text-sm">{i + 1}</span><span>{t}</span></li>
                ))}
              </ol>
            </div>
            <Sello apilado />
            <p className="text-[15px]">¿Dudas antes de pagar? <a href={wa("Hola, tengo una pregunta antes de contratar Regenta.")} className="font-semibold text-teal-700 underline">Escríbenos por WhatsApp</a> y te respondemos en minutos en horario hábil.</p>
            <p className="text-sm text-muted">¿Le compras a Farmagenéricos? Con el {SOCIO.nombre} Regenta te puede salir a mitad de precio o gratis: <Link href="/precios#socio" className="underline">ver Plan Socio</Link>.</p>
          </aside>
        </section>
      </main>
      <Pie />
    </div>
  );
}
