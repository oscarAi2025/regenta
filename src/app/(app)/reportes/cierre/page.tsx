import { redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion } from "@/lib/sesion";
import { Cabecera, Dato } from "@/components/ui/Cabecera";
import { pesosExactos } from "@/lib/compras";
import { MEDIO } from "@/lib/formato";
import { puedeResultados } from "@/lib/gastos";
import { cierreDia, fechaValida, hoyBogota } from "@/lib/reportes";
import { Pestanas } from "../Pestanas";
import { fechaCorta } from "../FiltroRango";

export const metadata = { title: "Cierre del día" };

export default async function CierreDia({ searchParams }: { searchParams: Promise<{ fecha?: string }> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puedeResultados(s.rol)) redirect("/inicio?aviso=permiso");
  const sp = await searchParams;
  const hoy = hoyBogota();
  const dia = fechaValida(sp.fecha) && sp.fecha! <= hoy ? sp.fecha! : hoy;
  const ayer = new Date(new Date(hoy + "T12:00:00Z").getTime() - 86400000).toISOString().slice(0, 10);
  const d = await comoUsuario(s, (c) => cierreDia(c, s.empresa, dia));
  const nombre = (n: string | null) => String(n ?? "").split(" (")[0];
  const dif = (v: number | null) => (v === null ? "—" : `${v > 0 ? "+" : ""}${pesosExactos(v)}`);
  const tonoDif = (v: number | null) => (v === null ? "text-muted" : v < 0 ? "text-alerta" : v > 0 ? "text-aviso" : "text-cruz");
  const conDiferencia = d.turnos.filter((t) => t.diferencia !== null && t.diferencia !== 0).length;
  const T = d.totales;
  const cerrados = d.turnos.length - T.abiertos; // contado y diferencia solo existen en los turnos cerrados

  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo="Cierre del día" sub={`${fechaCorta(dia)} · todas las cajas y turnos`}>
        <form className="flex flex-wrap gap-2 items-end" aria-label="Día">
          <label className="grid text-sm text-muted">Día<input type="date" name="fecha" defaultValue={dia} max={hoy} className="campo w-auto" /></label>
          <button className="btn-oscuro">Ver</button>
        </form>
      </Cabecera>
      <Pestanas actual="/reportes/cierre" />
      <nav className="flex flex-wrap gap-2" aria-label="Días rápidos">
        {([["Hoy", hoy], ["Ayer", ayer]] as const).map(([t, f]) => <a key={t} href={`/reportes/cierre?fecha=${f}`} aria-current={f === dia ? "true" : undefined}
          className={`pastilla border ${f === dia ? "bg-ink text-white border-ink" : "bg-surface border-line hover:border-ink"}`}>{t}</a>)}
      </nav>

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3" aria-label="Resumen del día">
        <Dato titulo="Vendido" valor={pesosExactos(d.ventas.total)} tono="cruz" nota={`${d.ventas.n} venta${d.ventas.n === 1 ? "" : "s"}${d.ventas.anuladas ? ` · ${d.ventas.anuladas} anulada${d.ventas.anuladas === 1 ? "" : "s"}` : ""}${d.devoluciones.n ? ` · ${pesosExactos(d.devoluciones.total)} devuelto` : ""}`} />
        <Dato titulo="Abonos de clientes" valor={pesosExactos(d.abonos.reduce((a, x) => a + x.valor, 0))} nota={`${d.recibos} recibo${d.recibos === 1 ? "" : "s"} de caja`} />
        <Dato titulo="Gastos y pagos" valor={pesosExactos(d.gastos.total + d.pagos.total)} nota={`${pesosExactos(d.gastos.caja + d.pagos.caja)} salieron de las cajas`} />
        <Dato titulo="Diferencias de caja" valor={cerrados === 0 ? "—" : T.diferencia === 0 ? "$0" : dif(T.diferencia)} tono={T.diferencia < 0 ? "alerta" : T.diferencia > 0 ? "aviso" : undefined}
          nota={`${d.turnos.length} turno${d.turnos.length === 1 ? "" : "s"}${T.abiertos ? ` · ${T.abiertos} abierto${T.abiertos === 1 ? "" : "s"}` : ""}${conDiferencia ? ` · ${conDiferencia} con diferencia` : ""}`} />
      </section>

      <section className="tarjeta" aria-label="Turnos del día">
        <h2 className="titulo text-xl px-4 pt-4">Turnos del día</h2>
        <p className="text-sm text-muted px-4">Cada turno con sus cifras completas (los que cruzan la medianoche salen en los dos días). En los abiertos, lo esperado es hasta ahora.</p>
        {d.turnos.length === 0 ? <p className="px-4 py-6 text-muted">No hubo turnos de caja este día.</p> : (
          <div className="relative overflow-x-auto mt-2">
            <table className="w-full text-[15px] num min-w-[1060px]" aria-label="Turnos del día">
              <thead className="text-left text-sm text-muted border-b border-line"><tr>
                <th className="px-4 py-2.5 font-semibold">Caja</th><th className="px-3 py-2.5 font-semibold">Abrió</th><th className="px-3 py-2.5 font-semibold">Cerró</th>
                <th className="px-3 py-2.5 font-semibold text-right">Base</th><th className="px-3 py-2.5 font-semibold text-right">Ventas</th><th className="px-3 py-2.5 font-semibold text-right">Devoluciones</th>
                <th className="px-3 py-2.5 font-semibold text-right">Abonos efectivo</th><th className="px-3 py-2.5 font-semibold text-right">Entradas</th><th className="px-3 py-2.5 font-semibold text-right">Salidas</th>
                <th className="px-3 py-2.5 font-semibold text-right">Esperado</th><th className="px-3 py-2.5 font-semibold text-right">Contado</th><th className="px-4 py-2.5 font-semibold text-right">Diferencia</th>
              </tr></thead>
              <tbody className="divide-y divide-line">
                {d.turnos.map((t) => (
                  <tr key={t.id} className="align-top">
                    <td className="px-4 py-2.5 font-sans font-semibold whitespace-nowrap">{t.caja}{t.estado === "abierto" && <span className="ml-1.5 rounded-md bg-aviso-soft text-aviso px-1.5 py-0.5 text-xs">abierto</span>}</td>
                    <td className="px-3 py-2.5">{t.abierto}<span className="block text-sm text-muted font-sans">{nombre(t.abre)}</span></td>
                    <td className="px-3 py-2.5">{t.cerrado ?? "—"}<span className="block text-sm text-muted font-sans">{nombre(t.cierra)}</span></td>
                    <td className="px-3 py-2.5 text-right">{pesosExactos(t.base)}</td><td className="px-3 py-2.5 text-right">{pesosExactos(t.ventas)}</td>
                    <td className="px-3 py-2.5 text-right">{pesosExactos(t.devoluciones)}</td><td className="px-3 py-2.5 text-right">{pesosExactos(t.abonos)}</td>
                    <td className="px-3 py-2.5 text-right">{pesosExactos(t.ingresos)}</td><td className="px-3 py-2.5 text-right">{pesosExactos(t.egresos)}</td>
                    <td className="px-3 py-2.5 text-right">{pesosExactos(t.esperado)}</td><td className="px-3 py-2.5 text-right">{t.contado === null ? "—" : pesosExactos(t.contado)}</td>
                    <td className={`px-4 py-2.5 text-right font-semibold ${tonoDif(t.diferencia)}`}>{dif(t.diferencia)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot className="border-t-2 border-line font-semibold bg-paper">
                <tr aria-label="Totales de los turnos">
                  <th scope="row" colSpan={3} className="px-4 py-2.5 text-left font-[inherit] font-sans">Total de los turnos</th>
                  <td className="px-3 py-2.5 text-right">{pesosExactos(T.base)}</td><td className="px-3 py-2.5 text-right" data-total="ventas">{pesosExactos(T.ventas)}</td>
                  <td className="px-3 py-2.5 text-right">{pesosExactos(T.devoluciones)}</td><td className="px-3 py-2.5 text-right">{pesosExactos(T.abonos)}</td>
                  <td className="px-3 py-2.5 text-right">{pesosExactos(T.ingresos)}</td><td className="px-3 py-2.5 text-right" data-total="egresos">{pesosExactos(T.egresos)}</td>
                  <td className="px-3 py-2.5 text-right" data-total="esperado">{pesosExactos(T.esperado)}</td><td className="px-3 py-2.5 text-right">{cerrados ? pesosExactos(T.contado) : "—"}</td>
                  <td className={`px-4 py-2.5 text-right ${tonoDif(cerrados ? T.diferencia : null)}`} data-total="diferencia">{dif(cerrados ? T.diferencia : null)}</td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </section>

      <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-2 gap-5">
        <section className="tarjeta p-4 sm:p-5" aria-label="Ventas por medio de pago">
          <h2 className="titulo text-xl">Ventas por medio de pago</h2>
          <p className="text-sm text-muted">Todas las cajas. El efectivo ya descuenta el cambio.</p>
          <ul className="mt-3 grid gap-1.5 num">
            {d.medios.map((m) => <li key={m.medio} className="flex justify-between gap-3"><span className="font-sans">{MEDIO[m.medio] ?? m.medio} <span className="text-sm text-muted">· {m.ventas}</span></span><b className="whitespace-nowrap">{pesosExactos(m.valor)}</b></li>)}
            {d.ventas.credito > 0 && <li className="flex justify-between gap-3"><span className="font-sans">A crédito</span><b className="whitespace-nowrap">{pesosExactos(d.ventas.credito)}</b></li>}
            {d.medios.length === 0 && d.ventas.credito === 0 && <li className="text-muted font-sans">Sin ventas este día.</li>}
            {d.devoluciones.n > 0 && <li className="flex justify-between gap-3 border-t border-line pt-1.5"><span className="font-sans">Devoluciones ({d.devoluciones.n}) · reembolso en efectivo {pesosExactos(d.devoluciones.efectivo)}</span><b className="text-alerta whitespace-nowrap">−{pesosExactos(d.devoluciones.total)}</b></li>}
          </ul>
        </section>
        <section className="tarjeta p-4 sm:p-5" aria-label="Otros movimientos del día">
          <h2 className="titulo text-xl">Abonos, gastos y pagos</h2>
          <ul className="mt-3 grid gap-1.5 num">
            {d.abonos.map((a) => <li key={a.medio} className="flex justify-between gap-3"><span className="font-sans">Abonos en {(MEDIO[a.medio] ?? a.medio).toLowerCase()} <span className="text-sm text-muted">· {a.n}</span></span><b className="whitespace-nowrap">{pesosExactos(a.valor)}</b></li>)}
            {d.abonos.length === 0 && <li className="text-muted font-sans">Sin abonos de clientes.</li>}
            <li className="flex justify-between gap-3 border-t border-line pt-1.5"><span className="font-sans">Gastos ({d.gastos.n}) · desde caja {pesosExactos(d.gastos.caja)}</span><b className="whitespace-nowrap">{pesosExactos(d.gastos.total)}</b></li>
            <li className="flex justify-between gap-3"><span className="font-sans">Pagos a proveedores ({d.pagos.n}) · desde caja {pesosExactos(d.pagos.caja)}</span><b className="whitespace-nowrap">{pesosExactos(d.pagos.total)}</b></li>
          </ul>
          <p className="text-sm text-muted mt-3">Los gastos y pagos que salen de una caja ya están en las «Salidas» de su turno. <a href={`/gastos?desde=${dia}&hasta=${dia}`} className="underline">Ver gastos del día</a></p>
        </section>
      </div>
    </main>
  );
}
