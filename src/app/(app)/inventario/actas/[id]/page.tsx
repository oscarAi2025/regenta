import { notFound, redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion, puede } from "@/lib/sesion";
import { pesos } from "@/lib/formato";
import { llevaActa, nombreMotivo, unidadesTexto } from "@/lib/ajustes";
import { Imprimible } from "@/components/app/Imprimible";

export const metadata = { title: "Acta de baja" };

const fecha = (d: string | null) => (d ? new Date(d + "T00:00:00").toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" }) : "—");

/** Acta de baja (vencido o avería) o comprobante de cualquier otro ajuste, para imprimir y firmar. */
export default async function Acta({ params }: { params: Promise<{ id: string }> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puede.moverInventario(s.rol)) redirect("/inventario?aviso=permiso");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const costos = puede.verCostos(s.rol);
  const d = await comoUsuario(s, async (c) => {
    const a = (await c.query(`select a.*, to_char(a.creado at time zone 'America/Bogota', 'DD/MM/YYYY') dia, to_char(a.creado at time zone 'America/Bogota', 'HH24:MI') hora,
        e.razon_social, e.nombre_comercial, e.nit, e.dv, e.direccion, e.ciudad, e.telefono, sd.nombre sede, mi.nombre responsable, k.numero conteo
      from ajustes a join empresas e on e.id = a.empresa_id join sedes sd on sd.id = a.sede_id
      left join miembros mi on mi.empresa_id = a.empresa_id and mi.user_id = a.usuario_id left join conteos k on k.id = a.conteo_id
      where a.id = $1 and a.empresa_id = $2`, [id, s.empresa])).rows[0];
    if (!a) return null;
    const lineas = (await c.query(`select p.nombre, p.laboratorio, p.registro_sanitario, p.unidades_por_caja, l.lote, l.vence::text, al.unidades, al.antes,
        ${costos ? "(select costo_unidad::float from lote_costos lc where lc.lote_id = al.lote_id)" : "null::float"} costo
      from ajuste_lineas al join productos p on p.id = al.producto_id join lotes l on l.id = al.lote_id where al.ajuste_id = $1 order by p.nombre, l.lote`, [id])).rows;
    return { a, lineas };
  });
  if (!d) notFound();
  const { a, lineas } = d;
  const acta = llevaActa(a.motivo);
  const total = lineas.reduce((x, l) => x + l.unidades, 0);
  const valor = costos ? lineas.reduce((x, l) => x + (l.costo ?? 0) * l.unidades, 0) : null;
  const sinCosto = costos && lineas.some((l) => l.costo === null);
  const titulo = acta ? "Acta de baja de productos" : "Comprobante de ajuste de inventario";
  const n4 = String(a.numero).padStart(4, "0");
  const responsable = String(a.responsable ?? "").split(" (")[0];
  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-4">
      <Imprimible volver={{ href: "/inventario/ajustes", texto: "Volver a ajustes" }} etiqueta={`${titulo} N.º ${n4}`}>
        <header className="flex flex-wrap justify-between gap-4 border-b-2 border-ink pb-4">
          <div>
            <p className="titulo text-2xl leading-tight">{a.nombre_comercial || a.razon_social}</p>
            <p className="text-sm">{a.razon_social}<br />NIT {a.nit}{a.dv ? `-${a.dv}` : ""}{a.direccion ? ` · ${a.direccion}` : ""}{a.ciudad ? `, ${a.ciudad}` : ""}{a.telefono ? ` · Tel. ${a.telefono}` : ""}</p>
          </div>
          <div className="text-right">
            <h1 className="titulo text-xl leading-tight">{titulo}</h1>
            <p className="num text-lg font-semibold">N.º {n4}</p>
          </div>
        </header>
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-2 py-4 text-[15px]">
          <div><dt className="text-sm text-muted">Fecha</dt><dd className="num font-semibold">{a.dia} · {a.hora}</dd></div>
          <div><dt className="text-sm text-muted">Motivo</dt><dd className="font-semibold">{nombreMotivo(a.motivo)}{a.conteo ? ` (conteo N.º ${a.conteo})` : ""}</dd></div>
          <div><dt className="text-sm text-muted">Sede</dt><dd className="font-semibold">{a.sede}</dd></div>
          <div><dt className="text-sm text-muted">Responsable</dt><dd className="font-semibold">{responsable || "—"}</dd></div>
        </dl>
        {acta ? (
          <p className="text-[15px] pb-3">En la fecha se retiran del inventario disponible para la venta los productos que se detallan, por {a.motivo === "vencido" ? "fecha de vencimiento cumplida" : "avería o rotura"}. Quedan separados y rotulados como «no apto para la venta» hasta su entrega al gestor autorizado de residuos para su destrucción.</p>
        ) : (
          <p className="text-[15px] pb-3">Ajuste del inventario registrado en Regenta. Las unidades positivas entran al lote y las negativas salen.</p>
        )}
        {a.detalle && <p className="text-[15px] pb-3"><b>Detalle:</b> {a.detalle}</p>}
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px] border-collapse">
            <thead><tr className="text-left border-y-2 border-ink">
              <th className="py-2 pr-2 font-semibold">#</th><th className="py-2 pr-2 font-semibold">Producto</th><th className="py-2 pr-2 font-semibold">Lote</th><th className="py-2 pr-2 font-semibold">Vence</th>
              <th className="py-2 pr-2 font-semibold text-right">Cantidad</th>{costos && <><th className="py-2 pr-2 font-semibold text-right">Costo und</th><th className="py-2 font-semibold text-right">Costo total</th></>}
            </tr></thead>
            <tbody>
              {lineas.map((l, i) => (
                <tr key={i} className="border-b border-line align-top">
                  <td className="py-2 pr-2 num">{i + 1}</td>
                  <td className="py-2 pr-2"><span className="font-semibold">{l.nombre}</span><span className="block text-xs text-muted">{l.laboratorio ?? "Sin laboratorio"}{l.registro_sanitario ? ` · Reg. ${l.registro_sanitario}` : ""}</span></td>
                  <td className="py-2 pr-2 num font-semibold">{l.lote}</td>
                  <td className="py-2 pr-2 num">{fecha(l.vence)}</td>
                  <td className="py-2 pr-2 num text-right whitespace-nowrap">{l.unidades > 0 ? "+" : "−"}{Math.abs(l.unidades).toLocaleString("es-CO")} und{l.unidades_por_caja > 1 && Math.abs(l.unidades) >= l.unidades_por_caja ? <span className="block text-xs text-muted">{unidadesTexto(Math.abs(l.unidades), l.unidades_por_caja)}</span> : null}</td>
                  {costos && <><td className="py-2 pr-2 num text-right">{l.costo !== null ? pesos(l.costo) : "—"}</td><td className="py-2 num text-right">{l.costo !== null ? pesos(Math.abs(l.costo * l.unidades)) : "—"}</td></>}
                </tr>
              ))}
            </tbody>
            <tfoot><tr className="border-t-2 border-ink font-semibold">
              <td className="py-2 pr-2" colSpan={4}>Total · {lineas.length} lote{lineas.length === 1 ? "" : "s"}</td>
              <td className="py-2 pr-2 num text-right">{total > 0 ? "+" : "−"}{Math.abs(total).toLocaleString("es-CO")} und</td>
              {costos && <><td /><td className="py-2 num text-right">{pesos(Math.abs(valor ?? 0))}{sinCosto ? "*" : ""}</td></>}
            </tr></tfoot>
          </table>
        </div>
        {sinCosto && <p className="text-xs text-muted mt-1">* Algunos lotes no tienen costo registrado y no suman en el total.</p>}
        <section className={`grid gap-6 mt-10 ${acta ? "sm:grid-cols-3" : "sm:grid-cols-2"}`} aria-label="Firmas">
          {[["Responsable del retiro", responsable], ["Director(a) técnico(a) o regente de farmacia", ""], ...(acta ? [["Gestor de residuos (empresa y NIT)", ""]] : [])].map(([t, nombre]) => (
            <div key={t} className="firma pt-12 border-t-0">
              <div className="border-t border-ink pt-1.5 text-sm">
                <p className="font-semibold">{t}</p>
                <p>Nombre: {nombre || "______________________"}</p>
                <p>C.C. / T.P.: __________________</p>
                {t.startsWith("Gestor") && <p>Fecha de recibido: ___________</p>}
              </div>
            </div>
          ))}
        </section>
        <p className="text-xs text-muted mt-8">Generado en Regenta. Ajuste N.º {a.numero}: los movimientos de inventario quedan registrados con fecha, usuario y motivo, y no se pueden modificar ni borrar.</p>
      </Imprimible>
    </main>
  );
}
