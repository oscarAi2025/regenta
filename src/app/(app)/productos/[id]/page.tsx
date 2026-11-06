import { notFound, redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion } from "@/lib/sesion";
import { Cabecera } from "@/components/ui/Cabecera";
import { ProductoForm } from "@/components/ProductoForm";

export const metadata = { title: "Editar producto" };

export default async function Editar({ params }: { params: Promise<{ id: string }> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (s.rol !== "dueno" && s.rol !== "admin") redirect("/productos?aviso=permiso");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const p = await comoUsuario(s, async (c) => (await c.query(`select * from productos where id = $1 and empresa_id = $2 and activo`, [id, s.empresa])).rows[0]);
  if (!p) notFound();
  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo="Editar producto" sub={p.nombre} />
      <ProductoForm id={p.id} inicial={{ nombre: p.nombre, laboratorio: p.laboratorio ?? "", ean: p.ean ?? "", iva: Number(p.iva) as 0 | 5 | 19, categoria: p.categoria ?? null, unidades_por_caja: p.unidades_por_caja,
        precio_caja: String(Math.round(p.precio_caja)), precio_unidad: p.precio_unidad ? String(Math.round(p.precio_unidad)) : "", stock_minimo: p.stock_minimo, registro_sanitario: p.registro_sanitario ?? "",
        requiere_formula: !!p.requiere_formula, control_especial: !!p.control_especial }} />
    </main>
  );
}
