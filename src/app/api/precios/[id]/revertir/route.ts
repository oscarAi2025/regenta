import { z } from "zod";
import { comoUsuario } from "@/lib/db";
import { conSesion, esUuid, json } from "@/lib/api";
import { puedePrecios } from "@/lib/precios";
import { detallePrecios } from "@/lib/precios-datos";

/** Revierte un cambio masivo (dueño o administrador). Si algún producto cambió de precio después, responde 409 con la
 *  lista y no toca nada; con { parcial: true } revierte solo los que siguen con el precio que dejó el cambio. */
export const POST = conSesion(async (s, req, ctx) => {
  if (!puedePrecios.cambiar(s.rol)) return json({ error: "Solo el dueño o el administrador revierten cambios de precio" }, 403);
  const { id } = await ctx.params;
  if (!esUuid(id)) return json({ error: "No encontrado" }, 404);
  const p = z.object({ parcial: z.boolean().default(false) }).safeParse((await req.json().catch(() => ({}))) ?? {});
  if (!p.success) return json({ error: "Datos no válidos" }, 400);
  const r = await comoUsuario(s, async (c) => {
    if (!(await c.query(`select 1 from cambios_precio where id = $1 and empresa_id = $2`, [id, s.empresa])).rowCount) return null;
    const x = (await c.query(`select revertir_cambio_precios($1, $2) r`, [id, p.data.parcial])).rows[0].r;
    return { ...x, cambio: await detallePrecios(c, s.empresa, id) };
  });
  if (!r) return json({ error: "Ese cambio de precios no existe en tu droguería" }, 404);
  if (!r.revertido) {
    const n = r.conflictos.length;
    return json({ error: `${n} producto${n === 1 ? "" : "s"} cambi${n === 1 ? "ó" : "aron"} de precio después de este cambio: no se revirtió nada. Puedes revertir solo los demás.`, conflictos: r.conflictos }, 409);
  }
  return json(r);
});
