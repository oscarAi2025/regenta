import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { procesarCola } from "@/lib/dian";
import { enviarPendientes, programarRecordatorios } from "@/lib/correo";
import { sincronizarInvima } from "@/lib/invima";
import { sinRLS } from "@/lib/db";
import { cancelarReemplazadas } from "@/lib/pagos-eventos";
import { aplicarBajadas, avisarCupoDocumentos, avisarNumeraciones, avisarRechazos, cobrarDocumentosExtra, revisarSuscripciones } from "@/lib/operacion";

export const dynamic = "force-dynamic";
export const maxDuration = 26;

function autorizado(req: Request) {
  const k = process.env.REGENTA_CRON_KEY;
  const h = req.headers.get("authorization") ?? "";
  if (!k || k.length < 24) return false;
  const a = Buffer.from(h), b = Buffer.from(`Bearer ${k}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Tarea programada (cada 15 minutos desde Netlify): recordatorios de pago, correos pendientes, cola DIAN y, cada 6 horas,
 *  alertas del INVIMA. Cada parte es independiente: si una falla, las demás siguen. Protegida con REGENTA_CRON_KEY. */
export async function POST(req: Request) {
  if (!autorizado(req)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  const r: Record<string, unknown> = {};
  const paso = async (k: string, f: () => Promise<unknown>) => { try { r[k] = await f(); } catch (e) { r[k] = { error: (e as Error).message }; } };
  await paso("recordatorios", programarRecordatorios);
  await paso("correos", () => enviarPendientes(80));
  await paso("dian", () => procesarCola(50));
  const minuto = new Date().getUTCMinutes();
  if (minuto < 15 || new URL(req.url).searchParams.get("operacion") === "1") { // una vez por hora (la tarea corre cada 15 minutos)
    await paso("suscripciones", revisarSuscripciones);
    await paso("stripe_reemplazadas", cancelarReemplazadas);
    await paso("bajadas", aplicarBajadas);
    await paso("documentos_extra", cobrarDocumentosExtra);
    await paso("cupo_documentos", avisarCupoDocumentos);
    await paso("numeraciones", avisarNumeraciones);
    await paso("rechazos", avisarRechazos);
    await paso("correos_avisos", () => enviarPendientes(80));
  }
  await paso("limpieza", () => sinRLS(async (c) => ({
    intentos: (await c.query(`delete from intentos_acceso where creado < now() - interval '1 day'`)).rowCount,
    invitaciones: (await c.query(`delete from invitaciones where expira < now() - interval '30 days'`)).rowCount,
  })));
  if (new URL(req.url).searchParams.get("invima") === "1" || (new Date().getUTCHours() % 6 === 0 && minuto < 15)) await paso("invima", sincronizarInvima);
  return NextResponse.json(r);
}
