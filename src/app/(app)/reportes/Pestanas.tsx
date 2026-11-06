// Pestañas de la gerencia: reportes de ventas, resultados, auxiliar de IVA, cierre del día, gastos y bitácora.
// Enlaces normales (<a>): cambian de pantalla con carga completa, como los filtros (ver lecciones del 06/11/2026).
const PESTANAS = [
  ["/reportes", "Ventas"], ["/reportes/resultados", "Resultados"], ["/reportes/iva", "Auxiliar de IVA"], ["/reportes/cierre", "Cierre del día"],
  ["/gastos", "Gastos"], ["/bitacora", "Bitácora"],
] as const;
/** rango: «desde=…&hasta=…» que se conserva entre los reportes por periodo. */
export function Pestanas({ actual, rango }: { actual: (typeof PESTANAS)[number][0]; rango?: string }) {
  const conRango = (h: string) => (rango && ["/reportes", "/reportes/resultados", "/reportes/iva"].includes(h) ? `${h}?${rango}` : h);
  return (
    <nav aria-label="Secciones de reportes" className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin] -mt-1">
      {PESTANAS.map(([h, t]) => (
        <a key={h} href={conRango(h)} aria-current={h === actual ? "page" : undefined}
          className={`shrink-0 px-3 py-1.5 rounded-lg text-sm font-semibold border ${h === actual ? "bg-ink text-white border-ink" : "bg-surface text-muted border-line hover:text-ink"}`}>{t}</a>
      ))}
    </nav>
  );
}
