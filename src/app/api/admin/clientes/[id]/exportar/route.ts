import { NextResponse } from "next/server";
import { esUuid } from "@/lib/api";
import { conAdmin, evento } from "@/lib/admin";
import { exportarEmpresa } from "@/lib/exportar";

export const dynamic = "force-dynamic";
export const maxDuration = 26;

/** La consola descarga la copia de los datos de un cliente (también suspendido): para entregársela al terminar el servicio. */
export const GET = conAdmin(async (a, _req, ctx) => {
  const { id } = await ctx.params;
  if (!esUuid(id)) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const r = await exportarEmpresa(id);
  if (!r) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
  await evento(a, "exportar_datos", id);
  return new Response(new Uint8Array(r.datos), { headers: { "content-type": "application/zip", "content-disposition": `attachment; filename="${r.nombre}"`, "cache-control": "no-store" } });
});
