import { redirect } from "next/navigation";
import { sinRLS } from "@/lib/db";
import { leerSesion } from "@/lib/sesion";
import { Cabecera } from "@/components/ui/Cabecera";
import { Equipo, Configuracion } from "./Equipo";
import { suscripcionStripe } from "@/lib/pagos";
import { Renovacion } from "./Renovacion";

export const metadata = { title: "Mi droguería" };

/** Datos de la droguería, equipo y plan: solo el dueño. */
export default async function PaginaEquipo() {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (s.rol !== "dueno") redirect("/inicio");
  // Lee cuentas (correo y si ya creó contraseña): sin RLS, siempre filtrado por la empresa de la sesión del dueño.
  const d = await sinRLS(async (c) => {
    const e = (await c.query(`select nit, dv, razon_social, nombre_comercial, direccion, ciudad, telefono, email, plan, estado, demo,
        descuento_max_cajero::float, egreso_max_cajero::float, responsable_iva from empresas where id = $1`, [s.empresa])).rows[0];
    const miembros = (await c.query(`select m.user_id, m.nombre, m.rol, m.activo, cu.email, cu.clave_hash is not null activo_cuenta
      from miembros m join cuentas cu on cu.id = m.user_id where m.empresa_id = $1 order by m.rol = 'dueno' desc, m.activo desc, m.nombre`, [s.empresa])).rows;
    const plan = (await c.query(`select to_char(max(vence), 'DD/MM/YYYY') vence, max(vence) < current_date vencido from pagos_suscripcion where empresa_id = $1 and estado = 'aprobado'`, [s.empresa])).rows[0];
    const mes = (await c.query(`select count(*)::int n from documentos_dian where empresa_id = $1 and creado >= date_trunc('month', now() at time zone 'America/Bogota') at time zone 'America/Bogota'`, [s.empresa])).rows[0].n;
    const res = (await c.query(`select tipo, prefijo, desde, hasta, actual, pruebas, to_char(vigente_hasta, 'DD/MM/YYYY') vence from resoluciones_dian where empresa_id = $1 and activa order by tipo`, [s.empresa])).rows;
    const stripe = await suscripcionStripe(c, s.empresa);
    return { e, miembros, plan, mes, res, stripe };
  }) as any;
  const cupoDocs = d.e.plan === "esencial" ? 2000 : d.e.plan === "pro" ? 5000 : null;
  const nombrePlan: Record<string, string> = { esencial: "Esencial", pro: "Pro", cadena: "Cadena", socio: "Socio" };
  const TIPO: Record<string, string> = { pos: "Tiquete POS", factura: "Factura electrónica", nota_credito: "Nota crédito" };
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
          {!d.e.demo && d.stripe && <Renovacion cancelada={d.stripe.al_final} />}
          {!d.e.demo && <a href={`/contratar?plan=${d.e.plan === "pro" ? "pro" : "esencial"}`} className="btn-primario mt-3 inline-flex">Renovar o cambiar de plan</a>}
        </div>
        <div className="tarjeta p-5">
          <h2 className="text-sm text-muted">Documentos electrónicos este mes</h2>
          <p className="titulo text-2xl mt-1 num">{d.mes.toLocaleString("es-CO")}{cupoDocs ? <span className="text-base text-muted"> de {cupoDocs.toLocaleString("es-CO")}</span> : null}</p>
          {cupoDocs && <div className="mt-2 h-2 rounded bg-line overflow-hidden" aria-hidden="true"><div className={`h-full ${d.mes / cupoDocs > 0.9 ? "bg-alerta" : "bg-cruz"}`} style={{ width: `${Math.min(100, (d.mes / cupoDocs) * 100)}%` }} /></div>}
        </div>
        <div className="tarjeta p-5">
          <h2 className="text-sm text-muted">Habilitación DIAN</h2>
          {d.res.length === 0 || d.res.some((r: any) => r.tipo === "pos" && r.pruebas) ? (
            <p className="mt-1 text-sm"><b className="text-aviso">En proceso.</b> La caja vende cuando quede cargada tu resolución. Te avisamos por correo.</p>
          ) : (
            <ul className="mt-1 text-sm grid gap-1">
              {d.res.map((r: any) => <li key={r.tipo}><b>{TIPO[r.tipo] ?? r.tipo}</b> {r.prefijo} · van {Number(r.actual).toLocaleString("es-CO")} de {Number(r.hasta).toLocaleString("es-CO")}{r.vence ? ` · vence ${r.vence}` : ""}</li>)}
            </ul>
          )}
        </div>
      </section>
      <Configuracion inicial={{ nombre_comercial: d.e.nombre_comercial ?? d.e.razon_social, direccion: d.e.direccion ?? "", ciudad: d.e.ciudad ?? "", telefono: d.e.telefono ?? "",
        email: d.e.email ?? "", descuento_max_cajero: d.e.descuento_max_cajero, egreso_max_cajero: d.e.egreso_max_cajero }} demo={d.e.demo} />
      <Equipo miembros={d.miembros} demo={d.e.demo} tope={d.e.plan === "esencial" ? 3 : null} />
    </main>
  );
}
