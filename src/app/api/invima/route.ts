import { NextResponse } from "next/server";
import { cronAutorizado } from "@/lib/api";
import { sincronizarInvima } from "@/lib/invima";

/** Tarea programada (cada 6 horas): trae las alertas nuevas del INVIMA. Protegida con REGENTA_CRON_KEY. */
export async function POST(req: Request) {
  if (!cronAutorizado(req)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try { return NextResponse.json(await sincronizarInvima()); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 502 }); }
}
