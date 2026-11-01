import { z } from "zod";
import { comoUsuario } from "@/lib/db";
import { conSesion, esUuid, json } from "@/lib/api";

/** Anular una venta (solo dueño o administrador; la base de datos lo comprueba y devuelve las unidades al lote). */
export const DELETE = conSesion(async (s, req, ctx) => {
  const { id } = await ctx.params;
  if (!esUuid(id)) return json({ error: "No encontrado" }, 404);
  const p = z.object({ motivo: z.string().trim().min(4, "Escribe el motivo de la anulación").max(200) }).safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message }, 400);
  const ok = await comoUsuario(s, async (c) => {
    if (!(await c.query(`select 1 from ventas where id = $1 and empresa_id = $2`, [id, s.empresa])).rowCount) return false; // solo ventas de la droguería de la sesión
    await c.query(`select anular_venta($1, $2)`, [id, p.data.motivo]);
    return true;
  });
  if (!ok) return json({ error: "Ese registro no existe en tu droguería" }, 404);
  return json({ ok: true });
});
