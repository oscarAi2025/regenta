import { z } from "zod";
import { comoUsuario, sinRLS } from "@/lib/db";
import { conSesion, esUuid, json } from "@/lib/api";
import { procesarCola } from "@/lib/dian";

/** Anular una venta (solo dueño o administrador; la base de datos lo comprueba y devuelve las unidades al lote).
 *  Si el documento ya había salido a la DIAN, la base crea la nota crédito de anulación y aquí se envía de inmediato:
 *  la respuesta dice si la DIAN la aceptó. Si no había salido, se anula sin enviar nada. */
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
  await procesarCola(2, id).catch((e) => console.error("cola DIAN", e));
  const nota = await sinRLS(async (c) => (await c.query(`select prefijo || numero documento, estado, simulado, ultimo_error from documentos_dian
    where venta_id = $1 and empresa_id = $2 and tipo = 'nota_credito' and devolucion_id is null order by creado desc limit 1`, [id, s.empresa])).rows[0] ?? null);
  return json({ ok: true, nota });
});
