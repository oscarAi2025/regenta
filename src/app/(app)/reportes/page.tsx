import Link from "next/link";
import { redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion, puede } from "@/lib/sesion";
import { Cabecera, Dato, pesos } from "@/components/ui/Cabecera";
import { MEDIO } from "@/lib/formato";
import { atajos as rangosRapidos, datosReporte, rango } from "@/lib/reportes";
import { pesosExactos } from "@/lib/compras";
import { Pestanas } from "./Pestanas";

export const metadata = { title: "Reportes" };

const fecha = (f: string) => new Date(f + "T12:00:00").toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" });

export default async function Reportes({ searchParams }: { searchParams: Promise<{ desde?: string; hasta?: string }> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puede.verCostos(s.rol)) redirect("/inicio?aviso=permiso"); // reportes de gerencia: dueño y administrador
  const sp = await searchParams;
  const r = rango(sp.desde, sp.hasta);
  const [d, alegra] = await comoUsuario(s, async (c) => [await datosReporte(c, s.empresa, r, true),
    (await c.query(`select count(*)::int n, coalesce(sum(total), 0)::float total from ventas_externas where empresa_id = $1 and estado in ('pagada', 'por_cobrar') and fecha between $2::date and $3::date`,
      [s.empresa, r.desde, r.hasta])).rows[0] as { n: number; total: number }] as const);
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
  const atajos = rangosRapidos();
  const res = d.resultados!;
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
      <Pestanas actual="/reportes" rango={q} />
      {alegra.n > 0 && (
        <Link href={`/ventas/historial?desde=${r.desde}&hasta=${r.hasta}`} className="tarjeta px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1 hover:border-ink/40">
          <span className="flex-1 min-w-[220px]"><span className="font-semibold">En este periodo también vendiste {pesos(alegra.total)} en Alegra</span>
            <span className="block text-sm text-muted num">{alegra.n.toLocaleString("es-CO")} documentos de antes de pasar a Regenta. No suman aquí (no tienen costo ni caja): míralos por mes, producto y cliente en el historial.</span></span>
          <span className="btn-borde h-10 text-sm">Ver historial</span>
        </Link>
      )}
      <nav className="flex flex-wrap gap-2" aria-label="Rangos rápidos">
        {atajos.map(([t, a, b]) => <a key={t} href={`/reportes?desde=${a}&hasta=${b}`} aria-current={a === r.desde && b === r.hasta ? "true" : undefined}
          className={`pastilla border ${a === r.desde && b === r.hasta ? "bg-ink text-white border-ink" : "bg-surface border-line hover:border-ink"}`}>{t}</a>)}
        <a href={`/control-especial?desde=${r.desde}&hasta=${r.hasta}`} className="pastilla border bg-surface border-line hover:border-ink sm:ml-auto">Libro de control especial</a>
      </nav>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3" aria-label="Resumen">
        <Dato titulo="Ventas netas (con IVA)" valor={pesos(d.netas)} tono="cruz" nota={`${pesos(d.resumen.bruto)} vendido − ${pesos(d.devoluciones.total)} devuelto`} />
        <Dato titulo="Ventas" valor={d.resumen.ventas} nota={`ticket promedio ${pesos(d.promedio)}${d.resumen.anuladas ? ` · ${d.resumen.anuladas} anuladas` : ""}`} />
        <Dato titulo="Ganancia bruta" valor={pesos(res.utilidad_bruta)} nota={<>{res.margen === null ? "Sin ventas con costo en el rango" : `margen ${String(res.margen).replace(".", ",")} % sobre la venta sin IVA`}
          {res.sin_costo.netas > 0 && <span className="block text-aviso">{pesosExactos(res.sin_costo.netas)} vendidos sin costo registrado (no cuentan)</span>}
          <a href={`/reportes/resultados?${q}`} className="block underline">Ver estado de resultados</a></>} />
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
        <p className="text-sm text-muted mt-1">Los 200 que más venden en el rango. La ganancia es sin IVA, neta de lo devuelto y solo de los lotes con costo registrado.</p>
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-sm num min-w-[640px]">
            <thead><tr className="text-left text-muted"><th className="py-2 font-medium">Producto</th><th className="text-right font-medium">Unidades</th><th className="text-right font-medium">Devueltas</th><th className="text-right font-medium">Vendido</th><th className="text-right font-medium">Ganancia</th></tr></thead>
            <tbody className="divide-y divide-line">{d.productos.map((x, i) => {
              const g = x.ganancia ?? 0;
              return <tr key={i}><td className="py-2 font-sans">{x.producto}{x.heredado && <span className="ml-1.5 text-xs text-muted" title="Costo anterior a compras: puede incluir IVA">(costo anterior)</span>}</td><td className="text-right">{x.unidades}</td><td className="text-right">{x.devueltas || ""}</td><td className="text-right font-semibold">{pesos(x.total)}</td>
                <td className={`text-right ${!x.con_costo ? "text-muted" : g < 0 ? "text-alerta" : ""}`}>{x.con_costo ? pesos(g) : "sin costo"}{x.con_costo && (x.sin_costo ?? 0) > 0 && <span className="block text-xs text-aviso">+{pesos(x.sin_costo!)} sin costo</span>}</td></tr>;
            })}</tbody>
          </table>
        </div>
      </section>
    </main>
  );
}
