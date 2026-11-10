import { z } from "zod";
import { comoUsuario } from "@/lib/db";
import { conSesion, esUuid, json } from "@/lib/api";
import { puede } from "@/lib/sesion";

const Cuerpo = z.object({
  lote: z.string().trim().min(1, "Escribe el código del lote").max(60, "El código del lote es muy largo")
    .refine((v) => !/[\p{C}]/u.test(v), "El código del lote tiene caracteres invisibles o saltos de línea"),
  vence: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Escribe la fecha de vencimiento"),
  motivo: z.string().trim().min(4, "Escribe por qué se corrige el lote").max(200, "El motivo es muy largo"),
});

/** Corregir el código o la fecha de vencimiento de un lote (con motivo, queda en la auditoría). No mueve existencias. */
export const PATCH = conSesion(async (s, req, ctx) => {
  if (!puede.moverInventario(s.rol)) return json({ error: "Solo el dueño, el administrador o la bodega corrigen lotes" }, 403);
  const { id } = await ctx.params;
  if (!esUuid(id)) return json({ error: "Ese lote no existe en tu droguería" }, 404);
  const p = Cuerpo.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Datos incompletos" }, 400);
  const r = await comoUsuario(s, async (c) => {
    if (!(await c.query(`select 1 from lotes where id = $1 and empresa_id = $2`, [id, s.empresa])).rowCount) return null;
    return (await c.query(`select corregir_lote($1, $2, $3::date, $4) r`, [id, p.data.lote, p.data.vence, p.data.motivo])).rows[0].r;
  });
  return r ? json({ lote: r }) : json({ error: "Ese lote no existe en tu droguería" }, 404);
});
