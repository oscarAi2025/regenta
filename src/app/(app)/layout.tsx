import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion } from "@/lib/sesion";
import { Isotipo } from "@/components/Marca";
import { Navegacion } from "@/components/Navegacion";
import { Asistente } from "@/components/app/Asistente";
import { Buscador } from "@/components/app/Buscador";
import { BotonBuscar } from "@/components/app/BotonBuscar";
import { iaActiva } from "@/lib/ia/claude";
import { AvisoPermiso } from "@/components/app/AvisoPermiso";
import Link from "next/link";

// La aplicación nunca se indexa: solo la portada comercial es pública.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  const emp = await comoUsuario(s, async (c) => (await c.query(`select nombre_comercial, razon_social, nit, dv from empresas where id = $1`, [s.empresa])).rows[0]);
  if (!emp) redirect("/entrar");
  const rol = { dueno: "Dueño", admin: "Administrador", cajero: "Cajera", bodeguero: "Bodega", vendedor: "Vendedor" }[s.rol];
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[88px_1fr]">
      <aside className="bg-ink text-white lg:min-h-screen flex lg:flex-col items-center gap-2 px-3 py-3 lg:py-5 sticky top-0 z-20">
        <Isotipo size={40} claro />
        <Navegacion rol={s.rol} />
      </aside>
      <div className="min-w-0">
        <header className="flex items-center justify-between gap-4 px-4 sm:px-6 h-14 border-b border-line bg-surface">
          <p className="truncate"><span className="font-semibold">{emp.nombre_comercial ?? emp.razon_social}</span><span className="text-muted text-sm"> · NIT {emp.nit}-{emp.dv}</span><span className="hidden 2xl:inline text-muted text-sm"> · Regenta, facturación y gestión farmacéutica</span></p>
          <BotonBuscar />
          <p className="text-sm text-muted shrink-0 hidden sm:block">{s.nombre.split(" (")[0]} · {rol}</p>
        </header>
        {s.soporte && (
          <p className="bg-amber-300 text-[#0b1f33] px-4 sm:px-6 py-2 text-sm font-semibold flex flex-wrap items-center justify-between gap-2">
            Estás dentro de {emp.nombre_comercial ?? emp.razon_social} como soporte de Regenta: todo lo que hagas queda a nombre del usuario.
            <Link href="/admin/clientes" className="underline">Volver a la consola</Link>
          </p>
        )}
        <AvisoPermiso />
        <div className="pb-24">{children}</div>
      </div>
      <Buscador rol={s.rol} />
      <Asistente activa={iaActiva()} />
    </div>
  );
}
