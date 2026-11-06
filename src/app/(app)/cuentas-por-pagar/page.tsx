import Link from "next/link";
import { redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion } from "@/lib/sesion";
import { puedeCompras } from "@/lib/compras";
import { cuentasPorPagar } from "@/lib/compras-datos";
import { Cabecera } from "@/components/ui/Cabecera";
import { CuentasPorPagar } from "./CuentasPorPagar";

export const metadata = { title: "Cuentas por pagar" };

export default async function Pagina() {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puedeCompras.dinero(s.rol)) redirect(puedeCompras.ver(s.rol) ? "/compras?aviso=permiso" : "/inicio?aviso=permiso");
  const filas = await comoUsuario(s, (c) => cuentasPorPagar(c, s.empresa));
  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo="Cuentas por pagar" sub="Lo que les debes a tus proveedores: vencido, lo que vence esta semana y lo que está al día.">
        <a href="/api/cuentas-por-pagar?formato=csv" className="btn-borde" download>Descargar CSV</a>
        <Link href="/compras" className="btn-borde">Compras</Link>
        <Link href="/proveedores" className="btn-borde">Proveedores</Link>
      </Cabecera>
      <CuentasPorPagar inicial={filas} />
    </main>
  );
}
