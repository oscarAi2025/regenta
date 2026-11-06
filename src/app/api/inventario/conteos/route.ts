import { z } from "zod";
import { comoUsuario, puestoDeTrabajo } from "@/lib/db";
import { conSesion, json } from "@/lib/api";
import { puede } from "@/lib/sesion";
import { cajaElegida } from "@/lib/caja-elegida";

const Iniciar = z.object({
  alcance: z.enum(["todo", "laboratorio", "categoria"], { errorMap: () => ({ message: "Elige qué vas a contar" }) }),
  filtro: z.string().trim().max(160).nullish(),
  observaciones: z.string().trim().max(500, "Las observaciones admiten máximo 500 caracteres").nullish(),
}).refine((c) => c.alcance === "todo" || (c.filtro ?? "").length > 0, { message: "Elige el laboratorio o la categoría que vas a contar", path: ["filtro"] });

/** Inicia un conteo físico en la sede de este equipo (dueño, administrador o bodega). */
export const POST = conSesion(async (s, req) => {
  if (!puede.moverInventario(s.rol)) return json({ error: "Solo el dueño, el administrador o la bodega hacen conteos de inventario" }, 403); // el permiso se mira antes que los datos
  const p = Iniciar.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Datos del conteo incompletos" }, 400);
  const r = await comoUsuario(s, async (c) => {
    const { sede_id } = await puestoDeTrabajo(c, s.empresa, await cajaElegida());
    return (await c.query(`select iniciar_conteo($1) r`, [{ ...p.data, empresa_id: s.empresa, sede_id }])).rows[0].r;
  });
  return json(r, 201);
});
