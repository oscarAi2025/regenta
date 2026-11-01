import type { Metadata } from "next";
import { metaPublica } from "@/lib/seo";
import Link from "next/link";
import { GUIAS } from "@/content/guias";
import { CabeceraPublica } from "@/components/landing/Cabecera";
import { Pie } from "@/components/landing/Pie";
import { BarraMovil } from "@/components/landing/BarraMovil";

export const metadata: Metadata = metaPublica("/guias", "Guías para regentes y droguerías | Regenta", "Guías para droguerías en Colombia: POS electrónico DIAN, vencimientos, alertas INVIMA, control especial, apertura, precios y pedido, con fuentes oficiales.");

export default function Guias() {
  return (
    <div className="bg-paper text-ink min-h-screen">
      <CabeceraPublica />
      <main className="max-w-5xl mx-auto px-4 sm:px-6 pt-10 pb-16">
        <h1 className="font-cond text-[44px] sm:text-[60px] leading-[1]" style={{ fontWeight: 700 }}>Guías para regentes y droguerías</h1>
        <p className="mt-4 text-lg text-muted max-w-2xl">Lo que pide la norma y cómo cumplirlo en el día a día del mostrador, con las fuentes oficiales enlazadas.</p>
        <ul className="mt-10 grid md:grid-cols-2 gap-4">
          {GUIAS.map((g) => (
            <li key={g.slug}><Link href={`/guias/${g.slug}`} className="tarjeta block p-6 h-full hover:border-ink">
              <h2 className="font-cond text-2xl leading-tight" style={{ fontWeight: 700 }}>{g.h1}</h2>
              <p className="mt-2 text-muted">{g.descripcion}</p>
            </Link></li>
          ))}
        </ul>
      </main>
      <Pie />
      <BarraMovil />
    </div>
  );
}
