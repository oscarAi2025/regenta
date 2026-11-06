import { z } from "zod";
import { comoUsuario } from "@/lib/db";
import { conSesion, esUuid, json } from "@/lib/api";
import { CODIGO_VALIDO, normalizarCodigo, puedePrecios } from "@/lib/precios";
import type { Tx } from "@/lib/db";

// Códigos de barras alternos de un producto (dueño, administrador o bodega). La base valida que el código sea único en la
// droguería y que no sea el código principal de otro producto (036).
const lista = async (c: Tx, empresa: string, id: string) =>
  (await c.query(`select pc.id::int, pc.codigo, to_char(pc.creado at time zone 'America/Bogota', 'DD/MM/YYYY') creado
    from producto_codigos pc join productos p on p.id = pc.producto_id where pc.producto_id = $1 and p.empresa_id = $2 order by pc.creado, pc.id`, [id, empresa])).rows;
const existe = async (c: Tx, empresa: string, id: string) => !!(await c.query(`select 1 from productos where id = $1 and empresa_id = $2`, [id, empresa])).rowCount;

/** Un 23505 de la base trae el mensaje claro («El código X ya está asignado a …»): se devuelve como 409. */
async function conConflicto(fn: () => Promise<Response>) {
  try { return await fn(); } catch (e) {
    const err = e as { code?: string; message?: string };
    if (err?.code === "23505") return json({ error: /^(El código|Este producto)/.test(err.message ?? "") ? err.message : "Ese código ya está asignado a otro producto" }, 409);
    throw e;
  }
}

export const GET = conSesion(async (s, _req, ctx) => {
  if (!puedePrecios.codigos(s.rol)) return json({ error: "Solo el dueño, el administrador o la bodega ven los códigos de un producto" }, 403);
  const { id } = await ctx.params;
  if (!esUuid(id)) return json({ error: "No encontrado" }, 404);
  const r = await comoUsuario(s, async (c) => (await existe(c, s.empresa, id)) ? await lista(c, s.empresa, id) : null);
  return r ? json({ codigos: r }) : json({ error: "Ese producto no existe en tu droguería" }, 404);
});

const Nuevo = z.object({ codigo: z.string().transform(normalizarCodigo).refine((c) => CODIGO_VALIDO.test(c), "El código debe tener entre 3 y 40 letras o números (sin espacios)") });

export const POST = conSesion(async (s, req, ctx) => {
  if (!puedePrecios.codigos(s.rol)) return json({ error: "Solo el dueño, el administrador o la bodega agregan códigos" }, 403);
  const { id } = await ctx.params;
  if (!esUuid(id)) return json({ error: "No encontrado" }, 404);
  const p = Nuevo.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Escribe el código" }, 400);
  return conConflicto(async () => {
    const r = await comoUsuario(s, async (c) => {
      if (!(await existe(c, s.empresa, id))) return null;
      await c.query(`select agregar_codigo_producto($1, $2)`, [id, p.data.codigo]);
      return lista(c, s.empresa, id);
    });
    return r ? json({ codigos: r }, 201) : json({ error: "Ese producto no existe en tu droguería" }, 404);
  });
});

export const DELETE = conSesion(async (s, req, ctx) => {
  if (!puedePrecios.codigos(s.rol)) return json({ error: "Solo el dueño, el administrador o la bodega quitan códigos" }, 403);
  const { id } = await ctx.params;
  const p = z.object({ codigo_id: z.coerce.number().int().positive() }).safeParse(await req.json().catch(() => null));
  if (!esUuid(id) || !p.success) return json({ error: "No encontrado" }, 404);
  const r = await comoUsuario(s, async (c) => {
    if (!(await c.query(`select 1 from producto_codigos where id = $1 and producto_id = $2 and empresa_id = $3`, [p.data.codigo_id, id, s.empresa])).rowCount) return null;
    await c.query(`select quitar_codigo_producto($1)`, [p.data.codigo_id]);
    return lista(c, s.empresa, id);
  });
  return r ? json({ codigos: r }) : json({ error: "Ese código no existe en este producto" }, 404);
});
