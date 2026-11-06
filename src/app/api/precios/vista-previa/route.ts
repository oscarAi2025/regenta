import { comoUsuario } from "@/lib/db";
import { conSesion, json } from "@/lib/api";
import { puedePrecios } from "@/lib/precios";
import { CambioPrecios } from "@/lib/precios-datos";

/** Vista previa de un cambio masivo de precios: la misma función de la base que lo aplica, sin escribir nada. Dueño o
 *  administrador (trae costos y márgenes). */
export const POST = conSesion(async (s, req) => {
  if (!puedePrecios.cambiar(s.rol)) return json({ error: "Solo el dueño o el administrador cambian precios" }, 403); // el permiso se mira antes que los datos
  const p = CambioPrecios.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Revisa los datos del cambio" }, 400);
  const { firma: _f, idem_key: _i, ...d } = p.data;
  const r = await comoUsuario(s, async (c) => (await c.query(`select aplicar_cambio_precios($1) r`, [{ ...d, empresa_id: s.empresa, simular: true }])).rows[0].r);
  return json(r);
});
