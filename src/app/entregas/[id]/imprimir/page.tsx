import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { esUuid } from "@/lib/api";
import { leerSesion } from "@/lib/sesion";
import { detalleEntrega, puedeEntregar } from "@/lib/entregas-datos";
import { ComprobanteEntrega } from "@/components/app/ComprobanteEntrega";
import { BotonImprimir } from "./BotonImprimir";

// Comprobante de una entrega interna para imprimir o guardar en PDF, con firmas de quien entrega y quien recibe.
export const metadata: Metadata = { title: "Comprobante de entrega interna", robots: { index: false, follow: false } };

export default async function ImprimirEntrega({ params }: { params: Promise<{ id: string }> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puedeEntregar(s.rol)) redirect("/inicio?aviso=permiso");
  const { id } = await params;
  if (!esUuid(id)) notFound();
  const d = await comoUsuario(s, (c) => detalleEntrega(c, s.empresa, id));
  if (!d) notFound();
  return (
    <main className="max-w-[900px] mx-auto p-4 sm:p-10 print:p-0 bg-white text-ink grid gap-4">
      <style>{`@page { size: letter portrait; margin: 12mm; } @media print { html, body { background: #fff; } tr { break-inside: avoid; } }`}</style>
      <BotonImprimir id={id} />
      <ComprobanteEntrega d={d} />
    </main>
  );
}
