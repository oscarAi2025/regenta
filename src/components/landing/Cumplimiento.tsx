/** Franja de cumplimiento: los nombres de las entidades en texto (no sus logos) con la norma que Regenta ayuda a cumplir.
 *  Ninguna de estas entidades avala ni certifica a Regenta, y así se dice. */
const ITEMS: [string, string][] = [
  ["DIAN", "Facturación y POS electrónico · Resolución 165 de 2023"],
  ["INVIMA", "Alertas sanitarias oficiales cruzadas con tus lotes"],
  ["Secretarías de Salud", "Lote más próximo a vencer · Resolución 1403 de 2007"],
  ["SIC", "Protección de datos personales · Ley 1581 de 2012"],
];
export function Cumplimiento({ claro = false }: { claro?: boolean }) {
  return (
    <section aria-label="Cumplimiento normativo" className={claro ? "bg-surface border-y border-line" : "bg-[#071726] text-white border-y border-white/10"}>
      <div className="max-w-6xl mx-auto px-4 sm:px-6 py-8">
        <p className={`text-sm font-semibold ${claro ? "text-teal-700" : "text-teal-300"}`}>Cumple con la normativa colombiana</p>
        <ul className="mt-4 grid grid-cols-2 lg:grid-cols-4 gap-x-6 gap-y-5">
          {ITEMS.map(([t, d]) => (
            <li key={t} className="flex items-start gap-3">
              <span className={`mt-1 size-7 shrink-0 rounded-full grid place-items-center text-sm font-bold ${claro ? "bg-teal-600 text-white" : "bg-teal-400 text-[#071726]"}`} aria-hidden="true">✓</span>
              <span><span className="block font-cond text-[30px] sm:text-[36px] leading-none tracking-tight" style={{ fontWeight: 700 }}>{t}</span>
                <span className={`block mt-1 text-[13px] leading-snug ${claro ? "text-muted" : "text-white/65"}`}>{d}</span></span>
            </li>
          ))}
        </ul>
        <p className={`mt-5 text-[11px] ${claro ? "text-muted" : "text-white/40"}`}>Referencia a las normas que Regenta ayuda a cumplir; no implica aval ni certificación de esas entidades.</p>
      </div>
    </section>
  );
}
