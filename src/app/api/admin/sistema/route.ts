import { z } from "zod";
import { NextResponse } from "next/server";
import { conAdmin, evento } from "@/lib/admin";
import { procesarCola } from "@/lib/dian";
import { sincronizarInvima } from "@/lib/invima";

/** Acciones de sistema con un clic: procesar la cola DIAN o traer las alertas nuevas del INVIMA. */
export const POST = conAdmin(async (a, req) => {
  const p = z.object({ accion: z.enum(["dian", "invima"]) }).safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Acción no válida" }, { status: 400 });
  if (p.data.accion === "dian") {
    const r = await procesarCola(50);
    await evento(a, "procesar_dian", null, r);
    return NextResponse.json({ ok: true, mensaje: `Enviados ${r.enviados}: ${r.aceptados} aceptados, ${r.rechazados} rechazados, ${r.reintentos} para reintentar` });
  }
  try {
    const r = await sincronizarInvima();
    await evento(a, "sincronizar_invima", null, r);
    return NextResponse.json({ ok: true, mensaje: `Alertas nuevas: ${r.nuevas}${r.errores ? ` · errores: ${r.errores}` : ""}` });
  } catch (e) {
    return NextResponse.json({ error: `El INVIMA no respondió: ${(e as Error).message}` }, { status: 502 });
  }
});
