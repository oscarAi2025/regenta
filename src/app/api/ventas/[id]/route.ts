import { z } from "zod";
import { comoUsuario } from "@/lib/db";
import { conSesion, json } from "@/lib/api";

/** Anular una venta (solo dueño o administrador; la base de datos lo comprueba y devuelve las unidades al lote). */
export const DELETE = conSesion(async (s, req, ctx) => {
  const { id } = await ctx.params;
  const p = z.object({ motivo: z.string().trim().min(4, "Escribe el motivo de la anulación").max(200) }).safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message }, 400);
  await comoUsuario(s, (c) => c.query(`select anular_venta($1, $2)`, [id, p.data.motivo]));
  return json({ ok: true });
});
