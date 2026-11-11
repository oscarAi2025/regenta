import "server-only";
import { sinRLS } from "@/lib/db";

/** Saludos de inicio personalizados por persona (por su correo de acceso), pedidos por el dueño. Quien no está aquí recibe
 *  el saludo normal («Buenos días, …»). 11/11/2026: saludo de Carlos Ñustes pedido por Oscar. */
const SALUDOS: Record<string, string> = {
  "carlos.nustes@farmagenericoscolombia.com": "KELOKE MI NEGRO LOCO, BREVE PAPI PILAS CON LAS VENTAS",
};

export async function saludoPersonal(uid: string): Promise<string | null> {
  const email = (await sinRLS(async (c) => (await c.query(`select lower(email) email from cuentas where id = $1`, [uid])).rows[0]?.email as string | undefined).catch(() => undefined));
  return email ? SALUDOS[email] ?? null : null;
}
