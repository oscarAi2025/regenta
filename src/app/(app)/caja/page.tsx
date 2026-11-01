import { redirect } from "next/navigation";
import { leerSesion, puede } from "@/lib/sesion";
import { Caja } from "./Caja";

export const metadata = { title: "Caja" };

export default async function PaginaCaja() {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puede.vender(s.rol)) redirect("/inventario?aviso=permiso");
  return <main><h1 className="sr-only">Caja</h1><Caja fiar={puede.fiar(s.rol)} /></main>;
}
