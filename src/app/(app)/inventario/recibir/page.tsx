import { redirect } from "next/navigation";
import { leerSesion, puede } from "@/lib/sesion";

// «Recibir mercancía» ahora es la compra (factura del proveedor + recepción): los enlaces viejos llevan a /compras/nueva.
export default async function Pagina() {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puede.moverInventario(s.rol)) redirect("/caja?aviso=permiso");
  redirect("/compras/nueva");
}
