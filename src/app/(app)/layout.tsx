import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion } from "@/lib/sesion";
import { Isotipo } from "@/components/Marca";
import { Navegacion } from "@/components/Navegacion";

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
        <Isotipo size={40} />
        <Navegacion rol={s.rol} />
      </aside>
      <div className="min-w-0">
        <header className="flex items-center justify-between gap-4 px-4 sm:px-6 h-14 border-b border-line bg-surface">
          <p className="truncate"><span className="font-semibold">{emp.nombre_comercial ?? emp.razon_social}</span><span className="text-muted text-sm"> · NIT {emp.nit}-{emp.dv}</span></p>
          <p className="text-sm text-muted shrink-0">{s.nombre.split(" (")[0]} · {rol}</p>
        </header>
        {children}
      </div>
    </div>
  );
}
