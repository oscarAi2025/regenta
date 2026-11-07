import { z } from "zod";
import { conSesion, ipCliente, json, limitador, limiteBD } from "@/lib/api";
import { sinRLS } from "@/lib/db";
import { iaActiva, mensajeError, responder } from "@/lib/ia/claude";

// Las respuestas de la IA pueden ser largas (tablas, pedidos): el historial las acepta y el servidor las recorta para el
// modelo. Antes una respuesta de más de 2.000 caracteres hacía fallar la pregunta siguiente («Escribe tu pregunta»).
const Peticion = z.object({ mensajes: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(60000) })).min(1).max(40) });
/** Historial limpio para el modelo: sin vacíos, turnos alternos (se juntan los seguidos del mismo rol), empieza por una
 *  pregunta, la última es la pregunta nueva (máx. 2.000 caracteres) y las respuestas anteriores se recortan a 8.000. */
function historial(ms: { role: "user" | "assistant"; content: string }[]) {
  const out: { role: "user" | "assistant"; content: string }[] = [];
  for (const m of ms.slice(-16)) {
    const c = m.content.trim(); if (!c) continue;
    const prev = out[out.length - 1];
    if (prev && prev.role === m.role) prev.content += "\n\n" + c; else out.push({ role: m.role, content: c });
  }
  while (out.length && out[0].role !== "user") out.shift();
  return out.map((m) => ({ role: m.role, content: m.role === "user" ? m.content.slice(0, 2000) : m.content.slice(0, 8000) }));
}

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
  const mensajes = p.success ? historial(p.data.mensajes) : [];
  if (!mensajes.length || mensajes.at(-1)!.role !== "user") return json({ error: "Escribe tu pregunta" }, 400);
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
  const cod = new TextEncoder();
  const flujo = new ReadableStream({
    async start(ctl) {
      const enviar = (o: unknown) => { try { ctl.enqueue(cod.encode(JSON.stringify(o) + "\n")); } catch {} };
      const latido = setInterval(() => { try { ctl.enqueue(cod.encode("\n")); } catch {} }, 3000);
      let fin: Record<string, unknown>;
      try { fin = await responder(s, mensajes, enviar); }
      catch (e) { console.error("Regenta IA:", (e as Error).message); fin = { error: mensajeError(e) }; }
      clearInterval(latido);
      enviar({ t: "fin", ...fin });
      ctl.close();
    },
  });
  return new Response(flujo, { headers: { "content-type": "application/x-ndjson; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
});
