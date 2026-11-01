import type { Metadata } from "next";
import { metaPublica } from "@/lib/seo";
import Link from "next/link";
import { PAGINAS } from "@/content/paginas";
import { CabeceraPublica } from "@/components/landing/Cabecera";
import { Pie } from "@/components/landing/Pie";
import { BarraMovil } from "@/components/landing/BarraMovil";
import { BotonDemo } from "@/components/landing/BotonDemo";

export const metadata: Metadata = metaPublica("/funciones", "Funciones: facturación y gestión farmacéutica | Regenta", "Facturación electrónica, crédito y cartera, IA, pedido sugerido, vencimientos por lote y alertas INVIMA para droguerías y distribuidoras.");

export default function Funciones() {
  return (
    <div className="bg-paper text-ink min-h-screen pb-20 sm:pb-0">
      <CabeceraPublica />
      <main className="max-w-6xl mx-auto px-4 sm:px-6 pt-10 pb-16">
        <h1 className="font-cond text-[44px] sm:text-[64px] leading-[0.95]" style={{ fontWeight: 700 }}>Funciones de Regenta</h1>
        <p className="mt-4 text-lg text-muted max-w-2xl">Facturación y gestión para droguerías, farmacias y distribuidoras: facturar, cobrar, pedir, controlar vencimientos y cumplir.</p>
        <div className="mt-6"><BotonDemo texto="Probar la demo gratis" className="btn-cta h-12 px-6" /></div>
        <ul className="mt-10 grid md:grid-cols-2 gap-4">
          {PAGINAS.map((p) => (
            <li key={p.ruta}><Link href={`/${p.grupo}/${p.ruta}`} className="tarjeta block p-6 h-full hover:border-ink">
              <p className="text-sm font-semibold text-cruz">{p.corto}</p>
              <h2 className="font-cond text-[28px] leading-tight mt-1" style={{ fontWeight: 700 }}>{p.h1}</h2>
              <p className="mt-2 text-muted">{p.descripcion}</p>
            </Link></li>
          ))}
        </ul>
      </main>
      <Pie />
      <BarraMovil />
    </div>
  );
}
