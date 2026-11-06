import { z } from "zod";
import { comoUsuario } from "@/lib/db";
import { conSesion, json } from "@/lib/api";
import { puedeCompras } from "@/lib/compras";
import { detalleCompra } from "@/lib/compras-datos";

const Devolucion = z.object({
  compra_id: z.string().uuid(),
  motivo: z.string().trim().min(4, "Escribe el motivo de la devolución").max(200, "El motivo admite máximo 200 caracteres"),
  idem_key: z.string().max(80).nullish(),
  lineas: z.array(z.object({ compra_linea_id: z.coerce.number().int().positive(), unidades: z.number().int("Las unidades van enteras").positive().max(1_000_000) }))
    .min(1, "Elige qué vas a devolver").max(500),
});
const NotaCredito = z.object({
  id: z.string().uuid(),
  nc_proveedor: z.string().trim().min(1, "Escribe el número de la nota crédito del proveedor").max(40),
  valor: z.number().positive().max(10_000_000_000).refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, "Máximo dos decimales").nullish(),
});

/** Devolución al proveedor: las unidades salen del lote ya; el saldo baja cuando llega su nota crédito (PATCH). */
export const POST = conSesion(async (s, req) => {
  if (!puedeCompras.dinero(s.rol)) return json({ error: "Solo el dueño o el administrador registran devoluciones a proveedores" }, 403);
  const p = Devolucion.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Datos de la devolución incompletos" }, 400);
  const r = await comoUsuario(s, async (c) => {
    const k = (await c.query(`select registrar_devolucion_proveedor($1) r`, [{ ...p.data, empresa_id: s.empresa }])).rows[0].r;
    return { ...k, detalle: await detalleCompra(c, s.empresa, p.data.compra_id, true) };
  });
  return json(r, r.repetida ? 200 : 201);
});

/** Registrar la nota crédito del proveedor de una devolución (baja el saldo de la factura). */
export const PATCH = conSesion(async (s, req) => {
  if (!puedeCompras.dinero(s.rol)) return json({ error: "Solo el dueño o el administrador registran notas crédito" }, 403);
  const p = NotaCredito.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Datos de la nota crédito incompletos" }, 400);
  const r = await comoUsuario(s, async (c) => {
    const d = (await c.query(`select compra_id from devoluciones_proveedor where id = $1 and empresa_id = $2`, [p.data.id, s.empresa])).rows[0];
    if (!d) return null;
    const k = (await c.query(`select aplicar_nc_proveedor($1, $2, $3) r`, [p.data.id, p.data.nc_proveedor, p.data.valor ?? null])).rows[0].r;
    return { ...k, detalle: await detalleCompra(c, s.empresa, d.compra_id, true) };
  });
  return r ? json(r) : json({ error: "Esa devolución no existe en tu droguería" }, 404);
});
