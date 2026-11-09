import "server-only";
import { redirect } from "next/navigation";
import { leerAdmin } from "./admin";
import { PLANES } from "./planes";

/** Para las páginas de la consola: sin sesión de superadministrador, a la entrada. */
export async function exigirAdmin({ inscribir = false } = {}) {
  const a = await leerAdmin();
  if (!a) redirect("/admin/entrar");
  // Sin verificación en dos pasos activa, la única página de la consola es la que la activa.
  if (a.inscribir && !inscribir) redirect("/admin/dos-pasos");
  return a;
}
export const NOMBRE_PLAN: Record<string, string> = { esencial: "Esencial", pro: "Pro", cadena: "Cadena", socio: "Socio" };
/** Precio mensual de lista de cada plan (Cadena y Socio no tienen precio fijo). */
export const PRECIO_PLAN: Record<string, number> = Object.fromEntries(PLANES.filter((p) => p.precio).map((p) => [p.id, p.precio!]));
export const fechaHora = (d: string | Date | null) => d ? new Date(d).toLocaleString("es-CO", { timeZone: "America/Bogota", day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "—";
