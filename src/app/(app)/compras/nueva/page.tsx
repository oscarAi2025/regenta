import Link from "next/link";
import { redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion } from "@/lib/sesion";
import { puedeCompras } from "@/lib/compras";
import { Cabecera } from "@/components/ui/Cabecera";
import { NuevaCompra, type ProveedorOpcion } from "./NuevaCompra";

export const metadata = { title: "Recibir mercancía" };

export default async function Pagina() {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puedeCompras.ver(s.rol)) redirect("/caja?aviso=permiso");
  const dinero = puedeCompras.dinero(s.rol);
  const proveedores: ProveedorOpcion[] = await comoUsuario(s, async (c) => (await c.query(
    `select id, nombre, nit, plazo_dias from proveedores where empresa_id = $1 and activo order by lower(nombre) limit 500`, [s.empresa])).rows);
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo="Recibir mercancía" sub={dinero
        ? "Registra la factura del proveedor: escanea cada producto, pon lote, vencimiento, cantidad y costo sin IVA. Antes de guardar ves si cuadra con el total de la factura."
        : "Escanea o busca cada producto de la factura del proveedor, pon lote, vencimiento y cantidad. Al final guardas todo junto."}>
        <Link href="/compras" className="btn-borde">Ver compras</Link>
      </Cabecera>
      <NuevaCompra dinero={dinero} proveedores={proveedores} hoy={hoy} />
      {!dinero && <p className="text-sm text-muted max-w-3xl">Los costos de la compra los completa el dueño o el administrador.</p>}
    </main>
  );
}
