import Link from "next/link";

export const metadata = { title: "No encontrado", robots: { index: false, follow: false } };

/** Página que no existe (o documento de otra droguería): en español y con salida. */
export default function NoEncontrado() {
  return (
    <main className="min-h-screen grid place-items-center bg-paper p-6">
      <div className="tarjeta max-w-md w-full p-8 text-center grid gap-3">
        <p className="titulo text-5xl text-muted num">404</p>
        <h1 className="titulo text-2xl">No encontramos esa página</h1>
        <p className="text-muted">Puede que el enlace esté mal escrito o que el documento ya no exista o sea de otra droguería.</p>
        <div className="flex flex-wrap justify-center gap-2 mt-2">
          <Link href="/inicio" className="btn-primario">Ir al inicio</Link>
          <Link href="/ventas" className="btn-borde">Ver ventas</Link>
        </div>
      </div>
    </main>
  );
}
