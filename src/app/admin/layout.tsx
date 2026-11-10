import type { Metadata } from "next";
import { Isotipo } from "@/components/Marca";
import { NavAdmin } from "@/components/admin/Nav";
import { leerAdmin } from "@/lib/admin";
import { MarcaRender } from "@/components/MarcaRender";

export const metadata: Metadata = { title: { default: "Consola", template: "%s · Consola Regenta" }, robots: { index: false, follow: false } };

/** Consola de superadministración: solo cuentas de la tabla superadmins (cada página lo vuelve a comprobar). */
export default async function LayoutAdmin({ children }: { children: React.ReactNode }) {
  const a = await leerAdmin();
  if (!a || a.inscribir) return <>{children}</>; // /admin/entrar y /admin/dos-pasos; las demás páginas redirigen solas
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[240px_minmax(0,1fr)] bg-paper">
      <aside className="bg-[#0b1f33] text-white p-3 lg:p-5 lg:min-h-screen lg:sticky lg:top-0 grid gap-4 content-start">
        <div className="flex items-center gap-2.5"><Isotipo size={36} claro /><div className="leading-tight"><p className="font-cond text-xl" style={{ fontWeight: 700 }}>Consola</p><p className="text-xs text-white/60">{a.nombre}</p></div></div>
        <NavAdmin />
      </aside>
      <div className="min-w-0">{children}<MarcaRender /></div>
    </div>
  );
}
