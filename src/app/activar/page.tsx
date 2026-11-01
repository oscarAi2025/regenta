import type { Metadata } from "next";
import { Marca } from "@/components/Marca";
import { Activar } from "./Activar";

export const metadata: Metadata = { title: "Activa tu cuenta", robots: { index: false, follow: false } };

export default async function PaginaActivar({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t = "" } = await searchParams;
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
