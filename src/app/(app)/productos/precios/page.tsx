import Link from "next/link";
import { redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion } from "@/lib/sesion";
import { Cabecera } from "@/components/ui/Cabecera";
import { puedePrecios } from "@/lib/precios";
import { historialPrecios } from "@/lib/precios-datos";
import { CambioMasivo, type Opciones } from "./CambioMasivo";

export const metadata = { title: "Cambiar precios en bloque" };

export default async function Precios() {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puedePrecios.cambiar(s.rol)) redirect("/productos?aviso=permiso");
  const d = await comoUsuario(s, async (c) => {
    const opciones: Opciones = {
      laboratorios: (await c.query(`select trim(laboratorio) nombre, count(*)::int n from productos where empresa_id = $1 and activo and coalesce(trim(laboratorio), '') <> ''
        group by 1 order by 1 limit 2000`, [s.empresa])).rows,
      categorias: (await c.query(`select trim(categoria) nombre, count(*)::int n from productos where empresa_id = $1 and activo and coalesce(trim(categoria), '') <> ''
        group by 1 order by 1 limit 500`, [s.empresa])).rows,
      proveedores: (await c.query(`select pr.id, pr.nombre, count(distinct cl.producto_id)::int n from proveedores pr
        join compras k on k.proveedor_id = pr.id and k.estado <> 'anulada' join compra_lineas cl on cl.compra_id = k.id
        where pr.empresa_id = $1 group by pr.id order by pr.nombre limit 500`, [s.empresa])).rows,
      iva: (await c.query(`select iva::int tarifa, count(*)::int n from productos where empresa_id = $1 and activo group by 1 order by 1`, [s.empresa])).rows,
    };
    return { opciones, historial: await historialPrecios(c, s.empresa) };
  });
  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo="Cambiar precios en bloque" sub="Sube o baja los precios de un laboratorio, una categoría, un proveedor o los productos que elijas. Antes de aplicar ves cada precio nuevo y su margen; después lo puedes revertir.">
        <Link href="/productos" className="btn-borde">Volver a productos</Link>
      </Cabecera>
      <CambioMasivo opciones={d.opciones} />
      <section aria-labelledby="historial-t" className="grid gap-3 max-w-5xl">
        <h2 id="historial-t" className="titulo text-2xl">Historial de cambios</h2>
        {d.historial.length === 0 ? <p className="tarjeta p-8 text-center text-muted">Todavía no hay cambios de precio en bloque.</p> : (
          <ul className="tarjeta divide-y divide-line" aria-label="Cambios de precio">
            {d.historial.map((h) => (
              <li key={h.id} className="px-4 py-3 grid gap-1 sm:grid-cols-[110px_minmax(0,1fr)_auto] sm:gap-4 sm:items-center">
                <div className="flex sm:block items-baseline gap-2"><p className="font-semibold num">N.º {h.numero}</p><p className="text-sm text-muted num">{h.fecha}</p></div>
                <div className="min-w-0">
                  <p className="font-semibold break-words">{h.descripcion}</p>
                  <p className="text-sm text-muted">{h.productos} producto{h.productos === 1 ? "" : "s"} · {h.responsable ?? "—"}
                    {h.revertido && <span className="text-aviso font-semibold"> · revertido el {h.revertido}{h.revertidos !== h.productos ? ` (${h.revertidos} de ${h.productos})` : ""}</span>}</p>
                </div>
                <a href={`/productos/precios/${h.id}`} className="btn-borde h-9 px-3 text-sm w-fit" aria-label={`Ver el cambio N.º ${h.numero}`}>Ver detalle</a>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
