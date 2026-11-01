/** Símbolo de Regenta: una R sobre un tiquete de factura (borde troquelado) en el verde-azul de la salud,
 *  con la chispa ámbar de la inteligencia artificial. Factura + farmacia + IA en un solo signo. */
export function Isotipo({ size = 40, claro = false }: { size?: number; claro?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 48 48" aria-hidden="true">
      <defs>
        <linearGradient id="regenta-g" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#14b8a6" /><stop offset=".55" stopColor="#0e7490" /><stop offset="1" stopColor="#1d4ed8" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="44" height="44" rx="13" fill="url(#regenta-g)" />
      <path d="M13 10h18a3 3 0 0 1 3 3v24l-2.5-2-2.5 2-2.5-2-2.5 2-2.5-2-2.5 2-2.5-2-2.5 2-2.5-2V13a3 3 0 0 1 3-3z" fill="#fff" />
      <path d="M17.5 32V16h6.2a4.6 4.6 0 0 1 0 9.2h-6.2M23 25.2l5 6.8" fill="none" stroke="#0b2540" strokeWidth="3.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M38 3.5l1.6 4.2 4.2 1.6-4.2 1.6L38 15.1l-1.6-4.2-4.2-1.6 4.2-1.6z" fill="#fbbf24" stroke={claro ? "#0b1f33" : "#fff"} strokeWidth="1.2" />
    </svg>
  );
}

/** Logotipo completo: símbolo + «Regenta» + lo que es (facturación e IA para el sector farmacéutico) + la firma de
 *  Farmagenéricos Colombia. `compacto` quita el descriptor (barras estrechas). */
export function Marca({ claro = false, firma = true, compacto = false }: { claro?: boolean; firma?: boolean; compacto?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5" aria-label="Regenta, facturación e IA para el sector farmacéutico, by Farmagenéricos Colombia">
      <Isotipo size={42} claro={claro} />
      <span className="leading-none">
        <span className={`block font-cond text-[28px] tracking-[-0.03em] ${claro ? "text-white" : "text-ink"}`} style={{ fontWeight: 700 }}>Regenta</span>
        {!compacto && <span className={`hidden sm:block text-[11.5px] font-semibold mt-[3px] whitespace-nowrap ${claro ? "text-teal-300" : "text-teal-700"}`}>Facturación e IA para el sector farmacéutico</span>}
        {firma && <span className={`block text-[10px] mt-[2px] whitespace-nowrap ${claro ? "text-white/55" : "text-muted"}`}>by Farmagenéricos Colombia</span>}
      </span>
    </span>
  );
}
