import { NextResponse } from "next/server";
import { sinRLS } from "@/lib/db";
import { esUuid } from "@/lib/api";
import { conAdmin, evento } from "@/lib/admin";
import { LogoCuerpo } from "@/lib/logo";

/** Soporte sube o quita el logo de la factura de un cliente (la demo no se toca desde aquí). */
export const PUT = conAdmin(async (a, req, ctx) => {
  const { id } = await ctx.params;
  if (!esUuid(id)) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const p = LogoCuerpo.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message ?? "Imagen no válida" }, { status: 400 });
  const ok = await sinRLS(async (c) => {
    const r = await c.query(`update empresas set logo = $2 where id = $1 and not demo`, [id, p.data.logo]);
    if (!r.rowCount) return false;
    await evento(a, p.data.logo ? "logo_cambiado" : "logo_quitado", id, { tamano: p.data.logo?.length ?? 0 }, c);
    return true;
  });
  if (!ok) return NextResponse.json({ error: "Cliente no encontrado (la demo no se modifica desde aquí)" }, { status: 404 });
  return NextResponse.json({ ok: true, mensaje: p.data.logo ? "Logo guardado" : "Logo quitado" });
});
