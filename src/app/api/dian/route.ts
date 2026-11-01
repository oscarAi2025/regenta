import { NextResponse } from "next/server";
import { procesarCola } from "@/lib/dian";

/** Procesa la cola DIAN. Lo llama una tarea programada con REGENTA_CRON_KEY (nunca el navegador). */
export async function POST(req: Request) {
  const k = process.env.REGENTA_CRON_KEY;
  if (!k || req.headers.get("authorization") !== `Bearer ${k}`) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  return NextResponse.json(await procesarCola(50));
}
