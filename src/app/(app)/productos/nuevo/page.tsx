import { redirect } from "next/navigation";
import { leerSesion } from "@/lib/sesion";
import { Cabecera } from "@/components/ui/Cabecera";
import { ProductoForm } from "@/components/ProductoForm";

export const metadata = { title: "Agregar producto" };

export default async function Nuevo() {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (s.rol !== "dueno" && s.rol !== "admin") redirect("/productos");
  return <main className="p-4 sm:p-6 grid gap-5"><Cabecera titulo="Agregar producto" sub="Búscalo en el catálogo Regenta y solo pon tu precio, o créalo a mano." /><ProductoForm /></main>;
}
