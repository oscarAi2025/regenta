import { z } from "zod";
import { comoUsuario } from "@/lib/db";
import { conSesion, esUuid, json } from "@/lib/api";
import { puede } from "@/lib/sesion";

const Cerrar = z.object({
  sin_contar_en_cero: z.boolean().default(false),
  observaciones: z.string().trim().max(500, "Las observaciones admiten máximo 500 caracteres").nullish(),
});

/** Cierra el conteo: las diferencias se vuelven un solo ajuste «Diferencia de conteo» en la misma transacción. */
export const POST = conSesion(async (s, req, ctx) => {
  if (!puede.moverInventario(s.rol)) return json({ error: "Solo el dueño, el administrador o la bodega hacen conteos de inventario" }, 403);
  const { id } = await ctx.params;
  if (!esUuid(id)) return json({ error: "No encontrado" }, 404);
  const p = Cerrar.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Datos no válidos" }, 400);
  const r = await comoUsuario(s, async (c) => {
    if (!(await c.query(`select 1 from conteos where id = $1 and empresa_id = $2`, [id, s.empresa])).rowCount) return null;
    return (await c.query(`select cerrar_conteo($1, $2, $3) r`, [id, p.data.sin_contar_en_cero, p.data.observaciones ?? null])).rows[0].r;
  });
  return r ? json(r) : json({ error: "Ese conteo no existe en tu droguería" }, 404);
});
