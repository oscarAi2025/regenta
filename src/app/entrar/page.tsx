import Link from "next/link";
import { redirect } from "next/navigation";
import { Marca } from "@/components/Marca";
import { demoActiva, leerSesion } from "@/lib/sesion";
import { EntrarDemo } from "./EntrarDemo";
import { FormAcceso } from "./FormAcceso";

export const metadata = { title: "Entrar", robots: { index: false, follow: true } };

export default async function Entrar() {
  if (await leerSesion()) redirect("/inicio");
  return (
    <main className="min-h-screen grid lg:grid-cols-[1.1fr_1fr]">
      <section className="order-2 lg:order-1 bg-ink text-white px-6 py-10 sm:px-12 flex flex-col justify-between gap-10">
        <Link href="/" aria-label="Regenta, ir a la portada" className="self-start"><Marca claro /></Link>
        <div className="max-w-xl">
          <h1 className="font-cond text-[44px] sm:text-[64px] leading-[0.95] tracking-tight" style={{ fontWeight: 700 }}>
            Vende, factura y controla cada lote desde el mostrador.
          </h1>
          <p className="mt-6 text-lg text-white/75 max-w-md">
            Software de facturación electrónica y gestión para droguerías, farmacias y distribuidoras: tiquete POS y factura, inventario por lote, cartera e IA.
          </p>
        </div>
        <dl className="grid grid-cols-3 gap-4 max-w-lg text-sm">
          {[["Lote", "sale primero el que vence antes"], ["Unidad", "vende por caja o por pastilla"], ["Nube", "desde cualquier equipo, sin instalar nada"]].map(([t, d]) => (
            <div key={t} className="border-t border-white/20 pt-3"><dt className="font-cond text-xl" style={{ fontWeight: 600 }}>{t}</dt><dd className="text-white/65 mt-1">{d}</dd></div>
          ))}
        </dl>
      </section>
      <section className="order-1 lg:order-2 px-6 py-10 sm:px-12 flex items-center">
        <div className="w-full max-w-md mx-auto">
          <Link href="/" className="lg:hidden inline-flex items-center gap-1 text-sm font-semibold text-muted hover:text-ink mb-4 py-2">← Volver a la portada</Link>
          <h2 className="font-cond text-3xl" style={{ fontWeight: 700 }}>Entrar</h2>
          <FormAcceso />
          <p className="mt-4 text-[15px] text-muted">¿Aún no tienes cuenta? <Link href="/contratar?plan=esencial&origen=entrar" className="font-semibold text-cruz underline-offset-2 hover:underline">Contrata Regenta</Link></p>
          {demoActiva() && (
            <div className="mt-10 border-t border-line pt-6">
              <h2 className="font-cond text-2xl" style={{ fontWeight: 700 }}>¿Solo quieres mirar? Entra a la demo</h2>
              <EntrarDemo />
            </div>
          )}
        </div>
      </section>
    </main>
  );
}
