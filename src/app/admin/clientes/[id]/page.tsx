import Link from "next/link";
import { notFound } from "next/navigation";
import { sinRLS } from "@/lib/db";
import { Cabecera, Dato, pesos } from "@/components/ui/Cabecera";
import { Accion } from "@/components/admin/Accion";
import { exigirAdmin, fechaHora, NOMBRE_PLAN } from "@/lib/admin-pagina";
import { ROLES } from "@/lib/admin-datos";
import { Usuarios } from "./Usuarios";
import { Nota } from "./Nota";
import { Habilitacion } from "./Habilitacion";
import { Migracion } from "./Migracion";
import { Facturacion } from "./Facturacion";
import { NOMBRE_NUMERACION } from "@/lib/dian/tipos";
import { Eliminar } from "./Eliminar";
import { Fiscal } from "./Fiscal";
import { PagoManual } from "./PagoManual";

export const metadata = { title: "Cliente" };
export const dynamic = "force-dynamic";

export default async function Cliente({ params }: { params: Promise<{ id: string }> }) {
  await exigirAdmin();
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const d = await sinRLS(async (c) => {
    const e = (await c.query(`select * from empresas where id = $1`, [id])).rows[0];
    if (!e) return null;
    const usuarios = (await c.query(`select m.user_id, m.nombre, m.rol, m.activo, cu.email, cu.ultimo_ingreso, cu.clave_hash is not null activada
      from miembros m left join cuentas cu on cu.id = m.user_id where m.empresa_id = $1 order by m.activo desc, m.creado`, [id])).rows;
    const cifras = (await c.query(`select
        (select coalesce(sum(total), 0) from ventas where empresa_id = $1 and estado = 'cerrada' and creado > now() - interval '30 days')::float ventas30,
        (select count(*) from ventas where empresa_id = $1 and estado = 'cerrada' and creado > now() - interval '30 days')::int n30,
        (select count(*) from productos where empresa_id = $1 and activo)::int productos,
        (select count(*) from documentos_dian where empresa_id = $1 and estado = 'rechazado')::int rechazados`, [id])).rows[0];
    const resoluciones = (await c.query(`select tipo, prefijo, desde, hasta, actual, vigente_hasta::text, pruebas, activa, coalesce(numero_resolucion, '') numero_resolucion from resoluciones_dian where empresa_id = $1 order by tipo`, [id])).rows;
    const pagos = (await c.query(`select referencia, plan, periodo, monto, estado, creado from pagos_suscripcion where empresa_id = $1 order by creado desc limit 20`, [id])).rows;
    const eventos = (await c.query(`select ev.accion, ev.creado, cu.nombre from admin_eventos ev left join cuentas cu on cu.id = ev.cuenta_id where ev.empresa_id = $1 order by ev.creado desc limit 20`, [id])).rows;
    return { e, usuarios, cifras, resoluciones, pagos, eventos };
  });
  if (!d) notFound();
  const { e } = d;
  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Link href="/admin/clientes" className="text-sm font-semibold text-cruz">← Clientes</Link>
      <Cabecera titulo={e.nombre_comercial ?? e.razon_social} sub={`${e.razon_social} · NIT ${e.nit}-${e.dv}${e.ciudad ? ` · ${e.ciudad}` : ""}${e.telefono ? ` · ${e.telefono}` : ""}`}>
        <Accion url={`/api/admin/clientes/${id}/entrar`} texto="Entrar como el dueño" clase="btn-oscuro" />
        <a href={`/api/admin/clientes/${id}/exportar`} className="btn-borde h-10 text-sm inline-flex items-center">Descargar sus datos</a>
        {!e.demo && (e.estado === "activa"
          ? <Accion url={`/api/admin/clientes/${id}`} metodo="PATCH" cuerpo={{ estado: "suspendida" }} texto="Suspender" confirmar="¿Suspender? Sí" clase="btn-peligro" />
          : <Accion url={`/api/admin/clientes/${id}`} metodo="PATCH" cuerpo={{ estado: "activa" }} texto="Activar" clase="btn-primario" />)}
        {/* Solo una droguería de prueba (suspendida y que nunca facturó en producción) se puede borrar; las reales se conservan. */}
        {!e.demo && e.estado === "suspendida" && d.resoluciones.every((r) => r.pruebas) && <Eliminar id={id} nit={String(e.nit)} dv={String(e.dv ?? "")} nombre={e.nombre_comercial ?? e.razon_social} />}
      </Cabecera>
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Dato titulo="Estado" valor={e.estado === "activa" ? "Activo" : "Suspendido"} tono={e.estado === "activa" ? "cruz" : "alerta"} nota={`cliente desde ${new Date(e.creado).toLocaleDateString("es-CO")}`} />
        <Dato titulo="Ventas 30 días" valor={pesos(d.cifras.ventas30)} nota={`${d.cifras.n30} ventas`} />
        <Dato titulo="Productos" valor={d.cifras.productos} />
        <Dato titulo="Documentos rechazados" valor={d.cifras.rechazados} tono={d.cifras.rechazados ? "alerta" : undefined} />
      </section>
      {!e.demo && (
        <section className="tarjeta p-5 flex flex-wrap items-center gap-2" aria-label="Plan">
          <p className="font-semibold mr-2">Plan: {NOMBRE_PLAN[e.plan]}</p>
          {Object.entries(NOMBRE_PLAN).filter(([k]) => k !== e.plan).map(([k, t]) => <Accion key={k} url={`/api/admin/clientes/${id}`} metodo="PATCH" cuerpo={{ plan: k }} texto={`Cambiar a ${t}`} clase="btn-borde h-10 text-sm" />)}
        </section>
      )}
      <Usuarios empresa={id} usuarios={d.usuarios.map((u) => ({ ...u, rol_nombre: ROLES[u.rol as keyof typeof ROLES] ?? u.rol, ultimo: fechaHora(u.ultimo_ingreso) }))} />
      <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-2 gap-5">
        <section className="tarjeta p-5">
          <h2 className="titulo text-xl">Numeraciones DIAN</h2>
          {d.resoluciones.length ? <ul className="mt-3 grid gap-2 text-sm">{d.resoluciones.map((r) => (
            <li key={r.tipo + r.prefijo} className="flex flex-wrap justify-between gap-2"><span className="font-semibold">{NOMBRE_NUMERACION[r.tipo as keyof typeof NOMBRE_NUMERACION] ?? r.tipo} {r.prefijo}</span>
              <span className="num text-muted">{r.desde}–{r.hasta} · usado hasta {r.actual} · {r.vigente_hasta ? `vence ${r.vigente_hasta}` : "sin fecha"}{r.pruebas ? " · pruebas" : ""}{r.activa ? "" : " · inactiva"}</span></li>
          ))}</ul> : <p className="mt-2 text-muted">Sin numeraciones. Sin ellas el cliente no puede facturar.</p>}
        </section>
        <Nota empresa={id} inicial={e.nota_admin ?? ""} />
      </div>
      {!e.demo && <Fiscal empresa={id} nitFijo={d.resoluciones.some((r) => !r.pruebas)} inicial={{ razon_social: e.razon_social ?? "", nombre_comercial: e.nombre_comercial ?? "", nit: String(e.nit ?? ""),
        responsable_iva: !!e.responsable_iva, direccion: e.direccion ?? "", ciudad: e.ciudad ?? "", telefono: e.telefono ?? "", email: e.email ?? "" }} />}
      {!e.demo && <Habilitacion empresa={id} />}
      {!e.demo && <Migracion empresa={id} />}
      {!e.demo && <Facturacion empresa={id} cliente={e.matias_cliente ?? ""} emisor={process.env.REGENTA_DIAN ?? "simulado"} complementario={!!e.dian_complementario}
        resoluciones={d.resoluciones.map((r) => ({ tipo: r.tipo, prefijo: r.prefijo, numero: r.numero_resolucion, pruebas: r.pruebas }))} />}
      <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-2 gap-5">
        <section className="tarjeta p-5">
          <h2 className="titulo text-xl">Pagos</h2>
          {d.pagos.length ? <ul className="mt-3 divide-y divide-line text-sm">{d.pagos.map((p) => <li key={p.referencia} className="py-2 flex justify-between gap-2"><span>{fechaHora(p.creado)} · {NOMBRE_PLAN[p.plan]} {p.periodo === "anio" ? "anual" : "mensual"}</span><span className="num font-semibold">{pesos(p.monto)} · {p.estado}</span></li>)}</ul> : <p className="mt-2 text-muted">Sin pagos vinculados.</p>}
          {!e.demo && <div className="mt-3"><PagoManual empresa={id} plan={e.plan} /></div>}
        </section>
        <section className="tarjeta p-5">
          <h2 className="titulo text-xl">Lo que se hizo desde la consola</h2>
          {d.eventos.length ? <ul className="mt-3 divide-y divide-line text-sm">{d.eventos.map((v, i) => <li key={i} className="py-2 flex justify-between gap-2"><span>{v.accion.replaceAll("_", " ")}</span><span className="text-muted">{v.nombre} · {fechaHora(v.creado)}</span></li>)}</ul> : <p className="mt-2 text-muted">Nada todavía.</p>}
        </section>
      </div>
    </main>
  );
}
