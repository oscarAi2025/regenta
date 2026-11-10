import { notFound, redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion } from "@/lib/sesion";
import { Cabecera } from "@/components/ui/Cabecera";
import { ESTADOS, etiquetaPedido, puedePedidos } from "@/lib/pedidos";
import { detallePedido } from "@/lib/pedidos-servidor";
import { EditorPedido } from "../EditorPedido";

export const metadata = { title: "Editar pedido" };

export default async function EditarPedido({ params }: { params: Promise<{ id: string }> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puedePedidos.armar(s.rol)) redirect("/inicio?aviso=permiso");
  const { id } = await params;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  const { p, empresa } = await comoUsuario(s, async (c) => ({
    p: await detallePedido(c, s.empresa, id),
    empresa: (await c.query(`select coalesce(nombre_comercial, razon_social) n from empresas where id = $1`, [s.empresa])).rows[0]?.n as string,
  }));
  if (!p) notFound();
  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo={etiquetaPedido(p)} sub={`${p.contacto ? `${p.contacto} · ` : ""}creado el ${p.creado}${p.creado_por ? ` por ${p.creado_por}` : ""}`}>
        <a href="/pedidos" className="btn-borde">Volver a pedidos</a>
      </Cabecera>
      {p.estado === "abierto" ? <EditorPedido inicial={p} empresa={empresa} cobra={puedePedidos.cobrar(s.rol)} /> : (
        <section className="tarjeta p-6 grid gap-3 justify-items-start">
          <p className="titulo text-xl">Este pedido está {ESTADOS[p.estado].toLowerCase()}: ya no se edita</p>
          <p className="text-muted">Solo se cambian los pedidos abiertos.{p.estado === "en_camino" ? " Si el domiciliario volvió sin entregar, márcalo así en Pedidos y luego corrígelo." : ""}</p>
          <a href="/pedidos" className="btn-borde">Volver a pedidos</a>
        </section>
      )}
    </main>
  );
}
