import Link from "next/link";
import { BotonDemo } from "./BotonDemo";
import { GARANTIA, GARANTIA_DIAS, PILA_VALOR, PRECIO_CONGELADO } from "@/lib/oferta";
import { mesAnual, PLANES } from "@/lib/planes";
import { pesos } from "@/lib/formato";
import { wa } from "@/lib/sitio";

/** La oferta completa: todo lo que recibes, el precio frente a lo que cuesta por separado, garantía y la acción. */
export function Oferta({ origen = "portada", demo = true }: { origen?: string; demo?: boolean }) {
  const [esencial, pro] = PLANES;
  return (
    <div className="grid lg:grid-cols-[1.1fr_.9fr] gap-6 items-stretch">
      <div className="rounded-[28px] bg-surface border border-line p-6 sm:p-8">
        <p className="font-cond text-[28px] sm:text-[34px] leading-tight" style={{ fontWeight: 700 }}>Lo que recibes al contratar</p>
        <ul className="mt-5 grid gap-3">
          {PILA_VALOR.map((v) => (
            <li key={v.que} className="flex gap-3">
              <span className="mt-0.5 size-6 shrink-0 rounded-full bg-teal-600 text-white grid place-items-center text-[13px] font-bold" aria-hidden="true">✓</span>
              <span className="min-w-0">
                <span className="font-semibold">{v.que}</span>
                {v.aparte && <span className="ml-2 pastilla min-h-0 h-6 px-2.5 text-[12px] bg-amber-100 text-amber-900">aparte cuesta {v.aparte} · aquí incluido</span>}
                <span className="block text-muted text-[15px] leading-snug">{v.detalle}</span>
              </span>
            </li>
          ))}
        </ul>
      </div>
      <div className="rounded-[28px] fondo-hero text-white p-6 sm:p-8 flex flex-col">
        <p className="text-white/70">Todo eso, desde</p>
        <p className="num font-cond text-[64px] sm:text-[76px] leading-none" style={{ fontWeight: 700 }}>{pesos(esencial.precio!)}</p>
        <p className="text-white/75">al mes · o {pesos(mesAnual(esencial.precio!))}/mes pagando el año (2 meses gratis)</p>
        <p className="mt-3 text-white/70 text-[15px]">Si se te vence el 2 % de un inventario de $40 millones, pierdes <b className="text-white">$800.000 al año</b>: casi 9 meses de Regenta. Plan Pro con 3 cajas y usuarios ilimitados: {pesos(pro.precio!)}.</p>
        <div className="mt-5 rounded-2xl border-2 border-amber-300/70 bg-amber-300/10 p-4 flex gap-3 items-start">
          <span className="shrink-0 size-12 rounded-full bg-amber-300 text-[#0b1f33] grid place-items-center font-cond text-xl leading-none text-center" style={{ fontWeight: 700 }} aria-hidden="true">{GARANTIA_DIAS}<br /></span>
          <p className="text-[15px] leading-snug"><b>Riesgo cero.</b> {GARANTIA}</p>
        </div>
        <p className="mt-3 text-sm text-white/70">{PRECIO_CONGELADO} Sin permanencia.</p>
        <div className="mt-auto pt-6 grid gap-2">
          <Link href={`/contratar?plan=pro&origen=${origen}`} className="btn-cta h-14 text-lg">Contratar ahora</Link>
          <div className="grid grid-cols-2 gap-2">
            {demo ? <BotonDemo texto="Probar gratis" className="btn-vidrio h-12 w-full" /> : <Link href="/precios" className="btn-vidrio h-12">Ver planes</Link>}
            <a href={wa("Hola, quiero contratar Regenta para mi droguería.")} className="btn-vidrio h-12">WhatsApp</a>
          </div>
        </div>
      </div>
    </div>
  );
}
