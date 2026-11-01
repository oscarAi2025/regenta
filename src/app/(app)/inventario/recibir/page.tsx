import { redirect } from "next/navigation";
import { leerSesion, puede } from "@/lib/sesion";
import { Cabecera } from "@/components/ui/Cabecera";
import { Recibir } from "./Recibir";

export const metadata = { title: "Recibir mercancía" };

export default async function Pagina() {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puede.moverInventario(s.rol)) redirect("/caja?aviso=permiso");
  return <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5"><Cabecera titulo="Recibir mercancía" sub="Escanea o busca cada producto de la factura del proveedor, pon lote, vencimiento y cantidad. Al final guardas todo junto." /><Recibir verCosto={puede.verCostos(s.rol)} /></main>;
}
