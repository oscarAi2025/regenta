/** Logotipo: la cruz de farmacia dentro de la R. */
export function Isotipo({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="8" fill="var(--ink)" />
      <path d="M9 24V8h7.2a5 5 0 0 1 1.6 9.7L22.5 24h-3.6l-4.2-6H12.4v6z" fill="#fff" />
      <path d="M21 6.5h3v3h3v3h-3v3h-3v-3h-3v-3h3z" fill="var(--marca)" />
    </svg>
  );
}

export function Marca({ claro = false }: { claro?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2.5">
      <Isotipo />
      <span className="leading-none">
        <span className={`block font-cond text-[22px] font-700 tracking-tight ${claro ? "text-white" : "text-ink"}`} style={{ fontWeight: 700 }}>Regenta</span>
        <span className={`block text-[11px] ${claro ? "text-white/70" : "text-muted"}`}>by Farmagenéricos Colombia</span>
      </span>
    </span>
  );
}
