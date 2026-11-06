import { z } from "zod";
import { comoUsuario } from "@/lib/db";
import { conSesion, json } from "@/lib/api";
import { normalizarCredito, permisoCartera } from "@/lib/cartera";

/** Anular un recibo de caja (con motivo): sus abonos se anulan y los saldos vuelven. Dueño o administrador. */
export const DELETE = conSesion(async (s, req, ctx) => {
  if (!permisoCartera.gestionar(s.rol)) return json({ error: "Solo el dueño o el administrador anulan recibos de caja" }, 403);
  const { id } = await ctx.params;
  if (!/^\d{1,18}$/.test(id)) return json({ error: "Recibo no encontrado" }, 404);
  const p = z.object({ motivo: z.string().trim().min(4, "Escribe el motivo de la anulación").max(200, "El motivo va hasta 200 caracteres") }).safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Escribe el motivo" }, 400);
  const r = await comoUsuario(s, async (c) => {
    if (!(await c.query(`select 1 from recibos_caja where id = $1 and empresa_id = $2`, [id, s.empresa])).rowCount) return null;
    return (await c.query(`select anular_recibo($1, $2) e`, [id, p.data.motivo])).rows[0].e;
  });
  if (!r) return json({ error: "Recibo no encontrado" }, 404);
  return json({ ok: true, credito: normalizarCredito(r), mensaje: "Recibo anulado: los saldos volvieron a las facturas" });
});
