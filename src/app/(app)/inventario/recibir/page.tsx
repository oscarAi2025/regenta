import { redirect } from "next/navigation";
import { leerSesion, puede } from "@/lib/sesion";
import { Cabecera } from "@/components/ui/Cabecera";
import { Recibir } from "./Recibir";
import { comoUsuario } from "@/lib/db";

export const metadata = { title: "Recibir mercancía" };

export default async function Pagina() {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puede.moverInventario(s.rol)) redirect("/caja?aviso=permiso");
  const proveedores = await comoUsuario(s, async (c) => (await c.query(`select nombre from proveedores where empresa_id = $1 and activo order by nombre limit 300`, [s.empresa])).rows.map((r) => r.nombre as string));
  return <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5"><Cabecera titulo="Recibir mercancía" sub="Escanea o busca cada producto de la factura del proveedor, pon lote, vencimiento y cantidad. Al final guardas todo junto." /><Recibir verCosto={puede.verCostos(s.rol)} proveedores={proveedores} />
    {!puede.verCostos(s.rol) && <p className="text-sm text-muted max-w-3xl">El costo de cada lote lo completa el dueño o el administrador en Inventario → «Costos por completar».</p>}</main>;
}
