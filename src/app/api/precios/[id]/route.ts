import { comoUsuario } from "@/lib/db";
import { conSesion, esUuid, json } from "@/lib/api";
import { puedePrecios } from "@/lib/precios";
import { detallePrecios } from "@/lib/precios-datos";

/** Detalle de un cambio masivo: antes, después y precio de hoy de cada producto (dueño o administrador). */
export const GET = conSesion(async (s, _req, ctx) => {
  if (!puedePrecios.cambiar(s.rol)) return json({ error: "Solo el dueño o el administrador ven los cambios de precio" }, 403);
  const { id } = await ctx.params;
  if (!esUuid(id)) return json({ error: "No encontrado" }, 404);
  const d = await comoUsuario(s, (c) => detallePrecios(c, s.empresa, id));
  return d ? json({ cambio: d }) : json({ error: "Ese cambio de precios no existe en tu droguería" }, 404);
});
