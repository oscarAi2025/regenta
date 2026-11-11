import { redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion } from "@/lib/sesion";
import { Cabecera, Dato } from "@/components/ui/Cabecera";
import { pesosExactos } from "@/lib/compras";
import { nombreCategoria, puedeResultados } from "@/lib/gastos";
import { lineasResultado, rango, resultados } from "@/lib/reportes";
import { Pestanas } from "../Pestanas";
import { FiltroRango, textoRango } from "../FiltroRango";
import { CostosPorRevisar } from "../CostosPorRevisar";

export const metadata = { title: "Estado de resultados" };

export default async function Resultados({ searchParams }: { searchParams: Promise<{ desde?: string; hasta?: string }> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puedeResultados(s.rol)) redirect("/inicio?aviso=permiso");
  const sp = await searchParams;
  const r = rango(sp.desde, sp.hasta);
  const d = await comoUsuario(s, (c) => resultados(c, s.empresa, r));
  const q = `desde=${r.desde}&hasta=${r.hasta}`;
  const lineas = lineasResultado(d);
  const signo = (v: number) => (v < 0 ? "text-alerta" : "");

  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo="Estado de resultados" sub={textoRango(r)}>
        <a href={`/api/reportes/resultados?${q}&formato=excel`} className="btn-borde" download>Descargar en Excel</a>
        <a href="/gastos" className="btn-borde">Registrar un gasto</a>
      </Cabecera>
      <Pestanas actual="/reportes/resultados" rango={q} />
      <FiltroRango ruta="/reportes/resultados" r={r} />

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3" aria-label="Resumen">
        <Dato titulo="Ventas netas" valor={pesosExactos(d.netas)} tono="cruz" nota={`sin IVA · ${pesosExactos(d.devoluciones)} devuelto`} />
        <Dato titulo="Utilidad bruta" valor={pesosExactos(d.utilidad_bruta)} nota={d.margen === null ? "Sin ventas con costo" : `margen ${String(d.margen).replace(".", ",")} %`} />
        <Dato titulo="Gastos" valor={pesosExactos(d.total_gastos)} nota={`${d.gastos.reduce((a, g) => a + g.n, 0)} registrado${d.gastos.reduce((a, g) => a + g.n, 0) === 1 ? "" : "s"}`} />
        <Dato titulo="Utilidad operativa" valor={pesosExactos(d.utilidad_operativa)} tono={d.utilidad_operativa < 0 ? "alerta" : undefined} nota="utilidad bruta − gastos" />
      </section>

      {d.sin_costo.netas !== 0 && (
        <p role="note" aria-label="Vendido sin costo" className="rounded-xl bg-aviso-soft text-aviso px-4 py-3">
          <b className="num">{pesosExactos(d.sin_costo.netas)} vendidos sin costo registrado</b> en este periodo. No entran en la utilidad (contarlos con costo cero la inflaría).{" "}
          <a href="/inventario" className="underline font-semibold">Completar costos en Inventario</a>
        </p>
      )}
      {d.revisar.length > 0 && <CostosPorRevisar lotes={d.revisar} netas={d.por_revisar.netas} />}
      {(d.heredado.netas !== 0 || d.heredado.costo !== 0) && (
        <p role="note" aria-label="Costo anterior a compras" className="rounded-xl bg-paper border border-line px-4 py-3 text-[15px]">
          <b>Costo anterior a compras: puede incluir IVA.</b> <span className="num">{pesosExactos(d.heredado.netas)}</span> de las ventas con costo (utilidad{" "}
          <span className="num">{pesosExactos(d.heredado.utilidad)}</span>) son de lotes cuyo costo se registró antes de las compras con IVA separado. Si ese costo se
          digitó con IVA, la utilidad real de esa parte es mayor.
        </p>
      )}

      <section className="tarjeta p-4 sm:p-5" aria-label="Estado de resultados">
        <h2 className="titulo text-xl">Estado de resultados</h2>
        <p className="text-sm text-muted mt-1">Cifras sin IVA. Las devoluciones restan el día en que se hacen; las ventas anuladas no cuentan. El costo es el de cada lote vendido.</p>
        <table className="w-full mt-3 text-[15px]">
          <tbody className="divide-y divide-line">
            {lineas.map((l) => (
              <tr key={l.concepto} className={l.nivel === 0 ? "font-semibold bg-paper" : ""}>
                <th scope="row" className={`text-left font-[inherit] py-2.5 ${l.nivel === 0 ? "px-2" : l.nivel === 2 ? "pl-6 pr-2 text-muted" : "pl-4 pr-2"}`}>
                  {l.concepto}{l.nota && <span className="block text-[13px] text-muted font-normal">{l.nota}</span>}
                </th>
                <td className={`text-right num py-2.5 px-2 whitespace-nowrap ${l.nivel === 0 ? "text-lg" : ""} ${signo(l.valor)}`}>{pesosExactos(l.valor)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section className="tarjeta p-4 sm:p-5" aria-label="Gastos por categoría">
        <div className="flex justify-between items-baseline gap-2 flex-wrap"><h2 className="titulo text-xl">Gastos por categoría</h2>
          <a href={`/gastos?desde=${r.desde}&hasta=${r.hasta}`} className="text-sm font-semibold text-cruz underline underline-offset-4">Ver los gastos del periodo</a></div>
        {d.gastos.length === 0 ? <p className="mt-2 text-muted">No hay gastos registrados en este periodo.</p> : (
          <ul className="mt-3 grid gap-2 text-sm num">
            {d.gastos.map((g) => (
              <li key={g.categoria} className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)_auto] items-center gap-2">
                <span className="font-sans">{nombreCategoria(g.categoria)}</span>
                <span className="h-3 rounded-full bg-paper overflow-hidden"><span className="block h-full rounded-full bg-amber-500" style={{ width: `${(g.valor / Math.max(1, d.total_gastos)) * 100}%` }} /></span>
                <span className="text-right font-semibold">{pesosExactos(g.valor)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
