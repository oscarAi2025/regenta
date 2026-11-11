import { z } from "zod";
import { sinRLS } from "@/lib/db";
import { conSesion, json } from "@/lib/api";
import { puede } from "@/lib/sesion";

const Costo = z.object({ lote_id: z.string().uuid(), costo_unidad: z.number().min(0).max(100_000_000, "Revisa el costo por unidad") });

/** Completar el costo de un lote que recibió la bodega sin costo (solo dueño y administrador). Un costo ya puesto no se
 *  cambia aquí: el costo de un lote es histórico (margen de lo ya vendido). */
export const POST = conSesion(async (s, req) => {
  if (!puede.verCostos(s.rol)) return json({ error: "Solo el dueño o el administrador ponen costos" }, 403);
  const p = Costo.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Datos no válidos" }, 400);
  const n = await sinRLS(async (c) => {
    const r = await c.query(`insert into lote_costos (lote_id, empresa_id, costo_unidad) select l.id, l.empresa_id, $3 from lotes l where l.id = $1 and l.empresa_id = $2
      on conflict (lote_id) do nothing`, [p.data.lote_id, s.empresa, p.data.costo_unidad]);
    if (r.rowCount) await c.query(`insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos) values ($1, $2, 'completar_costo', 'lotes', $3, $4)`,
      [s.empresa, s.uid, p.data.lote_id, JSON.stringify({ costo_unidad: p.data.costo_unidad })]);
    return r.rowCount;
  });
  return n ? json({ ok: true, mensaje: "Costo guardado" }) : json({ error: "Ese lote ya tiene costo o no es de tu droguería" }, 409);
});

const Correccion = Costo.extend({ motivo: z.string().trim().min(4, "Escribe por qué se corrige el costo").max(200) });

/** Corregir el costo de un lote que se registró mal (p. ej. el costo de la caja escrito como costo por unidad). Solo dueño y
 *  administrador, con motivo; queda en la auditoría con el antes y el después. El costo de un lote que vino de una compra se
 *  corrige en la compra (allí se recalcula con la factura del proveedor). */
export const PATCH = conSesion(async (s, req) => {
  if (!puede.verCostos(s.rol)) return json({ error: "Solo el dueño o el administrador corrigen costos" }, 403);
  const p = Correccion.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Datos no válidos" }, 400);
  const r = await sinRLS(async (c) => {
    const l = (await c.query(`select lc.costo_unidad::float antes, exists (select 1 from compra_lineas cl where cl.lote_id = l.id) compra,
        (select c2.numero from compra_lineas cl join compras c2 on c2.id = cl.compra_id where cl.lote_id = l.id order by cl.id desc limit 1) numero
      from lotes l join lote_costos lc on lc.lote_id = l.id where l.id = $1 and l.empresa_id = $2 for update of lc`, [p.data.lote_id, s.empresa])).rows[0] as
      { antes: number; compra: boolean; numero: number | null } | undefined;
    if (!l) return { error: "Ese lote no tiene costo o no es de tu droguería", status: 404 };
    if (l.compra) return { error: `Ese lote entró con una compra${l.numero ? ` (N.º ${l.numero})` : ""}: corrige el costo en la compra`, status: 409 };
    if (Math.abs(l.antes - p.data.costo_unidad) < 0.0001) return { error: "El lote ya tiene ese costo", status: 409 };
    await c.query(`update lote_costos set costo_unidad = $2, actualizado = now() where lote_id = $1`, [p.data.lote_id, p.data.costo_unidad]);
    await c.query(`insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos) values ($1, $2, 'corregir_costo', 'lotes', $3, $4)`,
      [s.empresa, s.uid, p.data.lote_id, JSON.stringify({ antes: l.antes, despues: p.data.costo_unidad, motivo: p.data.motivo })]);
    return { ok: true };
  });
  return "error" in r ? json({ error: r.error }, r.status) : json({ ok: true, mensaje: "Costo corregido: los reportes ya lo usan" });
});
