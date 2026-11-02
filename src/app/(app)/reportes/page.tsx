import Link from "next/link";
import { redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion, puede } from "@/lib/sesion";
import { Cabecera, Dato, pesos } from "@/components/ui/Cabecera";
import { MEDIO } from "@/lib/formato";
import { datosReporte, rango } from "@/lib/reportes";

export const metadata = { title: "Reportes" };

const fecha = (f: string) => new Date(f + "T12:00:00").toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" });

export default async function Reportes({ searchParams }: { searchParams: Promise<{ desde?: string; hasta?: string }> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puede.verCostos(s.rol)) redirect("/inicio?aviso=permiso"); // reportes de gerencia: dueño y administrador
  const sp = await searchParams;
  const r = rango(sp.desde, sp.hasta);
  const d = await comoUsuario(s, (c) => datosReporte(c, s.empresa, r, true));
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
  const menos = (n: number) => new Date(new Date(hoy + "T12:00:00Z").getTime() - n * 86400000).toISOString().slice(0, 10);
  const mesPasadoFin = menos(Number(hoy.slice(8, 10)));
  const atajos: [string, string, string][] = [["Hoy", hoy, hoy], ["7 días", menos(6), hoy], ["Este mes", hoy.slice(0, 8) + "01", hoy], ["Mes pasado", mesPasadoFin.slice(0, 8) + "01", mesPasadoFin], ["30 días", menos(29), hoy]];
  const q = `desde=${r.desde}&hasta=${r.hasta}`;
  const maxDia = Math.max(1, ...d.dias.map((x) => x.total));
  const maxHora = Math.max(1, ...d.horas.map((x) => x.total));
  const totalMedios = d.medios.reduce((a, m) => a + m.valor, 0) || 1;
  const exportar = (tipo: string, texto: string) => <a href={`/api/reportes?${q}&tipo=${tipo}`} className="text-sm font-semibold text-cruz underline underline-offset-4">{texto}</a>;

  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo="Reportes" sub={r.desde === r.hasta ? fecha(r.desde) : `${fecha(r.desde)} – ${fecha(r.hasta)}`}>
        <form className="flex flex-wrap gap-2 items-end" aria-label="Rango de fechas">
          <label className="grid text-sm text-muted">Desde<input type="date" name="desde" defaultValue={r.desde} max={hoy} className="campo w-auto" /></label>
          <label className="grid text-sm text-muted">Hasta<input type="date" name="hasta" defaultValue={r.hasta} max={hoy} className="campo w-auto" /></label>
          <button className="btn-oscuro">Ver</button>
        </form>
      </Cabecera>
      <nav className="flex flex-wrap gap-2" aria-label="Rangos rápidos">
        {atajos.map(([t, a, b]) => <Link key={t} href={`/reportes?desde=${a}&hasta=${b}`} aria-current={a === r.desde && b === r.hasta ? "true" : undefined}
          className={`pastilla border ${a === r.desde && b === r.hasta ? "bg-ink text-white border-ink" : "bg-surface border-line hover:border-ink"}`}>{t}</Link>)}
      </nav>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3" aria-label="Resumen">
        <Dato titulo="Ventas netas" valor={pesos(d.netas)} tono="cruz" nota={`${pesos(d.resumen.bruto)} vendido − ${pesos(d.devoluciones.total)} devuelto`} />
        <Dato titulo="Ventas" valor={d.resumen.ventas} nota={`ticket promedio ${pesos(d.promedio)}${d.resumen.anuladas ? ` · ${d.resumen.anuladas} anuladas` : ""}`} />
        <Dato titulo="Ganancia bruta" valor={d.ganancia === null ? "—" : pesos(d.ganancia)} nota={d.margen === null ? "Sin ventas en el rango" : `margen ${d.margen} % sobre la venta sin IVA`} />
        <Dato titulo="IVA cobrado" valor={pesos(d.resumen.iva - d.devoluciones.iva)} nota={d.resumen.credito ? `${pesos(d.resumen.credito)} vendido a crédito` : `${d.devoluciones.n} devoluciones`} />
      </section>

      <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-2 gap-5">
        <section className="tarjeta p-5" aria-label="Ventas por día">
          <div className="flex justify-between items-baseline gap-2"><h2 className="titulo text-xl">Por día</h2>{exportar("dias", "Exportar a Excel")}</div>
          {d.dias.length ? (
            <ul className="mt-3 grid gap-1.5 text-sm num max-h-[380px] overflow-auto pr-1">
              {d.dias.map((x) => (
                <li key={x.dia} className="grid grid-cols-[88px_1fr_110px] items-center gap-2">
                  <span className="text-muted">{new Date(x.dia + "T12:00:00").toLocaleDateString("es-CO", { weekday: "short", day: "numeric", month: "short" })}</span>
                  <span className="h-3 rounded-full bg-paper overflow-hidden"><span className="block h-full rounded-full bg-teal-600" style={{ width: `${(x.total / maxDia) * 100}%` }} /></span>
                  <span className="text-right font-semibold">{pesos(x.total)}</span>
                </li>
              ))}
            </ul>
          ) : <p className="mt-2 text-muted">No hay ventas en este rango.</p>}
        </section>
        <section className="tarjeta p-5" aria-label="Por medio de pago">
          <div className="flex justify-between items-baseline gap-2"><h2 className="titulo text-xl">Por medio de pago</h2>{exportar("medios", "Exportar a Excel")}</div>
          <ul className="mt-3 grid gap-2 text-sm num">
            {d.medios.map((m) => (
              <li key={m.medio} className="grid grid-cols-[110px_1fr_110px] items-center gap-2">
                <span>{MEDIO[m.medio] ?? m.medio}</span>
                <span className="h-3 rounded-full bg-paper overflow-hidden"><span className="block h-full rounded-full bg-sky-600" style={{ width: `${(m.valor / totalMedios) * 100}%` }} /></span>
                <span className="text-right font-semibold">{pesos(m.valor)}</span>
              </li>
            ))}
            {d.resumen.credito > 0 && <li className="grid grid-cols-[110px_1fr_110px] gap-2"><span>A crédito</span><span /><span className="text-right font-semibold">{pesos(d.resumen.credito)}</span></li>}
          </ul>
          <h3 className="font-semibold mt-5">Horas fuertes</h3>
          <div className="mt-2 flex items-end gap-1 h-24" aria-label="Ventas por hora del día">
            {Array.from({ length: 24 }, (_, h) => d.horas.find((x) => x.hora === h)).map((x, h) => (
              <div key={h} className="flex-1 grid justify-items-center gap-1" title={`${h}:00 · ${x ? pesos(x.total) : "$0"}`}>
                <span className="w-full rounded-t bg-amber-400" style={{ height: `${x ? Math.max(4, (x.total / maxHora) * 80) : 0}px` }} />
                <span className="text-[10px] text-muted">{h % 3 === 0 ? h : ""}</span>
              </div>
            ))}
          </div>
        </section>
      </div>

      <section className="tarjeta p-5" aria-label="Por cajero">
        <div className="flex justify-between items-baseline gap-2"><h2 className="titulo text-xl">Por cajero</h2>{exportar("cajeros", "Exportar a Excel")}</div>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm num">
            <thead><tr className="text-left text-muted"><th className="py-2 font-medium">Cajero</th><th className="text-right font-medium">Ventas</th><th className="text-right font-medium">Ticket promedio</th><th className="text-right font-medium">Total</th></tr></thead>
            <tbody className="divide-y divide-line">{d.cajeros.map((x) => <tr key={x.cajero}><td className="py-2 font-sans">{String(x.cajero).split(" (")[0]}</td><td className="text-right">{x.ventas}</td><td className="text-right">{pesos(x.promedio)}</td><td className="text-right font-semibold">{pesos(x.total)}</td></tr>)}</tbody>
          </table>
        </div>
      </section>

      <section className="tarjeta p-5" aria-label="Por producto">
        <div className="flex justify-between items-baseline gap-2"><h2 className="titulo text-xl">Por producto</h2>{exportar("productos", "Exportar a Excel")}</div>
        <p className="text-sm text-muted mt-1">Los 200 que más venden en el rango. La ganancia usa el costo de cada lote vendido.</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm num min-w-[640px]">
            <thead><tr className="text-left text-muted"><th className="py-2 font-medium">Producto</th><th className="text-right font-medium">Unidades</th><th className="text-right font-medium">Devueltas</th><th className="text-right font-medium">Vendido</th><th className="text-right font-medium">Ganancia</th></tr></thead>
            <tbody className="divide-y divide-line">{d.productos.map((x, i) => {
              const g = x.base - (x.costo ?? 0);
              return <tr key={i}><td className="py-2 font-sans">{x.producto}</td><td className="text-right">{x.unidades}</td><td className="text-right">{x.devueltas || ""}</td><td className="text-right font-semibold">{pesos(x.total)}</td>
                <td className={`text-right ${x.sin_costo ? "text-muted" : g < 0 ? "text-alerta" : ""}`}>{x.sin_costo ? "sin costo" : pesos(g)}</td></tr>;
            })}</tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
