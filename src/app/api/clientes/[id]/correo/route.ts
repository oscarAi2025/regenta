import { z } from "zod";
import { comoUsuario } from "@/lib/db";
import { conSesion, json } from "@/lib/api";
import { puede } from "@/lib/sesion";

const esUuid = (v: string) => /^[0-9a-f-]{36}$/i.test(v);

/** Desde la caja: poner el correo a un cliente que no lo tiene (la factura electrónica lo necesita). Solo si está vacío:
 *  cambiar un correo ya guardado lo hacen el dueño o el administrador en Clientes. */
export const POST = conSesion(async (s, req, ctx) => {
  if (!puede.vender(s.rol)) return json({ error: "Tu usuario no puede editar clientes" }, 403);
  const { id } = await ctx.params;
  if (!esUuid(id)) return json({ error: "No encontrado" }, 404);
  const p = z.object({ email: z.string().trim().toLowerCase().email("Escribe un correo válido").max(160) }).safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Escribe un correo válido" }, 400);
  const r = await comoUsuario(s, async (c) => {
    const ya = (await c.query(`select email from clientes where id = $1 and empresa_id = $2`, [id, s.empresa])).rows[0];
    if (!ya) return null;
    if (ya.email) return { ya: ya.email as string };
    await c.query(`update clientes set email = $3 where id = $1 and empresa_id = $2`, [id, s.empresa, p.data.email]);
    return { email: p.data.email };
  });
  if (!r) return json({ error: "Ese cliente no existe en tu droguería" }, 404);
  if ("ya" in r) return json({ error: "Este cliente ya tiene correo: el dueño o el administrador lo cambian en Clientes" }, 409);
  return json({ email: r.email });
});
