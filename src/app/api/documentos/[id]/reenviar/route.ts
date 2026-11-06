import { sinRLS } from "@/lib/db";
import { conSesion, esUuid, json } from "@/lib/api";
import { procesarCola } from "@/lib/dian";
import { puedeDian } from "@/lib/dian/soporte";

/** Reenvía a la DIAN un documento rechazado que no sale de una venta (documento soporte, nota de ajuste, nota débito).
 *  Se arma de nuevo con los datos actuales. Solo dueño o administrador. */
export const POST = conSesion(async (s, _req, ctx) => {
  if (!puedeDian.emitir(s.rol)) return json({ error: "Solo el dueño o el administrador reenvían documentos a la DIAN" }, 403);
  const { id } = await ctx.params;
  if (!esUuid(id)) return json({ error: "Documento no válido" }, 400);
  const n = await sinRLS(async (c) => {
    if (!(await c.query(`select 1 from documentos_dian where id = $1 and empresa_id = $2`, [id, s.empresa])).rowCount) return null;
    const r = await c.query(`update documentos_dian set estado = 'pendiente', intentos = 0, proximo_intento = now(), reenviado = now(), ultimo_error = null
      where id = $1 and empresa_id = $2 and estado = 'rechazado' and venta_id is null returning id`, [id, s.empresa]);
    if (r.rowCount) await c.query(`insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos) values ($1, $2, 'reenviar_dian', 'documentos_dian', $3, '{}')`, [s.empresa, s.uid, id]);
    return r.rowCount ?? 0;
  });
  if (n === null) return json({ error: "Ese documento no existe en tu droguería" }, 404);
  if (!n) return json({ error: "Este documento no está rechazado (o se reenvía desde su venta)" }, 409);
  await procesarCola(2, undefined, id).catch((e) => console.error("cola DIAN", e));
  return json({ reenviados: n });
});
