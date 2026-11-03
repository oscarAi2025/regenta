import type { Metadata } from "next";
import { Marca } from "@/components/Marca";
import { Activar } from "@/app/activar/Activar";
import { sinRLS } from "@/lib/db";
import { hashToken } from "@/lib/claves";

export const metadata: Metadata = { title: "Contraseña de la consola", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// Contraseña del superadministrador con un enlace de un solo uso. La aplicación nunca crea estos enlaces (enlaceInvitacion
// rechaza cuentas de superadministrador): solo se generan desde el editor SQL de la base, con acceso de dueño del proyecto.
export default async function ActivarConsola({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t = "" } = await searchParams;
  const valido = /^[\w-]{20,100}$/.test(t) && !!(await sinRLS((c) => c.query(`select 1 from invitaciones i join superadmins s on s.user_id = i.cuenta_id
    where i.token_hash = $1 and i.usada is null and i.expira > now()`, [hashToken(t)]))).rowCount;
  return (
    <main className="min-h-screen grid place-items-center bg-paper px-4 py-10">
      <div className="w-full max-w-md tarjeta p-6 sm:p-8">
        <Marca />
        {valido ? <>
          <h1 className="mt-6 font-cond text-[34px] leading-tight" style={{ fontWeight: 700 }}>Contraseña de la consola</h1>
          <p className="mt-2 text-muted">Crea la contraseña de tu cuenta de superadministrador. Después entras a la consola con tu correo y esta contraseña.</p>
          <Activar token={t} api="/api/admin/activar" entrar="/admin/entrar" boton="Guardar contraseña" />
        </> : <>
          <h1 className="mt-6 font-cond text-[34px] leading-tight" style={{ fontWeight: 700 }}>Este enlace ya no sirve</h1>
          <p className="mt-2 text-muted">Venció o ya se usó. Genera uno nuevo desde el editor SQL de la base.</p>
        </>}
      </div>
    </main>
  );
}
