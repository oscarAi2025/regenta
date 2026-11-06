import { z } from "zod";
import { comoUsuario } from "@/lib/db";
import { conSesion, esUuid, json } from "@/lib/api";
import { puedeCompras } from "@/lib/compras";
import { detalleCompra } from "@/lib/compras-datos";
import { fechaReal } from "@/lib/validar";

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha no válida").refine(fechaReal, "Fecha no válida");
const dosDecimales = (n: number) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6;

const Costos = z.object({
  total_papel: z.number().min(0).max(10_000_000_000).refine(dosDecimales, "Máximo dos decimales").nullish(),
  condicion: z.enum(["contado", "credito"]).nullish(),
  vence_pago: fecha.nullish(),
  lineas: z.array(z.object({
    linea_id: z.coerce.number().int().positive(),
    costo: z.number().min(0).max(100_000_000, "Revisa el costo").refine(dosDecimales, "Máximo dos decimales"),
    costo_por: z.enum(["caja", "unidad"]),
    descuento_pct: z.number().min(0).max(99.99).nullish(),
    iva_pct: z.union([z.literal(0), z.literal(5), z.literal(19)]).nullish(),
    precio_venta_nuevo: z.number().int("El precio de venta va en pesos, sin centavos").positive().max(100_000_000).nullish(),
    precio_unidad_nuevo: z.number().int("El precio de venta va en pesos, sin centavos").positive().max(100_000_000).nullish(),
  })).min(1, "Pon el costo de cada línea").max(500),
});
const Anular = z.object({ motivo: z.string().trim().min(4, "Escribe el motivo de la anulación").max(300) });

/** Detalle de una compra: líneas, pagos y devoluciones (la bodega, sin dinero). */
export const GET = conSesion(async (s, _req, ctx) => {
  if (!puedeCompras.ver(s.rol)) return json({ error: "Las compras las ven el dueño, el administrador o la bodega" }, 403);
  const { id } = await ctx.params;
  if (!esUuid(id)) return json({ error: "Compra no válida" }, 400);
  const d = await comoUsuario(s, (c) => detalleCompra(c, s.empresa, id, puedeCompras.dinero(s.rol)));
  return d ? json(d) : json({ error: "Esa compra no existe en tu droguería" }, 404);
});

/** Completar los costos de una compra que la bodega recibió sin costos: ahí nace la cuenta por pagar. */
export const PATCH = conSesion(async (s, req, ctx) => {
  if (!puedeCompras.dinero(s.rol)) return json({ error: "Solo el dueño o el administrador completan los costos" }, 403);
  const { id } = await ctx.params;
  if (!esUuid(id)) return json({ error: "Compra no válida" }, 400);
  const p = Costos.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Faltan los costos" }, 400);
  const r = await comoUsuario(s, async (c) => {
    if (!(await c.query(`select 1 from compras where id = $1 and empresa_id = $2`, [id, s.empresa])).rowCount) return null;
    const k = (await c.query(`select completar_costos_compra($1, $2) r`, [id, p.data])).rows[0].r;
    return { ...k, detalle: await detalleCompra(c, s.empresa, id, true) };
  });
  return r ? json(r) : json({ error: "Esa compra no existe en tu droguería" }, 404);
});

/** Anular una compra (con motivo): sin pagos vigentes ni devoluciones, y si el stock alcanza para revertirla. */
export const DELETE = conSesion(async (s, req, ctx) => {
  if (!puedeCompras.dinero(s.rol)) return json({ error: "Solo el dueño o el administrador anulan compras" }, 403);
  const { id } = await ctx.params;
  if (!esUuid(id)) return json({ error: "Compra no válida" }, 400);
  const p = Anular.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Escribe el motivo" }, 400);
  const r = await comoUsuario(s, async (c) => {
    if (!(await c.query(`select 1 from compras where id = $1 and empresa_id = $2`, [id, s.empresa])).rowCount) return null;
    await c.query(`select anular_compra($1, $2)`, [id, p.data.motivo]);
    return { ok: true, detalle: await detalleCompra(c, s.empresa, id, true) };
  });
  return r ? json(r) : json({ error: "Esa compra no existe en tu droguería" }, 404);
});
