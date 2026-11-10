import { NOMBRE_NUMERACION } from "@/lib/dian/tipos";
import { redirect } from "next/navigation";
import { sinRLS } from "@/lib/db";
import { leerSesion } from "@/lib/sesion";
import { Cabecera } from "@/components/ui/Cabecera";
import { Equipo, Configuracion } from "./Equipo";
import { suscripcionStripe } from "@/lib/pagos";
import { Renovacion } from "./Renovacion";
import { Cajas } from "./Cajas";
import { CUPO_DOCS, DOC_EXTRA, limite } from "@/lib/planes";
import { datosQr } from "@/lib/pagos";
import { SubirLogo } from "@/components/SubirLogo";

export const metadata = { title: "Mi droguería" };

/** Datos de la droguería, equipo y plan: solo el dueño. */
export default async function PaginaEquipo() {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (s.rol !== "dueno") redirect("/inicio");
  // Lee cuentas (correo y si ya creó contraseña): sin RLS, siempre filtrado por la empresa de la sesión del dueño.
  const d = await sinRLS(async (c) => {
    const e = (await c.query(`select nit, dv, razon_social, nombre_comercial, direccion, ciudad, telefono, email, plan, estado, demo,
        descuento_max_cajero::float, egreso_max_cajero::float, responsable_iva, plan_siguiente, logo from empresas where id = $1`, [s.empresa])).rows[0];
    const miembros = (await c.query(`select m.user_id, m.nombre, m.rol, m.activo, cu.email, cu.clave_hash is not null activo_cuenta
      from miembros m left join cuentas cu on cu.id = m.user_id where m.empresa_id = $1 order by m.rol = 'dueno' desc, m.activo desc, m.nombre`, [s.empresa])).rows;
    const plan = (await c.query(`select to_char(max(vence), 'DD/MM/YYYY') vence, max(vence) < current_date vencido from pagos_suscripcion where empresa_id = $1 and estado = 'aprobado'`, [s.empresa])).rows[0];
    // Cuentan para el cupo los documentos reales (numeración de producción); en la demo, todos.
    const mes = (await c.query(`select count(*)::int n from documentos_dian d where d.empresa_id = $1 and d.creado >= date_trunc('month', now() at time zone 'America/Bogota') at time zone 'America/Bogota'
      and ($2 or (not d.simulado and exists (select 1 from resoluciones_dian r where r.empresa_id = d.empresa_id and r.prefijo = d.prefijo and r.tipo = d.tipo and not r.pruebas)))`, [s.empresa, !!e.demo])).rows[0].n;
    const cargos = (await c.query(`select to_char(mes, 'MM/YYYY') mes, extra, monto::float, referencia, estado from cargos_documentos where empresa_id = $1 order by mes desc limit 12`, [s.empresa])).rows;
    const res = (await c.query(`select tipo, prefijo, desde, hasta, actual, pruebas, to_char(vigente_hasta, 'DD/MM/YYYY') vence from resoluciones_dian where empresa_id = $1 and activa order by tipo`, [s.empresa])).rows;
    const stripe = await suscripcionStripe(c, s.empresa);
    const cajas = (await c.query(`select cj.id, cj.nombre, cj.activa, exists (select 1 from turnos t where t.caja_id = cj.id and t.estado = 'abierto') turno_abierto
      from cajas cj where cj.empresa_id = $1 order by cj.activa desc, cj.nombre`, [s.empresa])).rows;
    const pagos = (await c.query(`select referencia, plan, periodo, monto, proveedor, estado, factura, to_char(creado at time zone 'America/Bogota', 'DD/MM/YYYY') fecha,
        to_char(vence, 'DD/MM/YYYY') hasta from pagos_suscripcion where empresa_id = $1 and estado in ('aprobado', 'anulado') order by creado desc limit 24`, [s.empresa])).rows;
    return { e, miembros, plan, mes, res, stripe, cajas, pagos, cargos };
  }) as any;
  const cupoDocs = CUPO_DOCS[d.e.plan] ?? null;
  const nombrePlan: Record<string, string> = { esencial: "Esencial", pro: "Pro", cadena: "Cadena", socio: "Socio" };
  const TIPO: Record<string, string> = { ...NOMBRE_NUMERACION, pos: "Tiquete POS" };
  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5 max-w-5xl">
      <Cabecera titulo="Mi droguería" sub={`${d.e.razon_social} · NIT ${d.e.nit}${d.e.dv ? `-${d.e.dv}` : ""}`} />
      <section className="grid md:grid-cols-3 gap-3" aria-label="Plan y facturación">
        <div className="tarjeta p-5">
          <h2 className="text-sm text-muted">Plan</h2>
          <p className="titulo text-2xl mt-1">{nombrePlan[d.e.plan] ?? d.e.plan}</p>
          <p className={`text-sm mt-1 ${d.plan?.vencido ? "text-alerta font-semibold" : "text-muted"}`}>
            {d.e.demo ? "Demostración" : d.plan?.vence ? `${d.plan.vencido ? "Venció" : "Pagado hasta"} el ${d.plan.vence}` : "Pago gestionado por soporte"}
          </p>
          {!d.e.demo && d.e.plan_siguiente && <p className="text-sm mt-1 text-aviso font-semibold">Pasas a {nombrePlan[d.e.plan_siguiente]} al terminar lo pagado de {nombrePlan[d.e.plan]}.</p>}
          {!d.e.demo && d.stripe && <Renovacion cancelada={d.stripe.al_final} />}
          {!d.e.demo && <a href={`/contratar?plan=${d.e.plan === "pro" ? "pro" : "esencial"}`} className="btn-primario mt-3 inline-flex">Renovar o cambiar de plan</a>}
        </div>
        <div className="tarjeta p-5">
          <h2 className="text-sm text-muted">Documentos electrónicos este mes</h2>
          <p className="titulo text-2xl mt-1 num">{d.mes.toLocaleString("es-CO")}{cupoDocs ? <span className="text-base text-muted"> de {cupoDocs.toLocaleString("es-CO")}</span> : null}</p>
          {cupoDocs && !d.e.demo && <p className="text-xs text-muted mt-1">Por encima del cupo, cada documento cuesta ${DOC_EXTRA}.</p>}
          {cupoDocs && <div className="mt-2 h-2 rounded bg-line overflow-hidden" aria-hidden="true"><div className={`h-full ${d.mes / cupoDocs > 0.9 ? "bg-alerta" : "bg-cruz"}`} style={{ width: `${Math.min(100, (d.mes / cupoDocs) * 100)}%` }} /></div>}
        </div>
        <div className="tarjeta p-5">
          <h2 className="text-sm text-muted">Habilitación DIAN</h2>
          {d.res.length === 0 || d.res.some((r: any) => r.tipo === "pos" && r.pruebas) ? (
            <p className="mt-1 text-sm"><b className="text-aviso">En proceso.</b> La caja vende cuando quede cargada tu resolución. Te avisamos por correo.</p>
          ) : (
            <ul className="mt-1 text-sm grid gap-1">
              {d.res.map((r: any) => { const usados = Math.max(0, Number(r.actual) - Number(r.desde) + 1), total = Number(r.hasta) - Number(r.desde) + 1;
                return <li key={r.tipo}><b>{TIPO[r.tipo] ?? r.tipo}</b> {r.prefijo} · usados {usados.toLocaleString("es-CO")} de {total.toLocaleString("es-CO")}{r.vence ? ` · vence ${r.vence}` : ""}</li>; })}
            </ul>
          )}
        </div>
      </section>
      <Configuracion inicial={{ nombre_comercial: d.e.nombre_comercial ?? d.e.razon_social, direccion: d.e.direccion ?? "", ciudad: d.e.ciudad ?? "", telefono: d.e.telefono ?? "",
        email: d.e.email ?? "", descuento_max_cajero: d.e.descuento_max_cajero, egreso_max_cajero: d.e.egreso_max_cajero }} demo={d.e.demo} />
      <Equipo miembros={d.miembros} demo={d.e.demo} tope={limite(d.e.plan).usuarios} plan={d.e.plan} />
      <Cajas cajas={d.cajas} tope={limite(d.e.plan).cajas} plan={d.e.plan} demo={d.e.demo} />
      {d.cargos.length > 0 && (
        <section className="tarjeta p-5 grid gap-2" aria-labelledby="cargos-t">
          <h2 id="cargos-t" className="titulo text-xl">Documentos adicionales</h2>
          <ul className="divide-y divide-line">{d.cargos.map((g: any) => (
            <li key={g.referencia} className="py-2 flex flex-wrap justify-between gap-2"><span>{g.mes} · {Number(g.extra).toLocaleString("es-CO")} documentos sobre el cupo · <span className="font-mono text-sm">{g.referencia}</span></span>
              <span className="num font-semibold">${Number(g.monto).toLocaleString("es-CO")} · {g.estado === "pendiente" ? <span className="text-alerta">por pagar</span> : g.estado}</span></li>))}</ul>
          {d.cargos.some((g: any) => g.estado === "pendiente") && <p className="text-sm text-muted">Págalo por QR o transferencia a la llave Bre-B <b>{datosQr().llave}</b> con la referencia y envíanos el comprobante por WhatsApp. Si pasas el cupo cada mes, el plan Pro te sale mejor.</p>}
        </section>
      )}
      {!d.e.demo && (
        <section className="tarjeta p-5 grid gap-3" aria-labelledby="pagos-t">
          <h2 id="pagos-t" className="titulo text-xl">Pagos de tu plan</h2>
          {d.pagos.length ? (
            <div className="overflow-x-auto"><table className="w-full text-[15px] min-w-[560px]">
              <thead className="text-left text-sm text-muted border-b border-line"><tr><th className="py-2 pr-3 font-semibold">Fecha</th><th className="py-2 pr-3 font-semibold">Plan</th><th className="py-2 pr-3 font-semibold text-right">Valor</th><th className="py-2 pr-3 font-semibold">Hasta</th><th className="py-2 font-semibold">Comprobante</th></tr></thead>
              <tbody className="divide-y divide-line">{d.pagos.map((p: any) => (
                <tr key={p.referencia}><td className="py-2 pr-3">{p.fecha}</td><td className="py-2 pr-3">{nombrePlan[p.plan] ?? p.plan} {p.periodo === "anio" ? "anual" : "mensual"}{p.estado === "anulado" ? <span className="text-alerta"> · anulado</span> : null}</td>
                  <td className="py-2 pr-3 num text-right">${Number(p.monto).toLocaleString("es-CO")}</td><td className="py-2 pr-3">{p.hasta ?? "—"}</td>
                  <td className="py-2"><a href={`/recibo/${encodeURIComponent(p.referencia)}`} className="text-cruz underline font-semibold">Ver{p.factura ? ` · Factura ${p.factura}` : ""}</a></td></tr>
              ))}</tbody>
            </table></div>
          ) : <p className="text-muted">Aún no hay pagos registrados. Si tu plan lo gestiona soporte, pídenos el comprobante por WhatsApp.</p>}
        </section>
      )}
      {!d.e.demo && <SubirLogo endpoint="/api/empresa/logo" inicial={d.e.logo ?? null} />}
      <section className="tarjeta p-5 flex flex-wrap items-center justify-between gap-3" aria-labelledby="copia-t">
        <div><h2 id="copia-t" className="titulo text-xl">Copia de tus datos</h2>
          <p className="text-sm text-muted">Productos, inventario por lote, clientes, ventas con su detalle, cartera, documentos DIAN y turnos, en archivos que abren en Excel. Tus datos son tuyos.</p></div>
        <a href="/api/exportar" className="btn-borde">Descargar copia (ZIP)</a>
      </section>
    </main>
  );
}
