import Link from "next/link";
import { sinRLS, sinComodines } from "@/lib/db";
import { Cabecera, pesos } from "@/components/ui/Cabecera";
import { Accion } from "@/components/admin/Accion";
import { exigirAdmin, fechaHora, NOMBRE_PLAN } from "@/lib/admin-pagina";

export const metadata = { title: "Clientes" };
export const dynamic = "force-dynamic";

export default async function Clientes({ searchParams }: { searchParams: Promise<{ q?: string; estado?: string }> }) {
  await exigirAdmin();
  const { q = "", estado = "" } = await searchParams;
  const filas = await sinRLS(async (c) => (await c.query(`
    select e.id, coalesce(e.nombre_comercial, e.razon_social) nombre, e.razon_social, e.nit, e.dv, e.plan, e.estado, e.demo, e.ciudad, e.creado,
           (select count(*) from miembros m where m.empresa_id = e.id and m.activo)::int usuarios,
           (select max(cu.ultimo_ingreso) from miembros m join cuentas cu on cu.id = m.user_id where m.empresa_id = e.id) ultimo,
           (select coalesce(sum(total), 0) from ventas v where v.empresa_id = e.id and v.origen is null and v.estado = 'cerrada' and v.creado > now() - interval '30 days')::float ventas30
    from empresas e
    where ($1 = '' or lower(e.razon_social || ' ' || coalesce(e.nombre_comercial, '') || ' ' || e.nit) like '%' || $1 || '%')
      and ($2 = '' or e.estado = $2)
    order by e.demo, e.creado desc limit 500`, [sinComodines(q.trim().toLowerCase()), ["activa", "suspendida"].includes(estado) ? estado : ""])).rows);
  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo="Clientes" sub={`${filas.length} droguería${filas.length === 1 ? "" : "s"} y distribuidora${filas.length === 1 ? "" : "s"}`}>
        <Link href="/admin/clientes/nuevo" className="btn-primario">Nuevo cliente</Link>
      </Cabecera>
      <form className="flex flex-wrap gap-2" role="search">
        <label htmlFor="q" className="sr-only">Buscar cliente</label>
        <input id="q" name="q" defaultValue={q} placeholder="Nombre o NIT" className="campo flex-1 min-w-56" />
        <select name="estado" defaultValue={estado} aria-label="Estado" className="campo w-auto"><option value="">Todos</option><option value="activa">Activos</option><option value="suspendida">Suspendidos</option></select>
        <button className="btn-oscuro">Buscar</button>
      </form>
      <div className="tarjeta overflow-x-auto">
        <table className="w-full text-[15px] min-w-[980px]">
          <thead className="text-left text-sm text-muted border-b border-line"><tr>
            <th className="px-4 py-3 font-semibold">Cliente</th><th className="px-4 py-3 font-semibold">Plan</th><th className="px-4 py-3 font-semibold">Estado</th>
            <th className="px-4 py-3 font-semibold text-right">Ventas 30 días</th><th className="px-4 py-3 font-semibold">Usuarios · último ingreso</th><th className="px-4 py-3 font-semibold">Acciones</th></tr></thead>
          <tbody className="divide-y divide-line">
            {filas.map((e) => (
              <tr key={e.id} className="align-top">
                <td className="px-4 py-3"><Link href={`/admin/clientes/${e.id}`} className="font-semibold hover:underline">{e.nombre}</Link>{e.demo && <span className="ml-2 pastilla min-h-6 py-0 text-[12px] bg-aviso-soft text-aviso">Demo</span>}
                  <p className="text-sm text-muted num">NIT {e.nit}-{e.dv}{e.ciudad ? ` · ${e.ciudad}` : ""} · desde {new Date(e.creado).toLocaleDateString("es-CO")}</p></td>
                <td className="px-4 py-3">{NOMBRE_PLAN[e.plan] ?? e.plan}</td>
                <td className="px-4 py-3"><span className={`font-semibold ${e.estado === "activa" ? "text-cruz" : "text-alerta"}`}>{e.estado === "activa" ? "Activo" : "Suspendido"}</span></td>
                <td className="px-4 py-3 num text-right">{pesos(e.ventas30)}</td>
                <td className="px-4 py-3 text-sm">{e.usuarios} · {fechaHora(e.ultimo)}</td>
                <td className="px-4 py-3"><div className="flex flex-wrap gap-2">
                  <Accion url={`/api/admin/clientes/${e.id}/entrar`} texto="Entrar como" clase="btn-oscuro h-9 text-sm" />
                  {!e.demo && (e.estado === "activa"
                    ? <Accion url={`/api/admin/clientes/${e.id}`} metodo="PATCH" cuerpo={{ estado: "suspendida" }} texto="Suspender" confirmar="¿Suspender? Sí" clase="btn-peligro h-9 text-sm" />
                    : <Accion url={`/api/admin/clientes/${e.id}`} metodo="PATCH" cuerpo={{ estado: "activa" }} texto="Activar" clase="btn-primario h-9 text-sm" />)}
                  <Link href={`/admin/clientes/${e.id}`} className="btn-borde h-9 text-sm">Ver</Link>
                </div></td>
              </tr>
            ))}
            {filas.length === 0 && <tr><td colSpan={6} className="px-4 py-12 text-center text-muted">No hay clientes con ese filtro.</td></tr>}
          </tbody>
        </table>
      </div>
    </main>
  );
}
