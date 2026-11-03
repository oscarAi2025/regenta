import "server-only";
import { cookies } from "next/headers";

/** Cada computadora o celular elige con qué caja trabaja (cookie del navegador). El servidor siempre comprueba que la
 *  caja sea de la droguería de la sesión y esté activa; si no, usa la primera caja activa. */
export const COOKIE_CAJA = "regenta_caja";
export async function cajaElegida() {
  return (await cookies()).get(COOKIE_CAJA)?.value ?? null;
}
