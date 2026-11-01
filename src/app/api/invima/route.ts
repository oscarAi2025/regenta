import { NextResponse } from "next/server";
import { sincronizarInvima } from "@/lib/invima";

/** Tarea programada (cada 6 horas): trae las alertas nuevas del INVIMA. Protegida con REGENTA_CRON_KEY. */
export async function POST(req: Request) {
  const clave = process.env.REGENTA_CRON_KEY;
  if (!clave || req.headers.get("authorization") !== `Bearer ${clave}`) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  try { return NextResponse.json({ nuevas: await sincronizarInvima() }); }
  catch (e) { return NextResponse.json({ error: (e as Error).message }, { status: 502 }); }
}
