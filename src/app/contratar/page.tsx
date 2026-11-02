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
            <div className="tarjeta p-6">
              <h2 className="font-cond text-2xl" style={{ fontWeight: 700 }}>Así de simple</h2>
              <ol className="mt-4 grid gap-3">
                {["Pagas en línea con el medio que prefieras.", "Te escribimos por WhatsApp para activar tu cuenta.", "Cargamos tus productos (en Pro lo hacemos nosotros) y empiezas a vender."].map((t, i) => (
                  <li key={t} className="flex gap-3"><span className="size-7 shrink-0 rounded-full degradado-marca text-white grid place-items-center font-semibold text-sm">{i + 1}</span><span>{t}</span></li>
                ))}
              </ol>
            </div>
            <Sello apilado />
            <p className="text-sm text-muted">¿Le compras a Farmagenéricos? Con el {SOCIO.nombre} Regenta te puede salir a mitad de precio o gratis: <Link href="/precios#socio" className="underline">ver Plan Socio</Link>.</p>
          </aside>
        </section>
      </main>
      <Pie />
    </div>
  );
}
