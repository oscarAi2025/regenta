import Link from "next/link";
import { sinRLS } from "@/lib/db";
import { Cabecera, Dato, pesos } from "@/components/ui/Cabecera";
import { Accion } from "@/components/admin/Accion";
import { exigirAdmin, fechaHora, NOMBRE_PLAN, PRECIO_PLAN } from "@/lib/admin-pagina";

export const metadata = { title: "Resumen" };
export const dynamic = "force-dynamic";

export default async function Resumen() {
  await exigirAdmin();
  const d = await sinRLS(async (c) => {
    const empresas = (await c.query(`select plan, estado, count(*)::int n from empresas where not demo group by 1, 2`)).rows as { plan: string; estado: string; n: number }[];
    const pagos = (await c.query(`select coalesce(sum(monto) filter (where estado = 'aprobado' and creado >= date_trunc('month', now())), 0)::float mes,
      count(*) filter (where (estado = 'aprobado' or detalle ? 'revisar') and not atendido)::int sin_atender, count(*) filter (where estado = 'pendiente' and creado > now() - interval '2 days')::int pendientes from pagos_suscripcion`)).rows[0];
    const solicitudes = (await c.query(`select count(*) filter (where estado = 'nueva')::int nuevas, count(*) filter (where creado > now() - interval '7 days')::int semana from solicitudes_demo`)).rows[0];
    const dian = (await c.query(`select count(*) filter (where d.estado in ('pendiente', 'enviando'))::int cola, count(*) filter (where d.estado = 'rechazado')::int rechazados from documentos_dian d join empresas e on e.id = d.empresa_id where not e.demo`)).rows[0];
    const ventas = (await c.query(`select count(*)::int n, coalesce(sum(total), 0)::float t from ventas v join empresas e on e.id = v.empresa_id where not e.demo and v.origen is null and v.estado = 'cerrada' and (v.creado at time zone 'America/Bogota')::date = (now() at time zone 'America/Bogota')::date`)).rows[0];
    const invima = (await c.query(`select max(creado) u, count(*)::int n from alertas_invima`)).rows[0];
    // Clientes que ya pagaron y siguen sin facturar en producción: cada día así es un cliente pagando sin usar lo que compró.
    const sinHabilitar = (await c.query(`select e.id, coalesce(e.nombre_comercial, e.razon_social) nombre, (current_date - min(p.creado)::date)::int dias
      from empresas e join pagos_suscripcion p on p.empresa_id = e.id and p.estado = 'aprobado'
      where not e.demo and e.estado = 'activa' and not exists (select 1 from resoluciones_dian r where r.empresa_id = e.id and r.activa and not r.pruebas and r.tipo in ('pos', 'factura'))
      group by e.id order by min(p.creado) limit 10`)).rows;
    const cargos = (await c.query(`select count(*)::int n, coalesce(sum(monto), 0)::float t from cargos_documentos where estado = 'pendiente'`)).rows[0];
    const recientes = (await c.query(`select id, coalesce(nombre_comercial, razon_social) nombre, plan, estado, creado from empresas where not demo order by creado desc limit 5`)).rows;
    const nuevas = (await c.query(`select id, nombre, drogueria, ciudad, telefono, creado from solicitudes_demo where estado = 'nueva' order by creado desc limit 5`)).rows;
    return { sinHabilitar, cargos, empresas, pagos, solicitudes, dian, ventas, invima, recientes, nuevas };
  });
  const activas = d.empresas.filter((e) => e.estado === "activa");
  const mrr = activas.reduce((a, e) => a + (PRECIO_PLAN[e.plan] ?? 0) * e.n, 0);
  const totalActivas = activas.reduce((a, e) => a + e.n, 0), suspendidas = d.empresas.filter((e) => e.estado !== "activa").reduce((a, e) => a + e.n, 0);
  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo="Resumen" sub="Todo Regenta de un vistazo. La droguería de demostración no cuenta en estas cifras.">
        <Link href="/admin/clientes/nuevo" className="btn-primario">Nuevo cliente</Link>
      </Cabecera>
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3" aria-label="Cifras">
        <Dato titulo="Clientes activos" valor={totalActivas} tono="cruz" nota={`${suspendidas} suspendido${suspendidas === 1 ? "" : "s"} · ${activas.map((e) => `${e.n} ${NOMBRE_PLAN[e.plan]}`).join(", ") || "sin clientes aún"}`} />
        <Dato titulo="Ingreso mensual estimado" valor={pesos(mrr)} nota="planes activos a precio de lista (sin Cadena ni Socio)" />
        <Dato titulo="Cobrado este mes" valor={pesos(d.pagos.mes)} tono={d.pagos.sin_atender ? "aviso" : undefined} nota={`${d.pagos.sin_atender} pago${d.pagos.sin_atender === 1 ? "" : "s"} aprobado${d.pagos.sin_atender === 1 ? "" : "s"} sin atender`} />
        <Dato titulo="Solicitudes de demo nuevas" valor={d.solicitudes.nuevas} tono={d.solicitudes.nuevas ? "alerta" : undefined} nota={`${d.solicitudes.semana} en los últimos 7 días`} />
        <Dato titulo="Vendido hoy por tus clientes" valor={pesos(d.ventas.t)} nota={`${d.ventas.n} ventas`} />
        <Dato titulo="Cola DIAN" valor={d.dian.cola} tono={d.dian.rechazados ? "alerta" : undefined} nota={`${d.dian.rechazados} rechazados para revisar`} />
        <Dato titulo="Alertas INVIMA" valor={d.invima.n} nota={`última cargada: ${fechaHora(d.invima.u)}`} />
        <Dato titulo="Pagos en proceso" valor={d.pagos.pendientes} nota="últimos 2 días" />
        <Dato titulo="Pagaron y sin habilitar DIAN" valor={d.sinHabilitar.length} tono={d.sinHabilitar.length ? "alerta" : undefined} nota={d.sinHabilitar.length ? d.sinHabilitar.slice(0, 3).map((x: any) => `${x.nombre} (${x.dias} d)`).join(", ") : "todos facturan en producción"} />
        <Dato titulo="Documentos extra por cobrar" valor={pesos(d.cargos.t)} tono={d.cargos.n ? "aviso" : undefined} nota={`${d.cargos.n} cargo${d.cargos.n === 1 ? "" : "s"} pendiente${d.cargos.n === 1 ? "" : "s"} · en Pagos`} />
      </section>
      <section className="tarjeta p-5 flex flex-wrap items-center gap-3" aria-label="Acciones rápidas">
        <p className="font-semibold mr-2">Acciones rápidas</p>
        <Link href="/admin/clientes/nuevo" className="btn-oscuro h-10 text-sm">Dar de alta un cliente</Link>
        <Accion url="/api/admin/sistema" cuerpo={{ accion: "dian" }} texto="Procesar cola DIAN" />
        <Accion url="/api/admin/sistema" cuerpo={{ accion: "invima" }} texto="Sincronizar alertas INVIMA" />
        <Link href="/admin/pagos" className="btn-borde h-10 text-sm">Ver pagos</Link>
        <Link href="/admin/solicitudes" className="btn-borde h-10 text-sm">Ver solicitudes</Link>
      </section>
      <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-2 gap-5">
        <section className="tarjeta p-5">
          <div className="flex justify-between items-baseline"><h2 className="titulo text-xl">Clientes recientes</h2><Link href="/admin/clientes" className="text-sm font-semibold text-cruz">Ver todos</Link></div>
          {d.recientes.length ? <ul className="mt-3 divide-y divide-line">{d.recientes.map((e) => (
            <li key={e.id}><Link href={`/admin/clientes/${e.id}`} className="flex justify-between gap-3 py-2.5 hover:bg-paper/60 rounded-lg px-1"><span className="font-semibold min-w-0 truncate">{e.nombre}</span><span className="text-sm text-muted shrink-0">{NOMBRE_PLAN[e.plan]} · {e.estado}</span></Link></li>
          ))}</ul> : <p className="mt-3 text-muted">Aún no hay clientes. <Link href="/admin/clientes/nuevo" className="underline">Da de alta el primero</Link>.</p>}
        </section>
        <section className="tarjeta p-5">
          <div className="flex justify-between items-baseline"><h2 className="titulo text-xl">Demos por contactar</h2><Link href="/admin/solicitudes" className="text-sm font-semibold text-cruz">Ver todas</Link></div>
          {d.nuevas.length ? <ul className="mt-3 divide-y divide-line">{d.nuevas.map((s) => (
            <li key={s.id} className="py-2.5 flex justify-between gap-3"><span className="min-w-0"><span className="font-semibold block truncate">{s.drogueria}</span><span className="text-sm text-muted">{s.nombre}{s.ciudad ? ` · ${s.ciudad}` : ""} · {fechaHora(s.creado)}</span></span>
              <a href={`https://wa.me/57${String(s.telefono).replace(/\D/g, "").slice(-10)}`} target="_blank" rel="noopener" className="btn-borde h-10 text-sm shrink-0">WhatsApp</a></li>
          ))}</ul> : <p className="mt-3 text-muted">No hay solicitudes nuevas.</p>}
        </section>
      </div>
    </main>
  );
}
