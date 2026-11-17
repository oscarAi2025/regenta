import { z } from "zod";
import { comoUsuario } from "@/lib/db";
import { conSesion, esUuid, json } from "@/lib/api";
import { puedeAnularEntrega } from "@/lib/entregas-datos";

/** Anular una entrega interna: solo la gerencia, con motivo. Las unidades vuelven a sus lotes; la entrega queda marcada. */
export const POST = conSesion(async (s, req, ctx) => {
  const { id } = await ctx.params;
  if (!puedeAnularEntrega(s.rol)) return json({ error: "Solo el dueño o el administrador anulan entregas" }, 403);
  if (!esUuid(id)) return json({ error: "Entrega no encontrada" }, 404);
  const p = z.object({ motivo: z.string().trim().min(4, "Escribe el motivo de la anulación").max(300, "El motivo va hasta 300 caracteres") }).safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Escribe el motivo de la anulación" }, 400);
  const r = await comoUsuario(s, async (c) => {
    if (!(await c.query(`select 1 from entregas where id = $1 and empresa_id = $2`, [id, s.empresa])).rowCount) return null;
    return (await c.query(`select anular_entrega($1, $2) r`, [id, p.data.motivo])).rows[0].r as { numero: number; unidades: number };
  });
  if (!r) return json({ error: "Entrega no encontrada" }, 404);
  return json({ ok: true, mensaje: `Entrega EI-${r.numero} anulada: ${r.unidades} unidad${r.unidades === 1 ? "" : "es"} volvieron al inventario`, ...r });
});
