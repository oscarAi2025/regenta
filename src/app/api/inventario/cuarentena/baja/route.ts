import { z } from "zod";
import { comoUsuario } from "@/lib/db";
import { conSesion, json } from "@/lib/api";
import { puedePrecios } from "@/lib/precios";
import { llevaActa } from "@/lib/ajustes";
import { lotesSeparados } from "@/lib/cuarentena-datos";

const Baja = z.object({
  lote_id: z.string().uuid("Elige el lote"),
  motivo: z.enum(["vencido", "averia", "devolucion_proveedor", "otro"], { errorMap: () => ({ message: "Elige el motivo de la baja" }) }),
  detalle: z.string().trim().max(200).nullish(),
  unidades: z.number().int("La cantidad va en unidades enteras").positive("La cantidad debe ser mayor que cero").max(1_000_000).optional(),
  idem_key: z.string().max(80).nullish(),
}).refine((b) => b.motivo !== "otro" || (b.detalle ?? "").length >= 4, { message: "Con el motivo «Otro» escribe el detalle (qué pasó)", path: ["detalle"] });

/** Dar de baja un lote separado (todo o parte): es un ajuste de inventario por registrar_ajuste, con su número y su acta
 *  (vencido o avería). Solo lotes que están separados. */
export const POST = conSesion(async (s, req) => {
  if (!puedePrecios.cuarentena(s.rol)) return json({ error: "Solo el dueño, el administrador o la bodega dan de baja desde la cuarentena" }, 403);
  const p = Baja.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Datos incompletos" }, 400);
  const d = p.data;
  const r = await comoUsuario(s, async (c) => {
    const l = (await c.query(`select l.lote, l.bloqueado, l.bloqueo_tipo, l.bloqueo_motivo, s.unidades from lotes l join v_stock_lotes s on s.lote_id = l.id
      where l.id = $1 and l.empresa_id = $2`, [d.lote_id, s.empresa])).rows[0];
    if (!l) return null;
    if (!l.bloqueado) throw Object.assign(new Error(`El lote ${l.lote} no está separado: para darlo de baja usa «Ajustar o dar de baja»`), { code: "P0001" });
    const n = d.unidades ?? l.unidades;
    if (n <= 0 || n > l.unidades) throw Object.assign(new Error(`Del lote ${l.lote} quedan ${l.unidades} und`), { code: "P0001" });
    const origen = l.bloqueo_tipo === "invima" ? String(l.bloqueo_motivo ?? "alerta del INVIMA") : `cuarentena${l.bloqueo_motivo ? ` (${l.bloqueo_motivo})` : ""}`;
    const detalle = [d.detalle, `Desde ${origen}`].filter(Boolean).join(" · ").slice(0, 300);
    const x = (await c.query(`select registrar_ajuste($1) r`, [{ empresa_id: s.empresa, motivo: d.motivo, detalle, idem_key: d.idem_key ?? null, lineas: [{ lote_id: d.lote_id, unidades: -n }] }])).rows[0].r;
    return { ...x, unidades: n, acta: llevaActa(d.motivo), lotes: await lotesSeparados(c, s.empresa) };
  });
  return r ? json(r, 201) : json({ error: "Ese lote no existe en tu droguería" }, 404);
});
