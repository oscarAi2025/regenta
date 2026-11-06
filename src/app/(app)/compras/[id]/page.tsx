import { notFound, redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion } from "@/lib/sesion";
import { puedeCompras } from "@/lib/compras";
import { detalleCompra } from "@/lib/compras-datos";
import { estadoSoporte } from "@/lib/dian/soporte";
import { Compra } from "./Compra";
import { Soporte } from "./Soporte";

export const metadata = { title: "Compra" };

export default async function Pagina({ params }: { params: Promise<{ id: string }> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puedeCompras.ver(s.rol)) redirect("/caja?aviso=permiso");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const dinero = puedeCompras.dinero(s.rol);
  const { d, soporte } = await comoUsuario(s, async (c) => {
    const d = await detalleCompra(c, s.empresa, id, dinero);
    return { d, soporte: d && dinero ? await estadoSoporte(c, s.empresa, id) : null }; // documento soporte: solo la gerencia
  });
  if (!d) notFound();
  return <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5"><Compra inicial={JSON.parse(JSON.stringify(d))} dinero={dinero} />{soporte && <Soporte compraId={id} inicial={soporte} />}</main>;
}
