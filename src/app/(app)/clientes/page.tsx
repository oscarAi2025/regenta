import Link from "next/link";
import { redirect } from "next/navigation";
import { comoUsuario, sinComodines } from "@/lib/db";
import { leerSesion, puede } from "@/lib/sesion";
import { Cabecera } from "@/components/ui/Cabecera";
import { pesos } from "@/lib/formato";
import { EditarCliente } from "./EditarCliente";

export const metadata = { title: "Clientes" };

/** Clientes de la droguería: buscar, ver compras y saldo, corregir datos (dueño y administrador). */
export default async function Clientes({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puede.verCostos(s.rol)) redirect("/inicio?aviso=permiso");
  const { q = "" } = await searchParams;
  const t = q.replace(/\0/g, "").trim().slice(0, 80);
  const filas = await comoUsuario(s, async (c) => (await c.query(`
    select cl.id, cl.tipo_doc, cl.numero_doc, cl.dv, cl.nombre, cl.email, cl.telefono, cl.autoriza_datos,
           count(v.id) filter (where v.estado = 'cerrada')::int compras, coalesce(sum(v.total - v.devuelto) filter (where v.estado = 'cerrada'), 0)::float total,
           to_char(max(v.creado) at time zone 'America/Bogota', 'DD/MM/YYYY') ultima, cl.cupo_credito::float cupo, cl.credito_bloqueado bloqueado,
           (select coalesce(sum(vc.saldo), 0) from v_cartera vc where vc.cliente_id = cl.id and vc.empresa_id = cl.empresa_id)::float saldo
    from clientes cl left join ventas v on v.cliente_id = cl.id
    where cl.empresa_id = $1 and ($2 = '' or cl.numero_doc like $3 || '%' or lower(cl.nombre) like '%' || $4 || '%')
    group by cl.id order by max(v.creado) desc nulls last, cl.nombre limit 200`, [s.empresa, t, sinComodines(t.replace(/[.\s-]/g, "")), sinComodines(t.toLowerCase())])).rows);
  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo="Clientes" sub="Las personas y empresas a las que les facturas. Abre un cliente para ver su cuenta, darle cupo de crédito o recibir un pago." />
      <form className="flex gap-2 max-w-xl" role="search">
        <label htmlFor="q" className="sr-only">Buscar cliente</label>
        <input id="q" name="q" defaultValue={t} placeholder="Nombre o documento" className="campo" />
        <button className="btn-oscuro">Buscar</button>
      </form>
      <div className="tarjeta overflow-x-auto relative">
        <table className="w-full text-[15px] min-w-[860px]">
          <thead className="text-left text-sm text-muted border-b border-line"><tr><th className="px-4 py-3 font-semibold">Cliente</th><th className="px-4 py-3 font-semibold">Contacto</th><th className="px-4 py-3 font-semibold text-right">Compras</th><th className="px-4 py-3 font-semibold">Última</th><th className="px-4 py-3 font-semibold text-right">Debe</th><th className="px-4 py-3 font-semibold"><span className="sr-only">Acciones</span></th></tr></thead>
          <tbody className="divide-y divide-line">
            {filas.map((f) => (
              <tr key={f.id} className="align-top">
                <td className="px-4 py-3"><Link href={`/clientes/${f.id}`} className="font-semibold hover:underline">{f.nombre}</Link><p className="text-sm text-muted">{f.tipo_doc} {f.numero_doc}{f.dv ? `-${f.dv}` : ""}</p></td>
                <td className="px-4 py-3 text-sm">{f.email ?? <span className="text-muted">sin correo</span>}<br />{f.telefono ?? ""}</td>
                <td className="px-4 py-3 text-right num">{f.compras}<p className="text-sm text-muted">{pesos(f.total)}</p></td>
                <td className="px-4 py-3 text-sm">{f.ultima ?? "—"}</td>
                <td className="px-4 py-3 text-right num">{f.saldo ? <span className="font-semibold">{pesos(f.saldo)}</span> : <span className="text-muted">—</span>}
                  <p className="text-sm text-muted">{f.bloqueado ? "crédito bloqueado" : f.cupo === null ? "sin cupo" : `cupo ${pesos(f.cupo)}`}</p></td>
                <td className="px-4 py-3"><EditarCliente c={{ id: f.id, tipo_doc: f.tipo_doc, numero_doc: f.numero_doc, nombre: f.nombre, email: f.email ?? "", telefono: f.telefono ?? "", autoriza_datos: !!f.autoriza_datos }} /></td>
              </tr>
            ))}
            {filas.length === 0 && <tr><td colSpan={6} className="px-4 py-12 text-center text-muted">{t ? "No hay clientes con esa búsqueda." : "Aún no hay clientes: se crean al facturar con documento desde la caja."}</td></tr>}
          </tbody>
        </table>
      </div>
    </main>
  );
}
