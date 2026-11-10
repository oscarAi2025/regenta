import { notFound, redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion } from "@/lib/sesion";
import { Cabecera } from "@/components/ui/Cabecera";
import { puedePrecios } from "@/lib/precios";
import { detallePrecios } from "@/lib/precios-datos";
import { DetalleCambio } from "./DetalleCambio";

export const metadata = { title: "Cambio de precios" };

export default async function Cambio({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ aplicado?: string }> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puedePrecios.cambiar(s.rol)) redirect("/productos?aviso=permiso");
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const d = await comoUsuario(s, (c) => detallePrecios(c, s.empresa, id));
  if (!d) notFound();
  const { aplicado } = await searchParams;
  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo={`Cambio de precios N.º ${d.numero}`} sub={<span className="break-words">{d.descripcion}</span>}>
        <a href="/productos/precios" className="btn-borde">Volver a precios</a>
      </Cabecera>
      <DetalleCambio inicial={JSON.parse(JSON.stringify(d))} aplicado={aplicado === "1"} />
    </main>
  );
}
