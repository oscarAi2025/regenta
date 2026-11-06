import { z } from "zod";
import { comoUsuario, puestoDeTrabajo } from "@/lib/db";
import { conSesion, json } from "@/lib/api";
import { cajaElegida } from "@/lib/caja-elegida";
import { MEDIO_IDS, puedeCompras } from "@/lib/compras";
import { cuentasPorPagar } from "@/lib/compras-datos";

const Pago = z.object({
  proveedor_id: z.string().uuid("Elige el proveedor"),
  medio: z.enum(MEDIO_IDS, { errorMap: () => ({ message: "Elige el medio de pago" }) }),
  valor: z.number().positive("Escribe el valor del pago").max(10_000_000_000).refine((n) => Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, "Máximo dos decimales"),
  referencia: z.string().trim().max(60).nullish(),
  compras: z.array(z.string().uuid()).max(200).nullish(),
  desde_caja: z.boolean().default(true),
  idem_key: z.string().max(80).nullish(),
});
const Anular = z.object({ id: z.string().uuid(), motivo: z.string().trim().min(4, "Escribe el motivo de la anulación").max(300) });

/** Pago a un proveedor: se aplica a las facturas elegidas o de la que vence primero a la última. En efectivo desde la caja
 *  exige turno abierto y sale como egreso del turno. Devuelve las cuentas por pagar actualizadas del proveedor. */
export const POST = conSesion(async (s, req) => {
  if (!puedeCompras.dinero(s.rol)) return json({ error: "Solo el dueño o el administrador registran pagos a proveedores" }, 403);
  const p = Pago.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Datos del pago incompletos" }, 400);
  const caja = await cajaElegida();
  const r = await comoUsuario(s, async (c) => {
    const { caja_id } = await puestoDeTrabajo(c, s.empresa, caja);
    const k = (await c.query(`select registrar_pago_proveedor($1) r`, [{ ...p.data, empresa_id: s.empresa, caja_id }])).rows[0].r;
    return { ...k, cuentas: await cuentasPorPagar(c, s.empresa, p.data.proveedor_id) };
  });
  return json(r, r.repetido ? 200 : 201);
});

/** Anular un pago con motivo (si salió de la caja, el efectivo vuelve al turno abierto). */
export const DELETE = conSesion(async (s, req) => {
  if (!puedeCompras.dinero(s.rol)) return json({ error: "Solo el dueño o el administrador anulan pagos" }, 403);
  const p = Anular.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Escribe el motivo" }, 400);
  const r = await comoUsuario(s, async (c) => {
    const g = (await c.query(`select proveedor_id from pagos_proveedor where id = $1 and empresa_id = $2`, [p.data.id, s.empresa])).rows[0];
    if (!g) return null;
    await c.query(`select anular_pago_proveedor($1, $2)`, [p.data.id, p.data.motivo]);
    return { ok: true, cuentas: await cuentasPorPagar(c, s.empresa, g.proveedor_id) };
  });
  return r ? json(r) : json({ error: "Ese pago no existe en tu droguería" }, 404);
});
