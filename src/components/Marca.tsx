/** Símbolo de Regenta: una cápsula partida en dos tonos. Nada más: se reconoce a 16 px y a 160 px. */
export function Isotipo({ size = 32, claro = false }: { size?: number; claro?: boolean }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <g transform="rotate(-45 16 16)">
        <path d="M16 1.5a7.5 7.5 0 0 1 7.5 7.5V16h-15V9A7.5 7.5 0 0 1 16 1.5z" fill="#2fc4b8" />
        <path d="M8.5 16h15v7a7.5 7.5 0 0 1-15 0z" fill={claro ? "#ffffff" : "#102a43"} />
      </g>
    </svg>
  );
}

/** Logotipo: símbolo + «Regenta» con peso y, debajo, la firma pequeña de Farmagenéricos Colombia. */
export function Marca({ claro = false, firma = true }: { claro?: boolean; firma?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2" aria-label="Regenta by Farmagenéricos Colombia">
      <Isotipo size={30} claro={claro} />
      <span className="leading-none">
        <span className={`block font-cond text-[27px] tracking-[-0.035em] ${claro ? "text-white" : "text-ink"}`} style={{ fontWeight: 700 }}>Regenta</span>
        {firma && <span className={`block text-[10px] tracking-[0.01em] mt-[3px] whitespace-nowrap ${claro ? "text-white/60" : "text-muted"}`}>by Farmagenéricos Colombia</span>}
      </span>
    </span>
  );
}
