import { redirect } from "next/navigation";
import { leerSesion } from "@/lib/sesion";
import { Cabecera } from "@/components/ui/Cabecera";
import { Importar } from "./Importar";

export const metadata = { title: "Cargar productos" };

export default async function Pagina() {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (s.rol !== "dueno" && s.rol !== "admin") redirect("/productos");
  return <main className="p-4 sm:p-6 grid gap-5"><Cabecera titulo="Cargar productos desde Excel" sub="Sube tu lista de productos y, si quieres, sus existencias con lote y vencimiento. Primero ves qué va a pasar; nada se guarda hasta que confirmas." /><Importar /></main>;
}
