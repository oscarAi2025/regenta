import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion } from "@/lib/sesion";
import { Cabecera, Dato } from "@/components/ui/Cabecera";
import { MEDIO, pesos } from "@/lib/formato";
import { estadoCuenta, hoyBogota, normalizarCredito, permisoCartera, whatsappEstado } from "@/lib/cartera";
import { EditarCliente } from "../EditarCliente";
import { CreditoCliente } from "../CreditoCliente";
import { RecibirAbono } from "../RecibirAbono";
import { AnularRecibo } from "../AnularRecibo";

export const metadata = { title: "Ficha del cliente" };

/** Ficha del cliente (dueño y administrador): datos, crédito (cupo, plazo, bloqueo, notas) y estado de cuenta con sus
 *  facturas, devoluciones, abonos y recibos de caja; imprimible y para enviar por WhatsApp. */
export default async function FichaCliente({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ anulado?: string }> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!permisoCartera.gestionar(s.rol)) redirect("/inicio?aviso=permiso");
  const { id } = await params;
  const { anulado } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const d = await comoUsuario(s, async (c) => {
    const ec = await estadoCuenta(c, s.empresa, id);
    if (!ec) return null;
    const credito = normalizarCredito((await c.query(`select estado_credito($1) e`, [id])).rows[0].e);
    const empresa = (await c.query(`select coalesce(nombre_comercial, razon_social) n from empresas where id = $1`, [s.empresa])).rows[0].n as string;
    const alegra = (await c.query(`select count(*)::int n, coalesce(sum(total) filter (where estado <> 'anulada'), 0)::float total, max(fecha)::text ultima from ventas_externas where empresa_id = $1 and cliente_id = $2`, [s.empresa, id])).rows[0] as { n: number; total: number; ultima: string | null };
    return { ec, credito, empresa, alegra };
  });
  if (!d) notFound();
  const { ec, credito } = d;
  const cl = ec.cliente;
  const documento = `${cl.tipo_doc} ${cl.numero_doc}${cl.dv ? `-${cl.dv}` : ""}`;
  const vencido = ec.pendientes.filter((p) => p.dias_mora > 0).reduce((a, p) => a + p.saldo, 0);
  const wa = whatsappEstado(cl.telefono, d.empresa, cl.nombre, ec.saldo, ec.pendientes, hoyBogota());

  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Link href="/clientes" className="text-sm font-semibold text-cruz w-fit">← Clientes</Link>
      <Cabecera titulo={cl.nombre} sub={<span className="num">{documento}{cl.email ? ` · ${cl.email}` : ""}{cl.telefono ? ` · ${cl.telefono}` : ""}</span>}>
        <a href={`/tiquete/estado-cuenta/${cl.id}`} target="_blank" rel="noopener" className="btn-borde h-11 inline-flex items-center">Imprimir estado de cuenta</a>
        <a href={wa} target="_blank" rel="noopener" className="btn-borde h-11 inline-flex items-center">{cl.telefono ? "Enviar por WhatsApp" : "Compartir por WhatsApp"}</a>
        {d.alegra.n > 0 && <Link href={`/ventas/historial?cliente=${cl.id}`} className="btn-borde h-11 inline-flex items-center">Compras en Alegra ({d.alegra.n} · {pesos(d.alegra.total)})</Link>}
      </Cabecera>
      {anulado && /^\d+$/.test(anulado) && <p role="status" className="rounded-xl bg-aviso-soft text-aviso px-4 py-3 font-semibold">Recibo RC-{anulado} anulado: los saldos volvieron a sus facturas.</p>}

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Dato titulo="Debe" valor={pesos(ec.saldo)} tono={ec.saldo ? "cruz" : undefined} nota={`${ec.pendientes.length} factura${ec.pendientes.length === 1 ? "" : "s"} pendiente${ec.pendientes.length === 1 ? "" : "s"}`} />
        <Dato titulo="Vencido" valor={pesos(vencido)} tono={vencido ? "alerta" : undefined} nota={credito.dias_mora ? `${credito.dias_mora} días de mora máx.` : "al día"} />
        <Dato titulo="Cupo" valor={credito.cupo === null ? "Sin cupo" : pesos(credito.cupo)} nota={cl.plazo ? `plazo ${cl.plazo} días` : "sin plazo fijo"} />
        <Dato titulo="Disponible" valor={credito.cupo_disponible === null ? "—" : pesos(credito.cupo_disponible)} tono={credito.bloqueado ? "alerta" : undefined} nota={credito.bloqueado ? "crédito bloqueado" : credito.limite_mora !== null ? `bloquea con más de ${credito.limite_mora} días de mora` : "la mora no bloquea"} />
      </section>

      <div className="grid lg:grid-cols-[minmax(0,1fr)_400px] gap-5 items-start">
        <div className="grid gap-5 min-w-0">
          <section className="tarjeta overflow-x-auto relative" aria-label="Facturas pendientes">
            <h2 className="titulo text-xl px-4 pt-4">Facturas pendientes</h2>
            <table className="w-full text-[15px] min-w-[640px] mt-2">
              <thead className="text-left text-sm text-muted border-b border-line"><tr>
                <th className="px-4 py-2 font-semibold">Factura</th><th className="px-4 py-2 font-semibold">Vence</th>
                <th className="px-4 py-2 font-semibold text-right">Total</th><th className="px-4 py-2 font-semibold text-right">Abonado</th><th className="px-4 py-2 font-semibold text-right">Saldo</th></tr></thead>
              <tbody className="divide-y divide-line">
                {ec.pendientes.map((p) => (
                  <tr key={p.venta_id}>
                    <td className="px-4 py-2.5"><Link href={`/ventas/${p.venta_id}`} className="num font-semibold hover:underline">{p.factura}</Link><p className="text-sm text-muted">{p.fecha}</p></td>
                    <td className="px-4 py-2.5 num">{p.vence}{p.dias_mora > 0 && <p className="text-sm text-alerta">{p.dias_mora} día{p.dias_mora === 1 ? "" : "s"} de mora</p>}</td>
                    <td className="px-4 py-2.5 num text-right">{pesos(p.total)}</td>
                    <td className="px-4 py-2.5 num text-right text-muted">{pesos(p.abonado)}</td>
                    <td className="px-4 py-2.5 num text-right font-semibold">{pesos(p.saldo)}</td>
                  </tr>
                ))}
                {ec.pendientes.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted">Está a paz y salvo.</td></tr>}
              </tbody>
            </table>
          </section>

          <section className="tarjeta overflow-x-auto relative" aria-label="Estado de cuenta">
            <div className="px-4 pt-4 flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="titulo text-xl">Estado de cuenta</h2>
              <p className="text-sm text-muted">Facturas a crédito, devoluciones, abonos y recibos de caja</p>
            </div>
            <table className="w-full text-[15px] min-w-[720px] mt-2">
              <thead className="text-left text-sm text-muted border-b border-line"><tr>
                <th className="px-4 py-2 font-semibold">Fecha</th><th className="px-4 py-2 font-semibold">Movimiento</th>
                <th className="px-4 py-2 font-semibold text-right">Cargo</th><th className="px-4 py-2 font-semibold text-right">Pago</th><th className="px-4 py-2 font-semibold text-right">Saldo</th></tr></thead>
              <tbody className="divide-y divide-line">
                {ec.movimientos.map((m, i) => (
                  <tr key={i} className={m.anulado ? "text-muted" : undefined}>
                    <td className="px-4 py-2 num whitespace-nowrap">{m.fecha}</td>
                    <td className="px-4 py-2">{m.enlace ? <Link href={m.enlace} className="hover:underline" {...(m.tipo === "recibo" ? { target: "_blank" } : {})}>{m.detalle}</Link> : m.detalle}
                      {m.anulado && <span className="ml-2 rounded-md bg-paper px-1.5 py-0.5 text-xs font-semibold">anulado</span>}</td>
                    <td className="px-4 py-2 num text-right">{m.cargo ? pesos(m.cargo) : ""}</td>
                    <td className={`px-4 py-2 num text-right ${m.anulado ? "line-through" : ""}`}>{m.cargo ? "" : pesos(m.valor)}</td>
                    <td className="px-4 py-2 num text-right font-semibold">{pesos(m.saldo ?? 0)}</td>
                  </tr>
                ))}
                {ec.movimientos.length === 0 && <tr><td colSpan={5} className="px-4 py-8 text-center text-muted">Aún no tiene facturas a crédito.</td></tr>}
              </tbody>
              {ec.movimientos.length > 0 && (
                <tfoot className="border-t-2 border-line font-semibold"><tr>
                  <td className="px-4 py-3" colSpan={2}>Saldo</td><td className="px-4 py-3 num text-right">{pesos(ec.cargos)}</td>
                  <td className="px-4 py-3 num text-right">{pesos(ec.abonos)}</td><td className="px-4 py-3 num text-right" data-saldo={ec.saldo}>{pesos(ec.saldo)}</td></tr></tfoot>
              )}
            </table>
          </section>

          <section className="tarjeta overflow-x-auto relative" aria-label="Recibos de caja">
            <h2 className="titulo text-xl px-4 pt-4">Recibos de caja</h2>
            {ec.recibos.length === 0 ? <p className="px-4 py-4 text-muted">Aún no hay recibos de caja de este cliente.</p> : (
              <table className="w-full text-[15px] min-w-[640px] mt-2">
                <thead className="text-left text-sm text-muted border-b border-line"><tr>
                  <th className="px-4 py-2 font-semibold">Recibo</th><th className="px-4 py-2 font-semibold">Medio</th><th className="px-4 py-2 font-semibold text-right">Valor</th><th className="px-4 py-2 font-semibold"><span className="sr-only">Acciones</span></th></tr></thead>
                <tbody className="divide-y divide-line">
                  {ec.recibos.map((r) => (
                    <tr key={r.id} className="align-top">
                      <td className="px-4 py-2.5"><a href={`/tiquete/recibo/${r.id}`} target="_blank" rel="noopener" className="num font-semibold hover:underline">RC-{r.numero}</a>
                        <p className="text-sm text-muted">{r.fecha}{r.quien ? ` · ${String(r.quien).split(" (")[0]}` : ""}</p>
                        {r.anulado && <p className="text-sm text-alerta">Anulado: {r.motivo}</p>}</td>
                      <td className="px-4 py-2.5">{MEDIO[r.medio] ?? r.medio}{r.referencia ? <p className="text-sm text-muted">{r.referencia}</p> : null}</td>
                      <td className={`px-4 py-2.5 num text-right font-semibold ${r.anulado ? "line-through text-muted" : ""}`}>{pesos(r.valor)}</td>
                      <td className="px-4 py-2.5">{!r.anulado && <AnularRecibo id={r.id} numero={r.numero} />}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </section>
        </div>

        <div className="grid gap-5 min-w-0">
          <RecibirAbono abierto cliente={{ id: cl.id, nombre: cl.nombre, documento, saldo: ec.saldo, facturas: ec.pendientes.length, dias_mora: credito.dias_mora }} />
          <CreditoCliente id={cl.id} notas={cl.notas} inicial={credito} />
          <section className="tarjeta p-5 grid gap-2">
            <h2 className="titulo text-xl">Datos del cliente</h2>
            <p className="text-sm text-muted">Cliente desde {cl.desde}. {cl.autoriza_datos ? "Autoriza el tratamiento de sus datos." : "No consta la autorización de tratamiento de datos."}</p>
            <EditarCliente c={{ id: cl.id, tipo_doc: cl.tipo_doc, numero_doc: cl.numero_doc, nombre: cl.nombre, email: cl.email ?? "", telefono: cl.telefono ?? "", autoriza_datos: !!cl.autoriza_datos }} />
          </section>
        </div>
      </div>
    </main>
  );
}
