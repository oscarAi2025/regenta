import { redirect } from "next/navigation";
import { Marca } from "@/components/Marca";
import { leerAdmin } from "@/lib/admin";
import { FormAcceso } from "@/app/entrar/FormAcceso";

export const metadata = { title: "Entrar a la consola" };

export default async function EntrarConsola() {
  if (await leerAdmin()) redirect("/admin");
  return (
    <main className="min-h-screen grid place-items-center bg-[#0b1f33] px-4 py-10">
      <div className="w-full max-w-md tarjeta p-6 sm:p-8">
        <Marca />
        <h1 className="mt-6 font-cond text-[34px] leading-tight" style={{ fontWeight: 700 }}>Consola de Regenta</h1>
        <p className="mt-1 text-muted">Solo para el equipo de Farmagenéricos Colombia.</p>
        <FormAcceso consola />
      </div>
    </main>
  );
}
