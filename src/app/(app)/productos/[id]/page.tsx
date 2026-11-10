import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion, puede } from "@/lib/sesion";
import { Cabecera, existenciasTexto } from "@/components/ui/Cabecera";
import { ProductoForm } from "@/components/ProductoForm";
import { Kardex } from "./Kardex";
import { Codigos } from "./Codigos";
import { puedePrecios } from "@/lib/precios";

export const metadata = { title: "Producto" };

/** Ficha del producto: datos (dueño y administrador) y kardex (también la bodega). */
export default async function Editar({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ desde?: string; hasta?: string; lote?: string }> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  const gestiona = s.rol === "dueno" || s.rol === "admin";
  if (!gestiona && !puede.moverInventario(s.rol)) redirect("/productos?aviso=permiso");
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) notFound();
  const filtros = await searchParams;
  const d = await comoUsuario(s, async (c) => {
    const p = (await c.query(`select p.*, coalesce((select sum(unidades) from v_stock_vigente v where v.producto_id = p.id), 0)::int vigentes
      from productos p where p.id = $1 and p.empresa_id = $2 and p.activo`, [id, s.empresa])).rows[0];
    if (!p) return null;
    const codigos = (await c.query(`select id::int, codigo, to_char(creado at time zone 'America/Bogota', 'DD/MM/YYYY') creado from producto_codigos where producto_id = $1 order by creado, id`, [id])).rows;
    return { p, codigos, kardex: await Kardex({ c, producto: p, filtros }) };
  });
  if (!d) notFound();
  const { p } = d;
  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo={gestiona ? "Editar producto" : "Producto"} sub={<>{p.nombre} · <span className="num">{existenciasTexto(p.vigentes, p.unidades_por_caja)}</span> para vender</>}>
        <a href="#kardex" className="btn-borde">Ver kardex</a>
        {puede.moverInventario(s.rol) && <Link href="/inventario/ajustes" className="btn-borde">Ajustar o dar de baja</Link>}
      </Cabecera>
      {gestiona && <ProductoForm id={p.id} inicial={{ nombre: p.nombre, laboratorio: p.laboratorio ?? "", ean: p.ean ?? "", iva: Number(p.iva) as 0 | 5 | 19, categoria: p.categoria ?? null, unidades_por_caja: p.unidades_por_caja,
        precio_caja: String(Math.round(p.precio_caja)), precio_unidad: p.precio_unidad ? String(Math.round(p.precio_unidad)) : "", stock_minimo: p.stock_minimo, registro_sanitario: p.registro_sanitario ?? "",
        requiere_formula: !!p.requiere_formula, control_especial: !!p.control_especial }} />}
      {puedePrecios.codigos(s.rol) && <Codigos productoId={p.id} principal={p.ean} inicial={d.codigos} />}
      {d.kardex}
    </main>
  );
}
