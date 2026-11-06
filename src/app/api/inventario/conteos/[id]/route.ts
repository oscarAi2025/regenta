import { z } from "zod";
import { comoUsuario } from "@/lib/db";
import { conSesion, esUuid, json } from "@/lib/api";
import { puede } from "@/lib/sesion";
import { fechaReal } from "@/lib/validar";
import { lineasConteo } from "@/lib/conteos";

const Contar = z.object({
  modo: z.enum(["sumar", "fijar"]).default("sumar"),
  cantidad: z.number().int("La cantidad va en unidades enteras").min(0, "La cantidad no puede ser negativa").max(1_000_000, "Revisa la cantidad"),
  lote_id: z.string().uuid().nullish(),
  producto_id: z.string().uuid().nullish(),
  lote: z.string().trim().max(40, "El lote admite máximo 40 caracteres").nullish(),
  vence: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha de vencimiento no válida").refine(fechaReal, "Fecha de vencimiento no válida").nullish(),
}).refine((x) => !!x.lote_id || (!!x.producto_id && !!x.lote), { message: "Elige el lote que estás contando", path: ["lote_id"] })
  .refine((x) => x.modo === "fijar" || x.cantidad > 0, { message: "Cantidad no válida", path: ["cantidad"] });

/** Líneas del conteo con las existencias de este momento (para refrescar la pantalla desde otro celular). */
export const GET = conSesion(async (s, _req, ctx) => {
  if (!puede.moverInventario(s.rol)) return json({ error: "Solo el dueño, el administrador o la bodega hacen conteos de inventario" }, 403);
  const { id } = await ctx.params;
  if (!esUuid(id)) return json({ error: "No encontrado" }, 404);
  const r = await comoUsuario(s, async (c) => {
    const k = (await c.query(`select id, numero, estado from conteos where id = $1 and empresa_id = $2`, [id, s.empresa])).rows[0];
    return k ? { conteo: k, lineas: await lineasConteo(c, id, puede.verCostos(s.rol)) } : null;
  });
  return r ? json(r) : json({ error: "Ese conteo no existe en tu droguería" }, 404);
});

/** Registra lo contado de un lote: «sumar» (cada escaneo suma) o «fijar» (corrige la cantidad). */
export const PATCH = conSesion(async (s, req, ctx) => {
  if (!puede.moverInventario(s.rol)) return json({ error: "Solo el dueño, el administrador o la bodega hacen conteos de inventario" }, 403);
  const { id } = await ctx.params;
  if (!esUuid(id)) return json({ error: "No encontrado" }, 404);
  const p = Contar.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Datos no válidos" }, 400);
  const r = await comoUsuario(s, async (c) => {
    if (!(await c.query(`select 1 from conteos where id = $1 and empresa_id = $2`, [id, s.empresa])).rowCount) return null;
    return (await c.query(`select contar_conteo($1) r`, [{ ...p.data, conteo_id: id }])).rows[0].r;
  });
  return r ? json(r) : json({ error: "Ese conteo no existe en tu droguería" }, 404);
});
