"use client";
/** Abre el buscador rápido (también con Ctrl+K). */
export function BotonBuscar() {
  return (
    <button onClick={() => window.dispatchEvent(new Event("regenta-buscar"))} className="ml-auto mr-2 hidden md:inline-flex items-center gap-3 h-9 pl-3 pr-2 rounded-xl border border-line text-muted hover:border-ink text-sm w-72">
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-3.5-3.5" /></svg>
      <span className="flex-1 text-left">Buscar o preguntar…</span><kbd>Ctrl K</kbd>
    </button>
  );
}
