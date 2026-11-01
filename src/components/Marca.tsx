/** Isotipo de Regenta: una cápsula partida (farmacia) con la cruz en su mitad verde y la chispa de la IA. */
export function Isotipo({ size = 32, claro = false }: { size?: number; claro?: boolean }) {
  const id = `cap${size}${claro ? "c" : ""}`;
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <clipPath id={id}><rect x="9" y="1.5" width="14" height="29" rx="7" transform="rotate(45 16 16)" /></clipPath>
        <linearGradient id={`${id}g`} x1="0" y1="1" x2="1" y2="0"><stop offset="0" stopColor="#0b7a55" /><stop offset="1" stopColor="#2fc4b8" /></linearGradient>
      </defs>
      <g clipPath={`url(#${id})`}>
        <rect width="32" height="32" fill={`url(#${id}g)`} />
        <path d="M0 0L32 32H0Z" fill={claro ? "#ffffff" : "#102a43"} />
      </g>
      <path d="M19.4 7.6h2.6v2.6h2.6v2.6H22v2.6h-2.6v-2.6h-2.6v-2.6h2.6z" fill="#fff" />
      <path d="M26.6 22.4l1 2.4 2.4 1-2.4 1-1 2.4-1-2.4-2.4-1 2.4-1z" fill="#2fc4b8" />
    </svg>
  );
}

export function Marca({ claro = false, sub = "by Farmagenéricos Colombia" }: { claro?: boolean; sub?: string }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <Isotipo size={34} claro={claro} />
      <span className="leading-none">
        <span className={`block font-cond text-[24px] tracking-[-0.02em] ${claro ? "text-white" : "text-ink"}`} style={{ fontWeight: 700 }}>Regenta<span className="text-marca">.</span></span>
        <span className={`block text-[11px] whitespace-nowrap ${claro ? "text-white/70" : "text-muted"}`}>{sub}</span>
      </span>
    </span>
  );
}
