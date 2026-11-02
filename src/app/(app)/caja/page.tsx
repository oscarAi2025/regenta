import { redirect } from "next/navigation";
import { leerSesion, puede } from "@/lib/sesion";
import { comoUsuario } from "@/lib/db";
import { Caja } from "./Caja";

export const metadata = { title: "Caja" };

export default async function PaginaCaja() {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puede.vender(s.rol)) redirect("/inventario?aviso=permiso");
  const nombre = await comoUsuario(s, async (c) => (await c.query(`select coalesce(nombre_comercial, razon_social) n from empresas where id = $1`, [s.empresa])).rows[0]?.n ?? "");
  return <main><h1 className="sr-only">Caja</h1><Caja fiar={puede.fiar(s.rol)} empresa={s.empresa} nombreEmpresa={nombre} /></main>;
}
