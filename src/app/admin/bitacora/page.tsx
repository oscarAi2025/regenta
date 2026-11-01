import Link from "next/link";
import { sinRLS } from "@/lib/db";
import { Cabecera } from "@/components/ui/Cabecera";
import { exigirAdmin, fechaHora } from "@/lib/admin-pagina";

export const metadata = { title: "Bitácora" };
export const dynamic = "force-dynamic";

export default async function Bitacora() {
  await exigirAdmin();
  const filas = await sinRLS(async (c) => (await c.query(`select ev.id, ev.accion, ev.datos, ev.creado, ev.empresa_id, cu.nombre quien, coalesce(e.nombre_comercial, e.razon_social) cliente
    from admin_eventos ev left join cuentas cu on cu.id = ev.cuenta_id left join empresas e on e.id = ev.empresa_id order by ev.creado desc limit 300`)).rows);
  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo="Bitácora" sub="Todo lo que se hizo desde la consola, con quién y cuándo. No se puede borrar." />
      <div className="tarjeta overflow-x-auto">
        <table className="w-full text-[15px] min-w-[760px]">
          <thead className="text-left text-sm text-muted border-b border-line"><tr><th className="px-4 py-3 font-semibold">Cuándo</th><th className="px-4 py-3 font-semibold">Quién</th><th className="px-4 py-3 font-semibold">Qué</th><th className="px-4 py-3 font-semibold">Cliente</th></tr></thead>
          <tbody className="divide-y divide-line">
            {filas.map((v) => (
              <tr key={v.id}><td className="px-4 py-2.5 text-sm">{fechaHora(v.creado)}</td><td className="px-4 py-2.5">{v.quien}</td><td className="px-4 py-2.5">{String(v.accion).replaceAll("_", " ")}</td>
                <td className="px-4 py-2.5">{v.empresa_id ? <Link href={`/admin/clientes/${v.empresa_id}`} className="underline">{v.cliente}</Link> : "—"}</td></tr>
            ))}
            {filas.length === 0 && <tr><td colSpan={4} className="px-4 py-12 text-center text-muted">Todavía no hay acciones registradas.</td></tr>}
          </tbody>
        </table>
      </div>
    </main>
  );
}
