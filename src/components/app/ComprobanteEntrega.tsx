import { DESTINATARIOS, numeroEntrega } from "@/lib/entregas";
import { presentacionTexto } from "@/lib/formato";
import type { detalleEntrega } from "@/lib/entregas-datos";

type Detalle = NonNullable<Awaited<ReturnType<typeof detalleEntrega>>>;
const dma = (f: string) => f.split("-").reverse().join("/");
const dmaHora = (f: string) => { const [d, h] = f.split(" "); return `${dma(d)} ${h}`; };
const cant = (n: number) => n.toLocaleString("es-CO", { maximumFractionDigits: 3 });

/** Comprobante de una entrega interna: lo mismo en pantalla y en papel. Deja claro que no es una factura de venta. */
export function ComprobanteEntrega({ d }: { d: Detalle }) {
  const { entrega: e, lineas, formula } = d;
  const fila = "py-1.5 px-2 border-b border-line align-top";
  return (
    <article className="grid gap-4 text-[14px] print:text-[10pt]" aria-label={`Entrega ${numeroEntrega(e.numero)}`}>
      <header className="grid sm:grid-cols-[1fr_auto] print:grid-cols-[1fr_auto] gap-3 border-b-2 border-ink pb-3">
        <div>
          <p className="titulo text-xl">{e.empresa}</p>
          <p>{e.razon_social} · NIT {e.nit}{e.dv ? `-${e.dv}` : ""}</p>
          <p>{[e.sede, e.direccion, e.ciudad].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="sm:text-right print:text-right">
          <h2 className="titulo text-2xl">Entrega interna {numeroEntrega(e.numero)}</h2>
          <p className="num">{dmaHora(e.fecha)}</p>
          <p className="font-semibold">No es factura de venta: salida interna de inventario</p>
        </div>
      </header>

      {e.anulada && (
        <p role="status" className="rounded-xl bg-alerta-soft text-alerta px-4 py-3 font-semibold print:border print:border-ink">
          ANULADA el {dmaHora(e.anulada)}{e.anulo ? ` por ${e.anulo}` : ""}: {e.anulada_motivo}. Las unidades volvieron al inventario.
        </p>
      )}

      <dl className="grid sm:grid-cols-2 print:grid-cols-2 gap-x-6 gap-y-1.5">
        <div><dt className="text-muted text-sm">Se entregó a</dt><dd className="font-semibold">{e.destinatario} <span className="font-normal text-muted">· {DESTINATARIOS[e.destinatario_tipo as keyof typeof DESTINATARIOS] ?? e.destinatario_tipo}</span></dd></div>
        {e.documento && <div><dt className="text-muted text-sm">Documento</dt><dd className="num">{e.documento}</dd></div>}
        {e.servicio && <div><dt className="text-muted text-sm">Servicio o área</dt><dd>{e.servicio}</dd></div>}
        <div><dt className="text-muted text-sm">Autoriza</dt><dd>{e.autoriza}</dd></div>
        <div><dt className="text-muted text-sm">Registró</dt><dd>{e.usuario}</dd></div>
        {e.observacion && <div className="sm:col-span-2 print:col-span-2"><dt className="text-muted text-sm">Observación</dt><dd>{e.observacion}</dd></div>}
      </dl>

      <div className="overflow-x-auto max-w-full">
        <table className="w-full min-w-[520px] print:min-w-0 border-collapse">
          <thead><tr className="text-left text-muted text-sm"><th className={fila}>Producto</th><th className={fila}>Ubicación</th><th className={fila}>Lote</th><th className={fila}>Vence</th><th className={`${fila} text-right`}>Cantidad</th><th className={`${fila} text-right`}>Unidades</th></tr></thead>
          <tbody>{lineas.map((l, i) => (
            <tr key={i}>
              <td className={fila}>{l.descripcion}{l.control_especial ? <span className="ml-1.5 text-[12px] font-semibold text-alerta">Control especial</span> : null}</td>
              <td className={`${fila} num`}>{l.ubicacion ?? "—"}</td>
              <td className={`${fila} num`}>{l.lote}</td>
              <td className={`${fila} num`}>{l.vence ? dma(l.vence) : "—"}</td>
              <td className={`${fila} num text-right`}>{cant(l.cantidad)} {presentacionTexto(l.presentacion, l.unidades_por_caja)}</td>
              <td className={`${fila} num text-right`}>{l.unidades}</td>
            </tr>
          ))}</tbody>
          <tfoot><tr><td colSpan={5} className="py-1.5 px-2 text-right font-semibold">Total de unidades</td><td className="py-1.5 px-2 num text-right font-semibold">{e.unidades}</td></tr></tfoot>
        </table>
      </div>

      {formula && (
        <section aria-label="Fórmula médica" className="rounded-xl border border-line p-3 print:border-ink">
          <p className="font-semibold">{formula.control ? "Fórmula de control especial (recetario oficial)" : "Fórmula médica"}</p>
          {formula.paciente_nombre ? (
            <p className="mt-1">Paciente {formula.paciente_nombre} · {formula.paciente_tipo_doc} {formula.paciente_doc} · Prescriptor {formula.medico_nombre} (reg. {formula.medico_registro}) ·
              N.º {formula.formula_numero} del {formula.formula_fecha ? dma(formula.formula_fecha) : ""}</p>
          ) : <p className="mt-1 text-muted">Verificada al entregar.</p>}
        </section>
      )}

      <div className="hidden print:grid grid-cols-2 gap-10 pt-12">
        <p className="border-t border-ink pt-1">Entrega: {e.usuario}</p>
        <p className="border-t border-ink pt-1">Recibe: {e.destinatario}{e.documento ? ` · ${e.documento}` : ""}</p>
      </div>
    </article>
  );
}
