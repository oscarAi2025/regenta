import { NextResponse } from "next/server";
import { cronAutorizado } from "@/lib/api";
import { procesarCola } from "@/lib/dian";

/** Procesa la cola DIAN. Lo llama una tarea programada con REGENTA_CRON_KEY (nunca el navegador). */
export async function POST(req: Request) {
  if (!cronAutorizado(req)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  return NextResponse.json(await procesarCola(50));
}
