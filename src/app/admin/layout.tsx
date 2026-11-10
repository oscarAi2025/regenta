import type { Metadata } from "next";
import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { Isotipo } from "@/components/Marca";
import { NavAdmin } from "@/components/admin/Nav";
import { leerAdmin } from "@/lib/admin";
import { dosPasosActivos } from "@/lib/totp";
import { MarcaRender } from "@/components/MarcaRender";

export const metadata: Metadata = { title: { default: "Consola", template: "%s · Consola Regenta" }, robots: { index: false, follow: false } };

const LIBRES = ["/admin/entrar", "/admin/activar"]; // se abren sin sesión de consola

/** Consola de superadministración: solo cuentas de la tabla superadmins. El acceso se decide aquí, ANTES del límite de
 *  carga (loading.tsx): así las redirecciones son 307 del servidor y la página nunca empieza a enviarse sin permiso.
 *  Cada página lo vuelve a comprobar (exigirAdmin). */
export default async function LayoutAdmin({ children }: { children: React.ReactNode }) {
  const ruta = (await headers()).get("x-ruta") ?? "";
  const a = await leerAdmin();
  if (ruta) {
    const libre = LIBRES.some((r) => ruta === r || ruta.startsWith(r + "/"));
    if (ruta === "/admin/entrar" && a) redirect(a.inscribir ? "/admin/dos-pasos" : "/admin");
    if (!libre && !a) redirect("/admin/entrar");
    if (a?.inscribir && !libre && ruta !== "/admin/dos-pasos") redirect("/admin/dos-pasos");
    if (ruta === "/admin/dos-pasos" && !dosPasosActivos()) redirect("/admin");
  }
  if (!a || a.inscribir) return <>{children}</>; // /admin/entrar, /admin/activar y /admin/dos-pasos: sin el menú
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
