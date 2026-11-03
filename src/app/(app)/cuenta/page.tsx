import { redirect } from "next/navigation";
import { sinRLS } from "@/lib/db";
import { leerSesion } from "@/lib/sesion";
import { Cabecera } from "@/components/ui/Cabecera";
import { MiCuenta } from "./MiCuenta";

export const metadata = { title: "Mi cuenta" };

/** Mi cuenta (todos los roles): contraseña y sesiones abiertas. */
export default async function Cuenta() {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  const d = await sinRLS(async (c) => (await c.query(`select e.demo, (select email from cuentas where id = $1) email from empresas e where e.id = $2`, [s.uid, s.empresa])).rows[0]);
  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5 max-w-2xl">
      <Cabecera titulo="Mi cuenta" sub={`${s.nombre.split(" (")[0]}${d?.email ? ` · ${d.email}` : ""}`} />
      {d?.demo || s.soporte
        ? <p className="tarjeta p-5 text-muted">{s.soporte ? "Estás como soporte: la contraseña la cambia solo su dueño." : "En la demostración no hay contraseñas: cada quien entra con su propio usuario cuando contrata."}</p>
        : <MiCuenta />}
    </main>
  );
}
