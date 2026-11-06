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

/** Tabla por tarifa: tres pares de columnas (lo registrado, lo que resta y el neto) y la fila de totales. */
function TablaIva({ titulo, etiqueta, a, b, neto, nombres }: { titulo: string; etiqueta: string; a: FilaIva[]; b: FilaIva[]; neto: FilaIva[]; nombres: [string, string, string] }) {
  const fila = (t: string, x: { base: number; iva: number }, y: { base: number; iva: number }, z: { base: number; iva: number }, total = false) => (
    <tr key={t} className={total ? "font-semibold bg-paper" : ""}>
      <th scope="row" className="text-left font-[inherit] px-4 py-2.5">{t}</th>
      {[x, y, z].flatMap((v, i) => [<td key={`b${i}`} className="px-4 py-2.5 text-right">{pesosExactos(v.base)}</td>, <td key={`i${i}`} className={`px-4 py-2.5 text-right ${i === 2 ? "font-semibold" : ""}`}>{pesosExactos(v.iva)}</td>])}
    </tr>
  );
  return (
    <section className="tarjeta" aria-label={etiqueta}>
      <h2 className="titulo text-xl px-4 pt-4">{titulo}</h2>
      <div className="relative overflow-x-auto mt-2">
        <table className="w-full text-[15px] num min-w-[820px]" aria-label={etiqueta}>
          <thead className="text-sm text-muted border-b border-line">
            <tr><th className="px-4 pt-2 text-left font-semibold" rowSpan={2}>Tarifa</th>{nombres.map((n) => <th key={n} colSpan={2} scope="colgroup" className="px-4 pt-2 text-center font-semibold border-b border-line">{n}</th>)}</tr>
            <tr>{nombres.flatMap((n) => [<th key={n + "b"} className="px-4 pb-2 text-right font-medium">Base</th>, <th key={n + "i"} className="px-4 pb-2 text-right font-medium">IVA</th>])}</tr>
          </thead>
          <tbody className="divide-y divide-line">
            {a.map((x, i) => fila(`${x.tarifa} %`, x, b[i], neto[i]))}
            {fila("Total", sumaIva(a), sumaIva(b), sumaIva(neto), true)}
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
        <a href={`/api/reportes/iva?${q}&formato=csv`} className="btn-borde" download>Descargar CSV para el contador</a>
      </Cabecera>
      <Pestanas actual="/reportes/iva" rango={q} />
      <p role="note" className="rounded-xl bg-aviso-soft text-aviso px-4 py-3 font-semibold">Auxiliar para tu contador, no reemplaza la declaración.
        <span className="block font-normal text-[15px] mt-0.5">Resume lo que registró Regenta en el periodo que elijas. Tu contador revisa, completa y decide qué se declara.</span></p>
      <FiltroRango ruta="/reportes/iva" r={r} />

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3" aria-label="Resumen">
        <Dato titulo="IVA de ventas (neto)" valor={pesosExactos(generado.iva)} tono="cruz" nota={`base ${pesosExactos(generado.base)}`} />
        <Dato titulo="IVA de compras (neto)" valor={pesosExactos(descontable.iva)} nota={`base ${pesosExactos(descontable.base)}`} />
        <Dato titulo="Notas crédito" valor={d.n_notas} nota="devoluciones de clientes" />
        <Dato titulo="Compras con IVA" valor={d.n_compras} tono={d.por_costear ? "aviso" : undefined} nota={d.por_costear ? `${d.por_costear} por costear (sin IVA registrado)` : "registradas en el periodo"} />
      </section>

      <TablaIva titulo="IVA de las ventas, por tarifa" etiqueta="IVA de ventas" a={d.ventas} b={d.notas} neto={d.ventas_netas} nombres={["Ventas", "Notas crédito", "Neto"]} />
      <p className="text-sm text-muted -mt-2">Ventas cerradas por la fecha de la venta (las anuladas no cuentan); notas crédito de las devoluciones por la fecha de la devolución.</p>
      <TablaIva titulo="IVA de las compras (descontable), por tarifa" etiqueta="IVA de compras" a={d.compras} b={d.nc_proveedor} neto={d.descontable} nombres={["Compras", "Notas crédito de proveedores", "Neto"]} />
      <p className="text-sm text-muted -mt-2">Compras registradas por la fecha de la factura del proveedor. Las notas crédito de proveedores (devoluciones) van por la fecha en que se registraron y su IVA se separa según la tarifa de cada producto devuelto.
        {d.por_costear > 0 && <> Hay <a href="/compras?estado=por_costear" className="underline font-semibold">{d.por_costear} compra{d.por_costear === 1 ? "" : "s"} por costear</a> en el periodo: su IVA aparece cuando completes los costos.</>}</p>
    </main>
  );
}
