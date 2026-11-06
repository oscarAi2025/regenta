import { redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion } from "@/lib/sesion";
import { Cabecera } from "@/components/ui/Cabecera";
import { puedePedidos } from "@/lib/pedidos";
import { EditorPedido } from "../EditorPedido";

export const metadata = { title: "Nuevo pedido" };

export default async function NuevoPedido() {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puedePedidos.armar(s.rol)) redirect("/inicio?aviso=permiso");
  const empresa = await comoUsuario(s, async (c) => (await c.query(`select coalesce(nombre_comercial, razon_social) n from empresas where id = $1`, [s.empresa])).rows[0]?.n as string);
  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo="Nuevo pedido" sub="Cotización para enviar, domicilio para despachar o venta en espera para la caja.">
        <a href="/pedidos" className="btn-borde">Volver a pedidos</a>
      </Cabecera>
      <EditorPedido inicial={null} empresa={empresa} cobra={puedePedidos.cobrar(s.rol)} />
    </main>
  );
}
