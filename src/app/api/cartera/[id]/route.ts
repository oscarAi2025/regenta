import { z } from "zod";
import { comoUsuario } from "@/lib/db";
import { conSesion, json } from "@/lib/api";
import { puede } from "@/lib/sesion";

/** Anular un abono (con motivo; queda la constancia). La base de datos comprueba el rol. */
export const DELETE = conSesion(async (s, req, ctx) => {
  if (!puede.cartera(s.rol)) return json({ error: "Solo el dueño o el administrador anulan abonos" }, 403);
  const { id } = await ctx.params;
  if (!/^\d{1,18}$/.test(id)) return json({ error: "No encontrado" }, 404);
  const p = z.object({ motivo: z.string().trim().min(4, "Escribe el motivo").max(200) }).safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message }, 400);
  const ok = await comoUsuario(s, async (c) => {
    if (!(await c.query(`select 1 from abonos where id = $1 and empresa_id = $2`, [id, s.empresa])).rowCount) return false;
    await c.query(`select anular_abono($1, $2)`, [id, p.data.motivo]);
    return true;
  });
  if (!ok) return json({ error: "Ese registro no existe en tu droguería" }, 404);
  return json({ ok: true });
});
