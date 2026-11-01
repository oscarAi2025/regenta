import { redirect } from "next/navigation";
import { Marca } from "@/components/Marca";
import { demoActiva, leerSesion } from "@/lib/sesion";
import { EntrarDemo } from "./EntrarDemo";

export const metadata = { title: "Entrar", robots: { index: false, follow: true } };

export default async function Entrar() {
  if (await leerSesion()) redirect("/inicio");
  return (
    <main className="min-h-screen grid lg:grid-cols-[1.1fr_1fr]">
      <section className="order-2 lg:order-1 bg-ink text-white px-6 py-10 sm:px-12 flex flex-col justify-between gap-10">
        <Marca claro />
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
          <h2 className="font-cond text-3xl" style={{ fontWeight: 700 }}>Entrar</h2>
          {demoActiva() ? <EntrarDemo /> : <p className="mt-4 text-muted">El acceso con usuario y contraseña se activa al conectar la cuenta de la empresa.</p>}
        </div>
      </section>
    </main>
  );
}
