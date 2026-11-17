import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { esUuid } from "@/lib/api";
import { leerSesion } from "@/lib/sesion";
import { numeroEntrega } from "@/lib/entregas";
import { detalleEntrega, puedeAnularEntrega, puedeEntregar } from "@/lib/entregas-datos";
import { ComprobanteEntrega } from "@/components/app/ComprobanteEntrega";
import { Anular } from "./Anular";

export const metadata = { title: "Entrega interna" };

export default async function Entrega({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ nueva?: string }> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puedeEntregar(s.rol)) redirect("/inicio?aviso=permiso");
  const { id } = await params;
  if (!esUuid(id)) notFound();
  const d = await comoUsuario(s, (c) => detalleEntrega(c, s.empresa, id));
  if (!d) notFound();
  const nueva = (await searchParams).nueva === "1";
  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/entregas" className="text-sm font-semibold text-cruz">← Entregas</Link>
        <div className="flex flex-wrap gap-2">
          <a href={`/entregas/${id}/imprimir`} target="_blank" rel="noopener" className="btn-borde">Imprimir comprobante</a>
          <Link href="/entregas/nueva" className="btn-primario">Nueva entrega</Link>
        </div>
      </div>
      {nueva && <p role="status" className="rounded-xl bg-cruz-soft text-cruz px-4 py-3 font-semibold">Entrega {numeroEntrega(d.entrega.numero)} registrada: {d.entrega.unidades} unidades salieron del inventario.</p>}
      <section className="tarjeta p-5 min-w-0"><ComprobanteEntrega d={d} /></section>
      {!d.entrega.anulada && puedeAnularEntrega(s.rol) && <Anular id={id} numero={d.entrega.numero} />}
    </main>
  );
}
