import { z } from "zod";
import { comoUsuario } from "@/lib/db";
import { conSesion, json } from "@/lib/api";
import { puede } from "@/lib/sesion";
import { MOTIVO_IDS, llevaActa } from "@/lib/ajustes";

const Ajuste = z.object({
  motivo: z.enum(MOTIVO_IDS, { errorMap: () => ({ message: "Elige el motivo del ajuste" }) }),
  detalle: z.string().trim().max(300, "El detalle admite máximo 300 caracteres").nullish(),
  idem_key: z.string().max(80).nullish(),
  lineas: z.array(z.object({
    lote_id: z.string().uuid("Elige el lote"),
    unidades: z.number().int("La cantidad va en unidades enteras").min(-1_000_000).max(1_000_000).refine((n) => n !== 0, "La cantidad no puede ser cero"),
  })).min(1, "Agrega al menos un producto con su lote y cantidad").max(500, "Máximo 500 lotes por ajuste"),
}).refine((a) => a.motivo !== "otro" || (a.detalle ?? "").length >= 4, { message: "Con el motivo «Otro» escribe el detalle (qué pasó)", path: ["detalle"] })
  .refine((a) => a.motivo === "conteo" || a.lineas.every((l) => l.unidades < 0), { message: "Una baja resta unidades: para sumar usa el motivo «Diferencia de conteo»", path: ["lineas"] });

/** Ajuste o baja de inventario con motivo (dueño, administrador o bodega). La base de datos valida rol, lotes, negativos
 *  y registra los movimientos, la auditoría y el número del acta. */
export const POST = conSesion(async (s, req) => {
  if (!puede.moverInventario(s.rol)) return json({ error: "Solo el dueño, el administrador o la bodega ajustan el inventario" }, 403); // el permiso se mira antes que los datos
  const p = Ajuste.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Datos del ajuste incompletos" }, 400);
  const r = await comoUsuario(s, async (c) => (await c.query(`select registrar_ajuste($1) r`, [{ ...p.data, empresa_id: s.empresa }])).rows[0].r);
  return json({ ...r, acta: llevaActa(p.data.motivo) }, 201);
});
