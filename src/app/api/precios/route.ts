import { comoUsuario } from "@/lib/db";
import { conSesion, demoProtegida, json, NO_EN_DEMO } from "@/lib/api";
import { puedePrecios } from "@/lib/precios";
import { CambioPrecios, historialPrecios } from "@/lib/precios-datos";

/** Historial de cambios masivos de precio (dueño o administrador). */
export const GET = conSesion(async (s) => {
  if (!puedePrecios.cambiar(s.rol)) return json({ error: "Solo el dueño o el administrador ven los cambios de precio" }, 403);
  return json({ cambios: await comoUsuario(s, (c) => historialPrecios(c, s.empresa)) });
});

/** Aplica un cambio masivo: exige la firma de la vista previa (si algo cambió desde entonces, la base lo rechaza). */
export const POST = conSesion(async (s, req) => {
  if (!puedePrecios.cambiar(s.rol)) return json({ error: "Solo el dueño o el administrador cambian precios" }, 403);
  const p = CambioPrecios.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Revisa los datos del cambio" }, 400);
  if (!p.data.firma) return json({ error: "Primero mira la vista previa del cambio" }, 400);
  if (await demoProtegida(s.empresa)) return json({ error: NO_EN_DEMO }, 403);
  const r = await comoUsuario(s, async (c) => (await c.query(`select aplicar_cambio_precios($1) r`, [{ ...p.data, empresa_id: s.empresa, simular: false }])).rows[0].r);
  return json({ cambio: r }, r.repetido ? 200 : 201);
});
