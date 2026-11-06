import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion } from "@/lib/sesion";
import { ESTADOS, nombreMedio, pesosExactos, puedeCompras } from "@/lib/compras";
import { cuentasPorPagar, listaCompras, listaProveedores } from "@/lib/compras-datos";
import { Cabecera } from "@/components/ui/Cabecera";
import { Ficha } from "./Ficha";

export const metadata = { title: "Proveedor" };
const fecha = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");

export default async function Pagina({ params }: { params: Promise<{ id: string }> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puedeCompras.ver(s.rol)) redirect("/caja?aviso=permiso");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const dinero = puedeCompras.dinero(s.rol);
  const d = await comoUsuario(s, async (c) => {
    const p = (await listaProveedores(c, s.empresa, dinero, id))[0];
    if (!p) return null;
    return {
      p, cuentas: dinero ? await cuentasPorPagar(c, s.empresa, id) : [],
      compras: await listaCompras(c, s.empresa, { proveedor: id }, dinero),
      pagos: dinero ? (await c.query(`select g.id, g.medio, g.valor::float, g.referencia, g.anulado, to_char(g.creado at time zone 'America/Bogota', 'DD/MM/YYYY') fecha,
          (select string_agg(k.numero_factura, ', ' order by k.numero) from pago_aplicaciones a join compras k on k.id = a.compra_id where a.pago_id = g.id) facturas
        from pagos_proveedor g where g.proveedor_id = $1 and g.empresa_id = $2 order by g.creado desc limit 100`, [id, s.empresa])).rows : [],
    };
  });
  if (!d) notFound();
  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo={d.p.nombre} sub={`${d.p.nit ? `NIT ${d.p.nit}${d.p.dv ? "-" + d.p.dv : ""} · ` : ""}${d.p.compras} compra${d.p.compras === 1 ? "" : "s"}`}>
        <Link href="/proveedores" className="btn-borde">Volver a proveedores</Link>
      </Cabecera>
      <Ficha inicial={d.p} cuentas={d.cuentas} dinero={dinero} />
      <section className="tarjeta overflow-x-auto" aria-labelledby="hist-t">
        <h2 id="hist-t" className="titulo text-xl px-4 pt-4">Historial de compras</h2>
        <table className="w-full text-[15px] min-w-[560px]" aria-label="Historial de compras"><thead className="text-left text-sm text-muted border-b border-line"><tr>
          <th className="px-4 py-2.5 font-semibold">Compra</th><th className="px-4 py-2.5 font-semibold">Factura</th><th className="px-4 py-2.5 font-semibold">Estado</th>{dinero && <th className="px-4 py-2.5 font-semibold text-right">Total</th>}</tr></thead>
          <tbody className="divide-y divide-line">{d.compras.map((k) => (
            <tr key={k.id}><td className="px-4 py-2.5"><Link href={`/compras/${k.id}`} className="num font-semibold hover:underline">N.º {k.numero}</Link> <span className="text-sm text-muted">· {fecha(k.fecha_factura)}</span></td>
              <td className="px-4 py-2.5 num">{k.numero_factura}</td><td className="px-4 py-2.5">{ESTADOS[k.estado]}</td>
              {dinero && <td className="px-4 py-2.5 num text-right">{k.estado === "por_costear" ? "—" : pesosExactos(k.total ?? 0)}</td>}</tr>
          ))}
          {d.compras.length === 0 && <tr><td colSpan={4} className="px-4 py-8 text-center text-muted">Sin compras a este proveedor.</td></tr>}</tbody></table>
      </section>
      {dinero && d.pagos.length > 0 && (
        <section className="tarjeta overflow-x-auto" aria-labelledby="pagos-t">
          <h2 id="pagos-t" className="titulo text-xl px-4 pt-4">Pagos</h2>
          <table className="w-full text-[15px] min-w-[560px]"><thead className="text-left text-sm text-muted border-b border-line"><tr>
            <th className="px-4 py-2.5 font-semibold">Fecha</th><th className="px-4 py-2.5 font-semibold">Medio</th><th className="px-4 py-2.5 font-semibold">Facturas</th><th className="px-4 py-2.5 font-semibold text-right">Valor</th></tr></thead>
            <tbody className="divide-y divide-line">{d.pagos.map((g) => (
              <tr key={g.id} className={g.anulado ? "text-muted line-through" : ""}><td className="px-4 py-2.5 num">{g.fecha}</td><td className="px-4 py-2.5">{nombreMedio(g.medio)}{g.referencia ? ` · ${g.referencia}` : ""}{g.anulado ? " (anulado)" : ""}</td>
                <td className="px-4 py-2.5 num">{g.facturas}</td><td className="px-4 py-2.5 num text-right">{pesosExactos(g.valor)}</td></tr>
            ))}</tbody></table>
        </section>
      )}
    </main>
  );
}
