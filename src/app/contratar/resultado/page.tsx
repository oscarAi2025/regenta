import type { Metadata } from "next";
import { CabeceraPublica } from "@/components/landing/Cabecera";
import { Pie } from "@/components/landing/Pie";
import { Resultado } from "./Resultado";

export const metadata: Metadata = { title: "Resultado del pago", robots: { index: false, follow: false } };

export default async function PaginaResultado({ searchParams }: { searchParams: Promise<{ ref?: string; id?: string }> }) {
  const sp = await searchParams;
  return (
    <div className="bg-paper text-ink min-h-screen">
      <CabeceraPublica />
      <main className="max-w-2xl mx-auto px-4 sm:px-6 py-14">
        <h1 className="font-cond text-[40px] sm:text-[52px] leading-[1]" style={{ fontWeight: 700 }}>Tu pago</h1>
        <Resultado referencia={sp.ref ?? ""} transaccion={sp.id ?? ""} />
      </main>
      <Pie />
    </div>
  );
}
