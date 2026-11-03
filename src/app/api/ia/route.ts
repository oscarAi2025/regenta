import { z } from "zod";
import { conSesion, ipCliente, json, limitador, limiteBD } from "@/lib/api";
import { sinRLS } from "@/lib/db";
import { iaActiva, responder } from "@/lib/ia/claude";

const Peticion = z.object({ mensajes: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(2000) })).min(1).max(20) });

// Límite sencillo por usuario: 20 preguntas por minuto (por instancia del servidor).
const uso = new Map<string, number[]>();
const permitido = (uid: string) => {
  const ahora = Date.now(), v = (uso.get(uid) ?? []).filter((t) => ahora - t < 60000);
  if (v.length >= 20) return false;
  v.push(ahora); uso.set(uid, v); return true;
};

// En la demo pública todos comparten usuario: límite por IP (8 por minuto, 40 al día) y un tope diario total de 400
// (estos dos en la base, para que valgan entre instancias).
const porIp = limitador(8, 60000);
const diario = limitador(400, 86400000);
const empresasDemo = new Map<string, boolean>();
const IA_DIARIA = 300;

export const POST = conSesion(async (s, req) => {
  if (!iaActiva()) return json({ error: "Regenta IA no está activada en este servidor." }, 503);
  const p = Peticion.safeParse(await req.json().catch(() => null));
  if (!p.success || p.data.mensajes.at(-1)!.role !== "user") return json({ error: "Escribe tu pregunta" }, 400);
  if (!permitido(s.uid)) return json({ error: "Muchas preguntas seguidas: espera un minuto." }, 429);
  if (!empresasDemo.has(s.empresa)) empresasDemo.set(s.empresa, !!(await sinRLS(async (c) => (await c.query(`select demo from empresas where id = $1`, [s.empresa])).rows[0]?.demo)));
  if (empresasDemo.get(s.empresa) && (!porIp(ipCliente(req)) || !diario("demo")
    || !(await limiteBD(`ia-demo:ip:${ipCliente(req)}`, 40, "1 day")) || !(await limiteBD("ia-demo:total", 400, "1 day")))) return json({ error: "La demo tiene un límite de preguntas a Regenta IA. Escríbenos por WhatsApp y te la mostramos completa." }, 429);
  // Cuentas de pago: tope diario por droguería (costo de la IA acotado; de sobra para el uso normal de un equipo).
  if (!empresasDemo.get(s.empresa) && !(await limiteBD(`ia:empresa:${s.empresa}`, IA_DIARIA, "1 day")))
    return json({ error: `Tu droguería llegó a las ${IA_DIARIA} preguntas de hoy a Regenta IA. Mañana sigues; si lo necesitas antes, escríbenos.` }, 429);
  // Respuesta en flujo, una línea JSON por evento: {t:"consulta"} mientras consulta datos, {t:"texto"} con cada pedazo de
  // la respuesta en cuanto la IA lo escribe, {t:"limpiar"} si descarta un texto provisional y al final {t:"fin"} con la
  // respuesta completa (o «error»). Una línea vacía cada 3 s mantiene viva la conexión (Netlify la corta a los ~30 s sin datos).
  const mensajes = p.data.mensajes;
  const cod = new TextEncoder();
  const flujo = new ReadableStream({
    async start(ctl) {
      const enviar = (o: unknown) => { try { ctl.enqueue(cod.encode(JSON.stringify(o) + "\n")); } catch {} };
      const latido = setInterval(() => { try { ctl.enqueue(cod.encode("\n")); } catch {} }, 3000);
      let fin: Record<string, unknown>;
      try { fin = await responder(s, mensajes, enviar); }
      catch (e) { console.error(e); fin = { error: "Regenta IA no pudo responder ahora. Intenta de nuevo." }; }
      clearInterval(latido);
      enviar({ t: "fin", ...fin });
      ctl.close();
    },
  });
  return new Response(flujo, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
});
