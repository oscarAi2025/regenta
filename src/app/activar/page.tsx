import type { Metadata } from "next";
import { Marca } from "@/components/Marca";
import { Activar } from "./Activar";
import { sinRLS } from "@/lib/db";
import { hashToken } from "@/lib/claves";
import { CORREO, TELEFONO } from "@/lib/sitio";

export const metadata: Metadata = { title: "Activa tu cuenta", robots: { index: false, follow: false } };

export default async function PaginaActivar({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t = "" } = await searchParams;
  // Se revisa el enlace antes de pedir la contraseña: uno vencido o ya usado lo dice de una vez.
  const valido = /^[\w-]{20,100}$/.test(t) && !!(await sinRLS((c) => c.query(`select 1 from invitaciones i where token_hash = $1 and usada is null and expira > now() and not exists (select 1 from superadmins s where s.user_id = i.cuenta_id)`, [hashToken(t)]))).rowCount;
  if (!valido) return (
    <main className="min-h-screen grid place-items-center bg-paper px-4 py-10">
      <div className="w-full max-w-md tarjeta p-6 sm:p-8">
        <Marca />
        <h1 className="mt-6 font-cond text-[34px] leading-tight" style={{ fontWeight: 700 }}>Este enlace ya no sirve</h1>
        <p className="mt-2 text-muted">El enlace venció o ya se usó. Si ya creaste tu contraseña, <a href="/entrar" className="text-cruz underline">entra aquí</a>. Si no, pídenos uno nuevo: {TELEFONO} (WhatsApp) o {CORREO}.</p>
      </div>
    </main>
  );
  return (
    <main className="min-h-screen grid place-items-center bg-paper px-4 py-10">
      <div className="w-full max-w-md tarjeta p-6 sm:p-8">
        <Marca />
        <h1 className="mt-6 font-cond text-[34px] leading-tight" style={{ fontWeight: 700 }}>Activa tu cuenta de Regenta</h1>
        <p className="mt-2 text-muted">Crea tu contraseña. Después entras con tu correo y esta contraseña.</p>
        <Activar token={t} />
      </div>
    </main>
  );
}
