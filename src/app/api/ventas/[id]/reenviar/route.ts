import { sinRLS } from "@/lib/db";
import { conSesion, esUuid, json } from "@/lib/api";
import { puede } from "@/lib/sesion";
import { procesarCola } from "@/lib/dian";

/** Reenvía a la DIAN los documentos rechazados de una venta (después de corregir el cliente o la configuración).
 *  Solo dueño o administrador. El documento se arma de nuevo con los datos actuales. */
export const POST = conSesion(async (s, _req, ctx) => {
  const { id } = await ctx.params;
  if (!esUuid(id)) return json({ error: "No encontrado" }, 404);
  if (!puede.anular(s.rol)) return json({ error: "Solo el dueño o el administrador reenvían documentos a la DIAN" }, 403);
  const n = await sinRLS(async (c) => {
    const r = await c.query(`update documentos_dian set estado = 'pendiente', intentos = 0, proximo_intento = now(), reenviado = now(), ultimo_error = null
      where venta_id = $1 and empresa_id = $2 and estado = 'rechazado' returning id`, [id, s.empresa]);
    if (r.rowCount) await c.query(`insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos) values ($1, $2, 'reenviar_dian', 'ventas', $3, $4)`,
      [s.empresa, s.uid, id, JSON.stringify({ documentos: r.rows.map((x) => x.id) })]);
    return r.rowCount ?? 0;
  });
  if (!n) return json({ error: "Esta venta no tiene documentos rechazados" }, 409);
  await procesarCola(3, id).catch((e) => console.error("cola DIAN", e));
  return json({ reenviados: n });
});
