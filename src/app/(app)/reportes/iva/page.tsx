import { redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion } from "@/lib/sesion";
import { Cabecera, Dato } from "@/components/ui/Cabecera";
import { pesosExactos } from "@/lib/compras";
import { puedeResultados } from "@/lib/gastos";
import { auxiliarIva, rango, sumaIva, type FilaIva } from "@/lib/reportes";
import { Pestanas } from "../Pestanas";
import { FiltroRango, textoRango } from "../FiltroRango";

export const metadata = { title: "Auxiliar de IVA" };

/** Tabla por tarifa: pares de columnas (base e IVA) por grupo —lo registrado, lo que suma o resta y el neto— y la fila de
 *  totales. El último grupo es el neto. */
function TablaIva({ titulo, etiqueta, grupos }: { titulo: string; etiqueta: string; grupos: [string, FilaIva[]][] }) {
  const nombres = grupos.map(([n]) => n), ultimo = grupos.length - 1;
  const fila = (t: string, vs: { base: number; iva: number }[], total = false) => (
    <tr key={t} className={total ? "font-semibold bg-paper" : ""}>
      <th scope="row" className="text-left font-[inherit] px-4 py-2.5">{t}</th>
      {vs.flatMap((v, i) => [<td key={`b${i}`} className="px-4 py-2.5 text-right">{pesosExactos(v.base)}</td>, <td key={`i${i}`} className={`px-4 py-2.5 text-right ${i === ultimo ? "font-semibold" : ""}`}>{pesosExactos(v.iva)}</td>])}
    </tr>
  );
  const a = grupos[0][1];
  return (
    <section className="tarjeta" aria-label={etiqueta}>
      <h2 className="titulo text-xl px-4 pt-4">{titulo}</h2>
      <div className="relative overflow-x-auto mt-2">
        <table className={`w-full text-[15px] num ${grupos.length > 3 ? "min-w-[1080px]" : "min-w-[820px]"}`} aria-label={etiqueta}>
          <thead className="text-sm text-muted border-b border-line">
            <tr><th className="px-4 pt-2 text-left font-semibold" rowSpan={2}>Tarifa</th>{nombres.map((n) => <th key={n} colSpan={2} scope="colgroup" className="px-4 pt-2 text-center font-semibold border-b border-line">{n}</th>)}</tr>
            <tr>{nombres.flatMap((n) => [<th key={n + "b"} className="px-4 pb-2 text-right font-medium">Base</th>, <th key={n + "i"} className="px-4 pb-2 text-right font-medium">IVA</th>])}</tr>
          </thead>
          <tbody className="divide-y divide-line">
            {a.map((x, i) => fila(`${x.tarifa} %`, grupos.map(([, f]) => f[i])))}
            {fila("Total", grupos.map(([, f]) => sumaIva(f)), true)}
          </tbody>
        </table>
      </div>
    </section>
  );
}

export default async function AuxiliarIva({ searchParams }: { searchParams: Promise<{ desde?: string; hasta?: string }> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puedeResultados(s.rol)) redirect("/inicio?aviso=permiso");
  const sp = await searchParams;
  const r = rango(sp.desde, sp.hasta);
  const d = await comoUsuario(s, (c) => auxiliarIva(c, s.empresa, r));
  const q = `desde=${r.desde}&hasta=${r.hasta}`;
  const generado = sumaIva(d.ventas_netas), descontable = sumaIva(d.descontable);

  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo="Auxiliar de IVA" sub={textoRango(r)}>
        <a href={`/api/reportes/iva?${q}&formato=excel`} className="btn-borde" download>Descargar en Excel para el contador</a>
      </Cabecera>
      <Pestanas actual="/reportes/iva" rango={q} />
      <p role="note" className="rounded-xl bg-aviso-soft text-aviso px-4 py-3 font-semibold">Auxiliar para tu contador, no reemplaza la declaración.
        <span className="block font-normal text-[15px] mt-0.5">Resume lo que registró Regenta en el periodo que elijas. Tu contador revisa, completa y decide qué se declara.</span></p>
      <FiltroRango ruta="/reportes/iva" r={r} />

      {!d.responsable && (
        <p role="note" className="rounded-xl bg-paper px-4 py-3 text-[15px]"><b>Tu droguería no es responsable de IVA.</b> Tus ventas no llevan IVA y el IVA que pagas en las compras es parte del costo (no se descuenta). Aquí ves la base de tus ventas y notas del periodo.</p>
      )}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3" aria-label="Resumen">
        <Dato titulo={d.responsable ? "IVA de ventas (neto)" : "Ventas netas"} valor={pesosExactos(d.responsable ? generado.iva : generado.base)} tono="cruz" nota={d.responsable ? `base ${pesosExactos(generado.base)}` : "sin IVA: no responsable"} />
        {d.responsable
          ? <Dato titulo="IVA de compras (neto)" valor={pesosExactos(descontable.iva)} nota={`base ${pesosExactos(descontable.base)}`} />
          : <Dato titulo="Notas débito" valor={d.n_debito} nota="mayor valor cobrado" />}
        <Dato titulo="Notas crédito" valor={d.n_notas} nota={d.n_anulaciones ? `${d.n_notas - d.n_anulaciones} devoluciones · ${d.n_anulaciones} anulaciones` : "devoluciones de clientes"} />
        <Dato titulo={d.responsable ? "Compras con IVA" : "Compras"} valor={d.n_compras} tono={d.por_costear ? "aviso" : undefined} nota={d.por_costear ? `${d.por_costear} por costear (sin IVA registrado)` : "registradas en el periodo"} />
      </section>

      <TablaIva titulo={d.responsable ? "IVA de las ventas, por tarifa" : "Ventas del periodo"} etiqueta="IVA de ventas"
        grupos={[["Ventas", d.ventas], ...(d.n_debito ? [["Notas débito", d.notas_debito] as [string, FilaIva[]]] : []), ["Notas crédito", d.notas], ["Neto", d.ventas_netas]]} />
      <p className="text-sm text-muted -mt-2">Ventas por su fecha. Las notas van por su propia fecha: la devolución o la anulación resta en el periodo en que se hace (E.T. art. 484), así un mes ya cerrado no cambia. Una venta anulada antes de enviarse a la DIAN no cuenta.</p>
      {d.responsable && <>
        <TablaIva titulo="IVA de las compras (descontable), por tarifa" etiqueta="IVA de compras" grupos={[["Compras", d.compras], ["Notas crédito de proveedores", d.nc_proveedor], ["Neto", d.descontable]]} />
        <p className="text-sm text-muted -mt-2">Compras registradas por la fecha de la factura del proveedor, con sus fletes y otros cargos. Las notas crédito de proveedores (devoluciones) van por la fecha en que se registraron y su IVA se separa según la tarifa de cada producto devuelto.
          {d.por_costear > 0 && <> Hay <a href="/compras?estado=por_costear" className="underline font-semibold">{d.por_costear} compra{d.por_costear === 1 ? "" : "s"} por costear</a> en el periodo: su IVA aparece cuando completes los costos.</>}</p>
      </>}
    </main>
  );
}
