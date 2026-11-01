import { Marca } from "@/components/Marca";
import { leerTokenBaja } from "@/lib/correo";
import { CORREO } from "@/lib/sitio";
import { BotonBaja } from "./BotonBaja";

export const metadata = { title: "Dejar de recibir correos", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";

// La baja se confirma con un botón (POST): así los antivirus que abren los enlaces del correo no dan de baja a nadie.
export default async function Baja({ searchParams }: { searchParams: Promise<{ t?: string }> }) {
  const { t = "" } = await searchParams;
  const email = leerTokenBaja(t);
  return (
    <main className="min-h-screen bg-paper text-ink grid place-items-center px-5 py-12">
      <div className="w-full max-w-md grid gap-5">
        <Marca />
        {email ? (
          <>
            <h1 className="font-cond text-4xl" style={{ fontWeight: 700 }}>¿Dejar de recibir consejos y novedades?</h1>
            <p className="text-muted text-[17px]">Dejaremos de enviar correos comerciales a <b className="text-ink">{email}</b>. Si tienes un plan, seguirás recibiendo los de tu cuenta: activación, pagos y renovación.</p>
            <BotonBaja t={t} />
          </>
        ) : (
          <>
            <h1 className="font-cond text-4xl" style={{ fontWeight: 700 }}>Este enlace no es válido</h1>
            <p className="text-muted text-[17px]">Escríbenos a {CORREO} y te quitamos de la lista.</p>
          </>
        )}
      </div>
    </main>
  );
}
