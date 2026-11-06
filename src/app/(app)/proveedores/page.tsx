import Link from "next/link";
import { redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion } from "@/lib/sesion";
import { puedeCompras } from "@/lib/compras";
import { listaProveedores } from "@/lib/compras-datos";
import { Cabecera } from "@/components/ui/Cabecera";
import { Proveedores } from "./Proveedores";

export const metadata = { title: "Proveedores" };

export default async function Pagina() {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puedeCompras.ver(s.rol)) redirect("/caja?aviso=permiso");
  const dinero = puedeCompras.dinero(s.rol);
  const lista = await comoUsuario(s, (c) => listaProveedores(c, s.empresa, dinero));
  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo="Proveedores" sub={dinero ? "Distribuidoras y laboratorios a los que les compras: datos, plazo, saldo e historial." : "Distribuidoras y laboratorios a los que les compras."}>
        <Link href="/compras" className="btn-borde">Compras</Link>
        {dinero && <Link href="/cuentas-por-pagar" className="btn-borde">Cuentas por pagar</Link>}
      </Cabecera>
      <Proveedores inicial={lista} dinero={dinero} />
    </main>
  );
}
