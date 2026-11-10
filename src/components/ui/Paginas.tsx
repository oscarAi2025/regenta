/** Paginación con números: Anterior · 1 … 4 5 6 … 20 · Siguiente, más un resumen («Página 5 de 20 · 1.954 clientes»).
 *  Enlaces normales (funciona sin JavaScript y con el botón atrás). En el celular se ven la anterior, la actual y la
 *  siguiente; en pantallas grandes, también la primera, la última y las vecinas. */
export function Paginas({ pagina, paginas, enlace, etiqueta = "Páginas", resumen }: {
  pagina: number; paginas: number; enlace: (n: number) => string; etiqueta?: string; resumen?: string;
}) {
  if (paginas <= 1) return null;
  const actual = Math.min(Math.max(1, pagina), paginas);
  // Números a mostrar: primera, última y dos a cada lado de la actual; los huecos se marcan con «…».
  const set = new Set([1, paginas, actual - 2, actual - 1, actual, actual + 1, actual + 2].filter((n) => n >= 1 && n <= paginas));
  const nums = [...set].sort((a, b) => a - b);
  const items: (number | "…")[] = [];
  nums.forEach((n, i) => { if (i && n - nums[i - 1] > 1) items.push("…"); items.push(n); });
  const lejos = (n: number) => Math.abs(n - actual) > 1; // en el celular solo la anterior, la actual y la siguiente
  const base = "inline-flex items-center justify-center h-10 min-w-10 px-3 rounded-xl text-sm font-semibold num";
  return (
    <nav aria-label={etiqueta} className="flex flex-wrap items-center gap-x-3 gap-y-2">
      <ul className="flex flex-wrap items-center gap-1.5">
        <li>{actual > 1
          ? <a href={enlace(actual - 1)} rel="prev" className="btn-borde h-10 text-sm">Anterior</a>
          : <span className="btn-borde h-10 text-sm opacity-40" aria-disabled="true">Anterior</span>}</li>
        {items.map((n, i) => n === "…"
          ? <li key={`h${i}`} aria-hidden="true" className="hidden sm:block px-1 text-muted">…</li>
          : <li key={n} className={lejos(n) ? "hidden sm:block" : undefined}>
              {n === actual
                ? <span aria-current="page" className={`${base} bg-ink text-white`}>{n.toLocaleString("es-CO")}</span>
                : <a href={enlace(n)} aria-label={`Página ${n}`} className={`${base} border-2 border-line bg-surface hover:border-ink`}>{n.toLocaleString("es-CO")}</a>}
            </li>)}
        <li>{actual < paginas
          ? <a href={enlace(actual + 1)} rel="next" className="btn-borde h-10 text-sm">Siguiente</a>
          : <span className="btn-borde h-10 text-sm opacity-40" aria-disabled="true">Siguiente</span>}</li>
      </ul>
      <p className="text-sm text-muted num">Página {actual.toLocaleString("es-CO")} de {paginas.toLocaleString("es-CO")}{resumen ? ` · ${resumen}` : ""}</p>
    </nav>
  );
}
