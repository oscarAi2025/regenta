import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion, puede } from "@/lib/sesion";
import { MEDIO, pesos } from "@/lib/formato";

export const metadata = { title: "Venta de Alegra" };

type Nota = { numero: string; fecha: string; tipo: string; total: number };
const TIPO_NOTA: Record<string, string> = { anulacion: "Anulación", devolucion: "Devolución", otro: "Ajuste" };
type Linea = { nombre: string; cantidad: number; precio: number; descuento: number; iva_pct: number; total: number; lote: string | null; vence: string | null };
const ESTADO: Record<string, string> = { pagada: "Pagada", por_cobrar: "Por cobrar", anulada: "Anulada", borrador: "Borrador" };
const DIAN: Record<string, string> = { STAMPED_AND_ACCEPTED: "Aceptada por la DIAN", STAMPED_AND_ACCEPTED_WITH_OBSERVATIONS: "Aceptada por la DIAN (con observaciones)", PENDING: "No se envió a la DIAN" };

/** Detalle de una venta hecha en Alegra, tal como quedó allá. Si quedó por cobrar, muestra lo que se ha abonado en Regenta. */
export default async function VentaAlegra({ params }: { params: Promise<{ id: string }> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puede.vender(s.rol)) redirect("/inicio?aviso=permiso");
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  const d = await comoUsuario(s, async (c) => {
    const x = (await c.query(`select x.*, x.fecha::text fecha_txt, x.vence::text vence_txt, e.razon_social, e.nit, e.dv from ventas_externas x join empresas e on e.id = x.empresa_id
      where x.id = $1 and x.empresa_id = $2`, [id, s.empresa])).rows[0];
    if (!x) return null;
    // La cartera de Regenta (si quedó por cobrar): saldo y abonos de hoy.
    const cartera = puede.cartera(s.rol) ? (await c.query(`select vc.venta_id, vc.saldo::float, vc.abonado::float, vc.dias_mora from v_cartera vc join ventas v on v.id = vc.venta_id
      where v.empresa_id = $1 and v.origen = $2 and v.externo_id = $3`, [s.empresa, x.origen, x.externo_id])).rows[0] : null;
    const abonos = cartera ? (await c.query(`select to_char(creado at time zone 'America/Bogota', 'DD/MM/YYYY') fecha, medio, valor::float, anulado from abonos where venta_id = $1 order by creado`, [cartera.venta_id])).rows : [];
    return { x, cartera, abonos };
  });
  if (!d) notFound();
  const { x } = d;
  const lineas = x.lineas as Linea[];
  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[440px_minmax(0,1fr)] gap-6 items-start">
      <article className="tirilla rounded-t-2xl px-6 pt-6 pb-10" aria-label="Venta de Alegra">
        <p className="text-center titulo text-lg">{x.razon_social}</p>
        <p className="text-center text-sm text-muted">NIT {x.nit}{x.dv ? `-${x.dv}` : ""}</p>
        <div className="corte my-4" />
        <p className="flex justify-between text-sm"><span>{x.documento === "pos" ? "Documento POS electrónico" : "Factura electrónica"} · Alegra</span><span className="num font-semibold">{x.prefijo}{x.numero}</span></p>
        <p className="text-sm text-muted">{new Date(x.fecha_txt + "T12:00:00").toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric" })}</p>
        {x.cliente_nombre && <p className="mt-2 text-sm"><span className="text-muted">Cliente: </span>{x.cliente_nombre}{x.cliente_doc && <span className="num"> · {x.cliente_doc}</span>}</p>}
        <div className="corte my-4" />
        <ul className="grid gap-3">
          {lineas.map((l, i) => (
            <li key={i}>
              <p className="text-[15px] leading-snug">{l.nombre}</p>
              <p className="flex justify-between text-sm text-muted num"><span>{l.cantidad} × {pesos(l.precio)}{l.iva_pct ? ` · IVA ${l.iva_pct} %` : ""}{l.lote ? ` · lote ${l.lote}` : ""}</span><span className="text-ink font-semibold">{pesos(l.total)}</span></p>
              {l.descuento > 0 && <p className="text-sm text-cruz num">Descuento {l.descuento.toLocaleString("es-CO", { maximumFractionDigits: 2 })} % (−{pesos(l.cantidad * l.precio * l.descuento / 100)})</p>}
            </li>
          ))}
        </ul>
        <div className="corte my-4" />
        <dl className="grid gap-1 text-sm num">
          <div className="flex justify-between"><dt className="text-muted">Subtotal</dt><dd>{pesos(Number(x.subtotal))}</dd></div>
          {Number(x.descuento) > 0 && <div className="flex justify-between"><dt className="text-muted">Descuento</dt><dd>−{pesos(Number(x.descuento))}</dd></div>}
          <div className="flex justify-between"><dt className="text-muted">IVA</dt><dd>{pesos(Number(x.iva))}</dd></div>
          <div className="flex justify-between text-base font-semibold"><dt>Total</dt><dd>{pesos(Number(x.total))}</dd></div>
          {(x.notas as Nota[] | null)?.map((n) => (
            <div key={n.numero} className="flex justify-between text-alerta"><dt>Nota crédito {n.numero} · {new Date(n.fecha + "T12:00:00").toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" })} · {TIPO_NOTA[n.tipo] ?? "Ajuste"}</dt><dd>−{pesos(n.total)}</dd></div>
          ))}
          {Number(x.devuelto) > 0 && <div className="flex justify-between font-semibold"><dt>Queda vendido</dt><dd>{pesos(Number(x.total) - Number(x.devuelto))}</dd></div>}
        </dl>
      </article>
      <section className="grid gap-4">
        <Link href="/ventas/historial" className="text-sm font-semibold text-cruz w-fit">← Historial de Alegra</Link>
        <div className="tarjeta p-5 grid gap-2">
          <p className="titulo text-lg">{ESTADO[x.estado]}{x.estado === "por_cobrar" && !d.cartera ? ` · debía ${pesos(Number(x.saldo))}` : ""}</p>
          <p className="text-sm text-muted">{DIAN[x.estado_dian ?? ""] ?? x.estado_dian ?? "Sin estado DIAN"}{x.estado === "por_cobrar" ? " · forma de pago: crédito" : x.forma_pago ? ` · pago: ${MEDIO[String(x.forma_pago).toLowerCase()] ?? x.forma_pago}` : ""}</p>
          {x.cufe && <p className="text-xs text-muted break-all">CUFE {x.cufe}</p>}
          <p className="text-sm">Esta venta se hizo en Alegra y es solo de consulta{(x.notas as Nota[] | null)?.length ? ": sus notas crédito están en el detalle" : ""}.</p>
        </div>
        {d.cartera && (
          <div className="tarjeta p-5 grid gap-2">
            <p className="titulo">Cartera en Regenta</p>
            <p className="text-sm">Saldo por cobrar: <span className="num font-semibold">{pesos(d.cartera.saldo)}</span>{d.cartera.dias_mora > 0 ? ` · ${d.cartera.dias_mora} días vencida` : ""}</p>
            {d.abonos.length > 0 && <ul className="text-sm num">{d.abonos.map((a, i) => <li key={i} className={a.anulado ? "line-through text-muted" : ""}>{a.fecha} · {MEDIO[a.medio] ?? a.medio} · {pesos(a.valor)}</li>)}</ul>}
            {x.cliente_id && <Link href={`/clientes/${x.cliente_id}`} className="btn-borde w-fit">Recibir un pago (ficha del cliente)</Link>}
          </div>
        )}
      </section>
    </main>
  );
}
