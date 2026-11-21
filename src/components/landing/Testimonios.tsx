import { TESTIMONIOS } from "@/content/testimonios";
import { BotonDemo } from "@/components/landing/BotonDemo";

/** Prueba social justo antes de la oferta y los planes: lo que dicen droguerías y distribuidoras que ya usan Regenta. */
export function Testimonios({ claro = false }: { claro?: boolean }) {
  return (
    <section className={claro ? "bg-surface border-y border-line" : "bg-[#0b1f33] text-white"} aria-labelledby="testimonios">
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-16 lg:py-20">
        <h2 id="testimonios" className="font-cond text-[38px] sm:text-[54px] leading-[0.98] max-w-[16em]" style={{ fontWeight: 700 }}>Lo dicen droguerías y distribuidoras que ya facturan con Regenta</h2>
        <ul className="mt-10 grid md:grid-cols-3 gap-4">
          {TESTIMONIOS.map((t) => (
            <li key={t.nombre}>
              <figure className={`h-full rounded-3xl p-6 sm:p-7 flex flex-col ${claro ? "bg-paper border border-line" : "bg-white/[.05] border border-white/10"}`}>
                <p className="font-cond text-[64px] leading-[.6] text-amber-400" aria-hidden="true">“</p>
                <blockquote className="mt-2 text-[19px] leading-relaxed flex-1">{t.cita}</blockquote>
                <figcaption className={`mt-6 pt-4 border-t ${claro ? "border-line" : "border-white/10"}`}>
                  <p className="font-semibold">{t.nombre}</p>
                  <p className={`text-[15px] ${claro ? "text-muted" : "text-white/65"}`}>{t.cargo ? `${t.cargo}, ` : ""}{t.negocio} · {t.ciudad}</p>
                </figcaption>
              </figure>
            </li>
          ))}
        </ul>
        <div className="mt-10"><BotonDemo texto="Probarlo como ellos, gratis" className="btn-cta h-14 px-8 text-lg" /></div>
      </div>
    </section>
  );
}
