import { notFound, redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion } from "@/lib/sesion";
import { facturaParaNotaDebito, puedeDian } from "@/lib/dian/soporte";
import { NotaDebito } from "./NotaDebito";

export const metadata = { title: "Nota débito" };

export default async function Pagina({ params }: { params: Promise<{ id: string }> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puedeDian.emitir(s.rol)) redirect("/inicio?aviso=permiso"); // dueño y administrador
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const { f, responsable } = await comoUsuario(s, async (c) => ({ f: await facturaParaNotaDebito(c, s.empresa, id),
    responsable: (await c.query(`select responsable_iva from empresas where id = $1`, [s.empresa])).rows[0]?.responsable_iva !== false }));
  if (!f) notFound();
  return <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5"><NotaDebito inicial={JSON.parse(JSON.stringify(f))} responsable={responsable} /></main>;
}
