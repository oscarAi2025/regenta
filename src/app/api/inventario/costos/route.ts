import { z } from "zod";
import { sinRLS } from "@/lib/db";
import { conSesion, json } from "@/lib/api";
import { puede } from "@/lib/sesion";

const Costo = z.object({ lote_id: z.string().uuid(), costo_unidad: z.number().min(0).max(100_000_000, "Revisa el costo por unidad") });

/** Completar el costo de un lote que recibió la bodega sin costo (solo dueño y administrador). Un costo ya puesto no se
 *  cambia aquí: el costo de un lote es histórico (margen de lo ya vendido). */
export const POST = conSesion(async (s, req) => {
  if (!puede.verCostos(s.rol)) return json({ error: "Solo el dueño o el administrador ponen costos" }, 403);
  const p = Costo.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Datos no válidos" }, 400);
  const n = await sinRLS(async (c) => {
    const r = await c.query(`insert into lote_costos (lote_id, empresa_id, costo_unidad) select l.id, l.empresa_id, $3 from lotes l where l.id = $1 and l.empresa_id = $2
      on conflict (lote_id) do nothing`, [p.data.lote_id, s.empresa, p.data.costo_unidad]);
    if (r.rowCount) await c.query(`insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos) values ($1, $2, 'completar_costo', 'lotes', $3, $4)`,
      [s.empresa, s.uid, p.data.lote_id, JSON.stringify({ costo_unidad: p.data.costo_unidad })]);
    return r.rowCount;
  });
  return n ? json({ ok: true, mensaje: "Costo guardado" }) : json({ error: "Ese lote ya tiene costo o no es de tu droguería" }, 409);
});
