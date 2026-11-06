import { notFound, redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion } from "@/lib/sesion";
import { puedeCompras } from "@/lib/compras";
import { detalleCompra } from "@/lib/compras-datos";
import { Compra } from "./Compra";

export const metadata = { title: "Compra" };

export default async function Pagina({ params }: { params: Promise<{ id: string }> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puedeCompras.ver(s.rol)) redirect("/caja?aviso=permiso");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const dinero = puedeCompras.dinero(s.rol);
  const d = await comoUsuario(s, (c) => detalleCompra(c, s.empresa, id, dinero));
  if (!d) notFound();
  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Compra inicial={JSON.parse(JSON.stringify(d))} dinero={dinero} />
      {d.compra.estado !== "anulada" && <a href={`/etiquetas?compra=${d.compra.numero}`} className="btn-borde w-fit">Imprimir etiquetas de lo recibido</a>}
    </main>
  );
}
