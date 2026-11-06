import Link from "next/link";
import { redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion } from "@/lib/sesion";
import { Cabecera } from "@/components/ui/Cabecera";
import { puedePrecios } from "@/lib/precios";
import { lotesSeparados } from "@/lib/cuarentena-datos";
import { Cuarentena } from "./Cuarentena";

export const metadata = { title: "Cuarentena" };

export default async function Pagina() {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puedePrecios.cuarentena(s.rol)) redirect("/inventario?aviso=permiso");
  const d = await comoUsuario(s, async (c) => ({
    lotes: await lotesSeparados(c, s.empresa),
    destino: (await c.query(`select devolucion_destino d from empresas where id = $1`, [s.empresa])).rows[0]?.d ?? "vendible",
  }));
  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo="Cuarentena" sub="Lotes separados de la venta: devoluciones de clientes por revisar, mercancía en duda y lotes con alerta del INVIMA. No se venden hasta liberarlos; si no sirven, se dan de baja con acta.">
        <Link href="/inventario" className="btn-borde">Volver a inventario</Link>
      </Cabecera>
      <Cuarentena inicial={d.lotes} destino={d.destino} configura={puedePrecios.configurar(s.rol)} />
    </main>
  );
}
