import { WHATSAPP } from "@/lib/sitio";

/** Para la droguería que ya tiene programa: cómo se cambia a Regenta sin detener la caja. Es una secuencia real (por eso
 *  numerada) y cada paso es lo que de verdad hacemos: importación desde Excel, habilitación acompañada y cambio al final. */
const PASOS: [string, string][] = [
  ["Te pasamos tus productos e inventario en un día", "Exporta el Excel de tu programa actual y lo cargamos: productos, precios, existencias, lotes y vencimientos. Sin digitar uno por uno."],
  ["Sigues con tu sistema actual hasta que la DIAN apruebe Regenta", "Mientras tanto ya usas Regenta para inventario, caja y cartera. Te acompañamos en la habilitación ante la DIAN, incluida en tu plan."],
  ["Cambias cuando todo funciona, y no pierdes nada", "Con la primera factura aceptada por la DIAN dejas el programa anterior. Antes te ayudamos a descargar y guardar tus facturas pasadas."],
];

export function Cambiate({ claro = false }: { claro?: boolean }) {
  const wa = `https://wa.me/${WHATSAPP}?text=${encodeURIComponent("Hola, ya tengo un programa de facturación y quiero pasarme a Regenta. ¿Cómo hacemos?")}`;
  return (
    <section id="cambiate" aria-labelledby="cambiate-t" className={claro ? "bg-surface border-y border-line scroll-mt-20" : "bg-[#0b1f33] text-white scroll-mt-20"}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 lg:py-20 grid lg:grid-cols-[0.9fr_1.1fr] gap-10 items-start">
        <div>
          <h2 id="cambiate-t" className="font-cond text-[38px] sm:text-[50px] leading-[0.98]" style={{ fontWeight: 700 }}>¿Ya tienes programa? Cámbiate sin detener la caja.</h2>
          <p className={`mt-4 text-lg leading-relaxed ${claro ? "text-muted" : "text-white/75"}`}>Si tu droguería ya factura con otro programa, el cambio lo hacemos contigo, paso a paso y sin cortes en tus ventas.</p>
          <a href={wa} target="_blank" rel="noopener" className="btn-primario h-12 mt-6 inline-flex">Quiero cambiarme</a>
        </div>
        <ol className="grid gap-4">
          {PASOS.map(([t, d], i) => (
            <li key={t} className={`rounded-2xl p-5 flex gap-4 ${claro ? "tarjeta" : "bg-white/[0.06] border border-white/10"}`}>
              <span className={`size-9 shrink-0 rounded-full grid place-items-center font-cond text-xl ${claro ? "bg-teal-600 text-white" : "bg-teal-400 text-[#071726]"}`} style={{ fontWeight: 700 }} aria-hidden="true">{i + 1}</span>
              <span><span className="block font-semibold text-lg leading-snug">{t}</span><span className={`block mt-1 leading-relaxed ${claro ? "text-muted" : "text-white/70"}`}>{d}</span></span>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
