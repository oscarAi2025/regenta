import { z } from "zod";
import { sinRLS } from "@/lib/db";
import { conSesion, json, limitador } from "@/lib/api";
import { registrarEvento, TIPOS_EVENTO, visitaActual } from "@/lib/visitas-demo";

/** Pasos del visitante dentro de la demo (pantallas, ventas, ofertas, clics a Contratar o WhatsApp). Solo en la demo. */
const Evento = z.object({ tipo: z.enum(TIPOS_EVENTO), detalle: z.string().max(240).nullish() });
const permitido = limitador(120, 60000); // por visita
const esDemo = new Map<string, boolean>();

export const POST = conSesion(async (s, req) => {
  const p = Evento.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ ok: false }, 400);
  const visita = await visitaActual();
  if (!visita || !permitido(visita)) return json({ ok: true });
  if (!esDemo.has(s.empresa)) esDemo.set(s.empresa, !!(await sinRLS(async (c) => (await c.query(`select demo from empresas where id = $1`, [s.empresa])).rows[0]?.demo)));
  if (!esDemo.get(s.empresa)) return json({ ok: true }); // en una droguería real no se registra nada
  await registrarEvento(visita, p.data.tipo, p.data.detalle);
  return json({ ok: true });
});
