import { z } from "zod";
import { NextResponse } from "next/server";
import { sinRLS } from "@/lib/db";
import { conAdmin, evento } from "@/lib/admin";

const Cambio = z.object({ id: z.string().uuid(), estado: z.enum(["pagado", "condonado"]) });

/** Documentos adicionales: marcar el cargo como pagado (llegó el dinero) o condonarlo (cortesía). */
export const PATCH = conAdmin(async (a, req) => {
  const p = Cambio.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Datos no válidos" }, { status: 400 });
  const n = await sinRLS(async (c) => {
    const r = await c.query(`update cargos_documentos set estado = $2, actualizado = now() where id = $1 and estado = 'pendiente' returning empresa_id`, [p.data.id, p.data.estado]);
    if (r.rowCount) await evento(a, `cargo_${p.data.estado}`, r.rows[0].empresa_id, { cargo: p.data.id }, c);
    return r.rowCount;
  });
  return n ? NextResponse.json({ ok: true, mensaje: p.data.estado === "pagado" ? "Cargo pagado" : "Cargo condonado" }) : NextResponse.json({ error: "Ese cargo ya no está pendiente" }, { status: 409 });
});
