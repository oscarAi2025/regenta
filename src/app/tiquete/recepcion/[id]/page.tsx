import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion } from "@/lib/sesion";
import { puedeCompras } from "@/lib/compras";
import { detalleCompra } from "@/lib/compras-datos";
import { unidadesTexto } from "@/lib/ajustes";
import { Imprimible } from "@/components/app/Imprimible";

// Acta de recepción de la mercancía de una compra, para imprimir y firmar: lote, vencimiento, registro INVIMA, cantidad,
// casillas de conforme / no conforme y firma de quien recibe. Es un registro interno de la droguería (sin costos).
export const metadata: Metadata = { title: "Acta de recepción", robots: { index: false, follow: false } };

const fecha = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");
const casilla = <span aria-hidden="true" className="inline-block w-4 h-4 border-2 border-ink rounded-sm align-middle" />;

export default async function ActaRecepcion({ params }: { params: Promise<{ id: string }> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puedeCompras.ver(s.rol)) redirect("/inicio?aviso=permiso");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const d = await comoUsuario(s, async (c) => {
    const k = await detalleCompra(c, s.empresa, id, false); // el acta no lleva costos
    if (!k) return null;
    const e = (await c.query(`select razon_social, nombre_comercial, nit, dv, direccion, ciudad, telefono from empresas where id = $1`, [s.empresa])).rows[0];
    return { ...k, e };
  });
  if (!d) notFound();
  const { compra: c, lineas, e } = d;
  const n4 = String(c.numero).padStart(4, "0");
  const recibe = String(c.recibe ?? "").split(" (")[0];
  const total = lineas.reduce((a, l) => a + l.unidades + l.bonificadas, 0);
  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-4 bg-paper min-h-screen">
      <Imprimible volver={{ href: `/compras/${c.id}`, texto: "Volver a la compra" }} etiqueta={`Acta de recepción N.º ${n4}`}>
        <header className="flex flex-wrap justify-between gap-4 border-b-2 border-ink pb-4">
          <div className="min-w-0">
            <p className="titulo text-2xl leading-tight">{e.nombre_comercial || e.razon_social}</p>
            <p className="text-sm">{e.razon_social}<br />NIT {e.nit}{e.dv ? `-${e.dv}` : ""}{e.direccion ? ` · ${e.direccion}` : ""}{e.ciudad ? `, ${e.ciudad}` : ""}{e.telefono ? ` · Tel. ${e.telefono}` : ""}</p>
          </div>
          <div className="text-right">
            <h1 className="titulo text-xl leading-tight">Acta de recepción de mercancía</h1>
            <p className="num text-lg font-semibold">Compra N.º {n4}</p>
          </div>
        </header>
        {c.estado === "anulada" && <p className="mt-3 rounded-lg border-2 border-alerta text-alerta px-3 py-2 font-semibold">Compra anulada: {c.motivo_anulacion}</p>}
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 py-4 text-[15px]">
          <div className="col-span-2"><dt className="text-sm text-muted">Proveedor</dt><dd className="font-semibold">{c.proveedor}{c.proveedor_nit ? ` · NIT ${c.proveedor_nit}` : ""}</dd></div>
          <div><dt className="text-sm text-muted">Factura</dt><dd className="num font-semibold">{c.numero_factura} · {fecha(c.fecha_factura)}</dd></div>
          <div><dt className="text-sm text-muted">Recibido</dt><dd className="num font-semibold">{c.creado}</dd></div>
          <div><dt className="text-sm text-muted">Sede</dt><dd className="font-semibold">{c.sede}</dd></div>
          <div><dt className="text-sm text-muted">Recibió en Regenta</dt><dd className="font-semibold">{recibe || "—"}</dd></div>
        </dl>
        <p className="text-[15px] pb-3">Revisión de cada producto al recibirlo: empaque y rotulado en buen estado, registro sanitario, lote y fecha de vencimiento iguales a los de la factura y, si aplica, condiciones de temperatura en el transporte. Marque conforme o no conforme y anote la novedad.</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[640px] border-collapse">
            <thead><tr className="text-left border-y-2 border-ink">
              <th className="py-2 pr-2 font-semibold">#</th><th className="py-2 pr-2 font-semibold">Producto</th><th className="py-2 pr-2 font-semibold">Registro INVIMA</th>
              <th className="py-2 pr-2 font-semibold">Lote</th><th className="py-2 pr-2 font-semibold">Vence</th><th className="py-2 pr-2 font-semibold text-right">Cantidad</th>
              <th className="py-2 pr-2 font-semibold text-center">Conforme</th><th className="py-2 pr-2 font-semibold text-center">No conforme</th><th className="py-2 font-semibold w-36">Novedad</th>
            </tr></thead>
            <tbody>
              {lineas.map((l, i) => (
                <tr key={l.id} className="border-b border-line align-top">
                  <td className="py-2 pr-2 num">{i + 1}</td>
                  <td className="py-2 pr-2"><span className="font-semibold">{l.nombre}</span><span className="block text-xs text-muted">{l.laboratorio ?? "Sin laboratorio"}</span></td>
                  <td className="py-2 pr-2 num">{l.registro_sanitario ?? "—"}</td>
                  <td className="py-2 pr-2 num font-semibold">{l.lote}</td>
                  <td className="py-2 pr-2 num">{fecha(l.vence)}</td>
                  <td className="py-2 pr-2 num text-right whitespace-nowrap">{(l.unidades + l.bonificadas).toLocaleString("es-CO")} und
                    {l.unidades_por_caja > 1 && l.unidades + l.bonificadas >= l.unidades_por_caja ? <span className="block text-xs text-muted">{unidadesTexto(l.unidades + l.bonificadas, l.unidades_por_caja)}</span> : null}
                    {l.bonificadas ? <span className="block text-xs text-muted">{l.bonificadas} bonificadas</span> : null}</td>
                  <td className="py-2 pr-2 text-center">{casilla}</td>
                  <td className="py-2 pr-2 text-center">{casilla}</td>
                  <td className="py-2 border-b border-dotted border-ink" />
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="border-t-2 border-ink font-semibold">
              <td className="py-2 pr-2" colSpan={5}>Total · {lineas.length} línea{lineas.length === 1 ? "" : "s"}</td>
              <td className="py-2 pr-2 num text-right">{total.toLocaleString("es-CO")} und</td><td colSpan={3} />
            </tr></tfoot>
          </table>
        </div>
        <div className="mt-5 text-[15px] grid gap-5"><p className="flex gap-2"><span className="shrink-0">Observaciones:</span><span className="flex-1 border-b border-ink" /></p><span className="block border-b border-ink" /></div>
        <section className="grid gap-6 mt-10 sm:grid-cols-3" aria-label="Firmas">
          {[["Recibe", recibe], ["Director(a) técnico(a) o regente de farmacia", ""], ["Entrega (proveedor o transportador)", ""]].map(([t, nombre]) => (
            <div key={t} className="firma pt-12">
              <div className="border-t border-ink pt-1.5 text-sm">
                <p className="font-semibold">{t}</p>
                <p>Nombre: {nombre || "______________________"}</p>
                <p>C.C.: __________________</p>
              </div>
            </div>
          ))}
        </section>
        <p className="text-xs text-muted mt-8">Generado en Regenta. Compra N.º {c.numero}: las entradas al inventario quedan registradas con fecha, usuario, lote y vencimiento, y no se pueden modificar ni borrar.</p>
      </Imprimible>
    </main>
  );
}
