import { atajos, hoyBogota, type Rango } from "@/lib/reportes";

/** Formulario de fechas (GET) y rangos rápidos de un reporte por periodo. Enlaces y formulario normales: recarga completa. */
export function FiltroRango({ ruta, r }: { ruta: string; r: Rango }) {
  const hoy = hoyBogota();
  return (
    <div className="grid gap-3">
      <form className="flex flex-wrap gap-2 items-end" aria-label="Rango de fechas" action={ruta}>
        <label className="grid text-sm text-muted">Desde<input type="date" name="desde" defaultValue={r.desde} max={hoy} className="campo w-auto" /></label>
        <label className="grid text-sm text-muted">Hasta<input type="date" name="hasta" defaultValue={r.hasta} max={hoy} className="campo w-auto" /></label>
        <button className="btn-oscuro">Ver</button>
      </form>
      <nav className="flex flex-wrap gap-2" aria-label="Rangos rápidos">
        {atajos().map(([t, a, b]) => <a key={t} href={`${ruta}?desde=${a}&hasta=${b}`} aria-current={a === r.desde && b === r.hasta ? "true" : undefined}
          className={`pastilla border ${a === r.desde && b === r.hasta ? "bg-ink text-white border-ink" : "bg-surface border-line hover:border-ink"}`}>{t}</a>)}
      </nav>
    </div>
  );
}

const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
/** 6 nov 2026 (hecho a mano: igual en servidor y navegador). */
export const fechaCorta = (f: string) => `${Number(f.slice(8, 10))} ${MESES[Number(f.slice(5, 7)) - 1]} ${f.slice(0, 4)}`;
export const textoRango = (r: Rango) => (r.desde === r.hasta ? fechaCorta(r.desde) : `${fechaCorta(r.desde)} – ${fechaCorta(r.hasta)}`);
