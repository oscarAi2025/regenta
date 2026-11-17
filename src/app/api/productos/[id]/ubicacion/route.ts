import { z } from "zod";
import { comoUsuario } from "@/lib/db";
import { conSesion, esUuid, json } from "@/lib/api";
import { puede } from "@/lib/sesion";
import { guardarUbicacion } from "@/lib/ubicacion";

/** Cambiar dónde está un producto en la estantería o la bodega (dueño, administrador o bodega). Vacío = sin ubicación. */
export const PUT = conSesion(async (s, req, ctx) => {
  const { id } = await ctx.params;
  if (!puede.moverInventario(s.rol)) return json({ error: "La ubicación la cambian el dueño, el administrador o la bodega" }, 403);
  if (!esUuid(id)) return json({ error: "Producto no encontrado" }, 404);
  const p = z.object({ ubicacion: z.string().trim().max(40, "La ubicación va hasta 40 caracteres, por ejemplo E3-N2") }).safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Escribe la ubicación" }, 400);
  const r = await comoUsuario(s, async (c) => {
    if (!(await c.query(`select 1 from productos where id = $1 and empresa_id = $2 and activo`, [id, s.empresa])).rowCount) return null;
    return { u: await guardarUbicacion(c, id, p.data.ubicacion) };
  });
  if (!r) return json({ error: "Producto no encontrado" }, 404);
  if (r.u === undefined) return json({ error: "La ubicación se está activando en tu Regenta: vuelve a intentarlo en unos minutos." }, 409);
  return json({ ok: true, ubicacion: r.u });
});
