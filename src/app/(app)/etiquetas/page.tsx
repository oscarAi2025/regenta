import { redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion } from "@/lib/sesion";
import { Cabecera } from "@/components/ui/Cabecera";
import { puedePrecios } from "@/lib/precios";
import { productosEtiquetas } from "@/lib/etiquetas-datos";
import { Etiquetas } from "./Etiquetas";

export const metadata = { title: "Etiquetas de góndola" };

export default async function Pagina({ searchParams }: { searchParams: Promise<{ compra?: string }> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puedePrecios.etiquetas(s.rol)) redirect("/inicio?aviso=permiso");
  const { compra } = await searchParams;
  const numero = compra && /^\d{1,9}$/.test(compra) ? Number(compra) : undefined;
  const d = numero !== undefined ? await comoUsuario(s, (c) => productosEtiquetas(c, s.empresa, { compra: numero })) : null;
  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo="Etiquetas de góndola" sub="Nombre, precio de la caja y de la unidad y código de barras, en hoja A4 o en rollo de 50 × 25 mm." />
      {compra !== undefined && !d && <p role="alert" className="tarjeta p-4 text-alerta font-semibold max-w-5xl">No hay una compra N.º {compra} en tu droguería.</p>}
      <Etiquetas inicial={d?.productos ?? []} compra={d?.compra ?? null} />
    </main>
  );
}
