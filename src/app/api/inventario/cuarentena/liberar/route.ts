import { z } from "zod";
import { comoUsuario } from "@/lib/db";
import { conSesion, json } from "@/lib/api";
import { puedePrecios } from "@/lib/precios";
import { lotesSeparados } from "@/lib/cuarentena-datos";

/** Liberar un lote de la cuarentena (vuelve a venderse) con lo que se revisó. El bloqueo por INVIMA no se libera aquí. */
export const POST = conSesion(async (s, req) => {
  if (!puedePrecios.cuarentena(s.rol)) return json({ error: "Solo el dueño, el administrador o la bodega liberan lotes de la cuarentena" }, 403);
  const p = z.object({ lote_id: z.string().uuid("Elige el lote"), motivo: z.string().trim().min(4, "Escribe qué se revisó antes de liberarlo").max(200) }).safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Datos incompletos" }, 400);
  const r = await comoUsuario(s, async (c) => {
    if (!(await c.query(`select 1 from lotes where id = $1 and empresa_id = $2`, [p.data.lote_id, s.empresa])).rowCount) return null;
    const x = (await c.query(`select liberar_cuarentena($1, $2) r`, [p.data.lote_id, p.data.motivo])).rows[0].r;
    return { ...x, lotes: await lotesSeparados(c, s.empresa) };
  });
  return r ? json(r) : json({ error: "Ese lote no existe en tu droguería" }, 404);
});
