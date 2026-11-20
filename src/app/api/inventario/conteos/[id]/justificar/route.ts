import { z } from "zod";
import { comoUsuario } from "@/lib/db";
import { conSesion, esUuid, json } from "@/lib/api";
import { puede } from "@/lib/sesion";
import { CAUSA_IDS, CAUSAS } from "@/lib/conteos";

const Justificar = z.object({
  linea_id: z.number().int().positive(),
  causa: z.enum(CAUSA_IDS, { errorMap: () => ({ message: "Elige la causa de la diferencia" }) }),
  detalle: z.string().trim().min(3, "Explica qué pasó (mínimo 3 letras)").max(400, "Máximo 400 caracteres"),
  documento: z.string().trim().max(80, "El documento admite máximo 80 caracteres").nullish(),
});

/** Explicar una diferencia del conteo (dueño, administrador o bodega). Queda guardada con quién y cuándo; no se edita:
 *  una nueva queda encima de la anterior. */
export const POST = conSesion(async (s, req, ctx) => {
  if (!puede.moverInventario(s.rol)) return json({ error: "Las diferencias las explica el dueño, el administrador o la bodega" }, 403);
  const { id } = await ctx.params;
  if (!esUuid(id)) return json({ error: "Conteo no válido" }, 400);
  const p = Justificar.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Datos no válidos" }, 400);
  const r = await comoUsuario(s, async (c) => {
    const l = (await c.query(`select cl.id from conteo_lineas cl where cl.id = $1 and cl.conteo_id = $2 and cl.empresa_id = $3`, [p.data.linea_id, id, s.empresa])).rows[0];
    if (!l) return null;
    await c.query(`select justificar_diferencia($1, $2, $3, $4, $5)`, [s.empresa, p.data.linea_id, p.data.causa, p.data.detalle, p.data.documento ?? null]);
    return true;
  });
  if (!r) return json({ error: "Esa línea no es de este conteo" }, 404);
  return json({ ok: true, mensaje: `Guardado: ${CAUSAS[p.data.causa]}` }, 201);
});
