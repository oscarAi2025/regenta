import { comoUsuario } from "@/lib/db";
import { conSesion, esUuid, json } from "@/lib/api";
import { detalleEntrega, puedeEntregar } from "@/lib/entregas-datos";

/** Una entrega interna con sus lotes y su fórmula (para el comprobante). */
export const GET = conSesion(async (s, _req, ctx) => {
  const { id } = await ctx.params;
  if (!puedeEntregar(s.rol)) return json({ error: "Las entregas las manejan la gerencia, la caja y la bodega" }, 403);
  if (!esUuid(id)) return json({ error: "Entrega no encontrada" }, 404);
  const d = await comoUsuario(s, (c) => detalleEntrega(c, s.empresa, id));
  return d ? json(d) : json({ error: "Entrega no encontrada" }, 404);
});
