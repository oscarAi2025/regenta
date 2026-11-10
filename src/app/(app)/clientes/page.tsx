import Link from "next/link";
import { redirect } from "next/navigation";
import { comoUsuario, sinComodines } from "@/lib/db";
import { leerSesion, puede } from "@/lib/sesion";
import { Cabecera } from "@/components/ui/Cabecera";
import { pesos } from "@/lib/formato";
import { EditarCliente } from "./EditarCliente";

export const metadata = { title: "Clientes" };

/** Clientes de la droguería: buscar, ver compras y saldo, corregir datos (dueño y administrador). */
const POR_PAGINA = 100;

export default async function Clientes({ searchParams }: { searchParams: Promise<{ q?: string; pagina?: string }> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puede.verCostos(s.rol)) redirect("/inicio?aviso=permiso");
  const sp = await searchParams;
  const q = sp.q ?? "";
  const t = q.replace(/\0/g, "").trim().slice(0, 80);
  const pagina = Math.min(Math.max(Number.parseInt(sp.pagina ?? "1", 10) || 1, 1), 1000);
  // Compras en Regenta y, aparte, las traídas de Alegra (historial): así ningún cliente migrado aparece «sin compras».
  const { filas, total, alegra } = await comoUsuario(s, async (c) => {
    const filas = (await c.query(`
    select cl.id, cl.tipo_doc, cl.numero_doc, cl.dv, cl.nombre, cl.email, cl.telefono, cl.autoriza_datos, cl.direccion, cl.ciudad, count(*) over ()::int total,
           coalesce(rg.compras, 0)::int compras, coalesce(rg.total, 0)::float total_regenta, coalesce(al.compras, 0)::int compras_alegra, coalesce(al.total, 0)::float total_alegra,
           to_char(greatest(rg.ultima, al.ultima), 'DD/MM/YYYY') ultima, cl.cupo_credito::float cupo, cl.credito_bloqueado bloqueado,
           (select coalesce(sum(vc.saldo), 0) from v_cartera vc where vc.cliente_id = cl.id and vc.empresa_id = cl.empresa_id)::float saldo
    from clientes cl
    left join lateral (select count(*) compras, sum(v.total - v.devuelto) total, max((v.creado at time zone 'America/Bogota')::date) ultima
      from ventas v where v.cliente_id = cl.id and v.estado = 'cerrada' and v.origen is null) rg on true
    left join lateral (select count(*) compras, sum(x.total) total, max(x.fecha) ultima
      from ventas_externas x where x.cliente_id = cl.id and x.estado <> 'anulada') al on true
    where cl.empresa_id = $1 and ($2 = '' or cl.numero_doc like $3 || '%' or sin_tildes(cl.nombre) like '%' || sin_tildes($4) || '%')
    order by greatest(rg.ultima, al.ultima) desc nulls last, cl.nombre limit ${POR_PAGINA} offset $5`,
      [s.empresa, t, sinComodines(t.replace(/[.\s-]/g, "")), sinComodines(t.toLowerCase()), (pagina - 1) * POR_PAGINA])).rows;
    const alegra = (await c.query(`select exists (select 1 from ventas_externas where empresa_id = $1) h`, [s.empresa])).rows[0].h as boolean;
    return { filas, total: (filas[0]?.total ?? 0) as number, alegra };
  });
  const paginas = Math.max(1, Math.ceil(total / POR_PAGINA));
  const enlace = (n: number) => `/clientes?${new URLSearchParams({ ...(t ? { q: t } : {}), ...(n > 1 ? { pagina: String(n) } : {}) })}`;
  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo="Clientes" sub="Las personas y empresas a las que les facturas. Abre un cliente para ver su cuenta, darle cupo de crédito o recibir un pago." />
      <form className="flex gap-2 max-w-xl" role="search">
        <label htmlFor="q" className="sr-only">Buscar cliente</label>
        <input id="q" name="q" defaultValue={t} placeholder="Nombre o documento" className="campo" />
        <button className="btn-oscuro">Buscar</button>
      </form>
      {total > 0 && <p className="text-sm text-muted num -mt-2">{total <= POR_PAGINA ? `${total.toLocaleString("es-CO")} ${total === 1 ? "cliente" : "clientes"}` : `Clientes ${((pagina - 1) * POR_PAGINA + 1).toLocaleString("es-CO")} a ${Math.min(pagina * POR_PAGINA, total).toLocaleString("es-CO")} de ${total.toLocaleString("es-CO")}`}{alegra ? " · las compras incluyen las hechas en Alegra" : ""}</p>}
      <div className="tarjeta overflow-x-auto relative">
        <table className="w-full text-[15px] min-w-[860px]">
          <thead className="text-left text-sm text-muted border-b border-line"><tr><th className="px-4 py-3 font-semibold">Cliente</th><th className="px-4 py-3 font-semibold">Contacto</th><th className="px-4 py-3 font-semibold text-right">Compras</th><th className="px-4 py-3 font-semibold">Última</th><th className="px-4 py-3 font-semibold text-right">Debe</th><th className="px-4 py-3 font-semibold"><span className="sr-only">Acciones</span></th></tr></thead>
          <tbody className="divide-y divide-line">
            {filas.map((f) => (
              <tr key={f.id} className="align-top">
                <td className="px-4 py-3"><Link href={`/clientes/${f.id}`} className="font-semibold hover:underline">{f.nombre}</Link><p className="text-sm text-muted">{f.tipo_doc} {f.numero_doc}{f.dv ? `-${f.dv}` : ""}{f.ciudad ? ` · ${f.ciudad}` : ""}</p></td>
                <td className="px-4 py-3 text-sm">{f.email ?? <span className="text-muted">sin correo</span>}<br />{f.telefono ?? ""}</td>
                <td className="px-4 py-3 text-right num">{(f.compras + f.compras_alegra).toLocaleString("es-CO")}<p className="text-sm text-muted">{pesos(f.total_regenta + f.total_alegra)}</p>
                  {f.compras_alegra > 0 && <Link href={`/ventas/historial?cliente=${f.id}`} className="text-xs text-cruz font-semibold hover:underline">{f.compras_alegra} en Alegra</Link>}</td>
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
      {paginas > 1 && (
        <nav className="flex flex-wrap items-center gap-2" aria-label="Páginas de clientes">
          {pagina > 1 ? <a href={enlace(pagina - 1)} className="btn-borde h-10 text-sm" rel="prev">Anterior</a> : <span className="btn-borde h-10 text-sm opacity-40" aria-disabled="true">Anterior</span>}
          <span className="text-sm num px-2">Página {pagina} de {paginas}</span>
          {pagina < paginas ? <a href={enlace(pagina + 1)} className="btn-borde h-10 text-sm" rel="next">Siguiente</a> : <span className="btn-borde h-10 text-sm opacity-40" aria-disabled="true">Siguiente</span>}
        </nav>
      )}
    </main>
  );
}
