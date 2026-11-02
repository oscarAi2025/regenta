import { z } from "zod";
import { conSesion, ipCliente, json, limitador } from "@/lib/api";
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

// En la demo pública todos comparten usuario: límite por IP (8 por minuto) y un tope diario para todo el servidor.
const porIp = limitador(8, 60000);
const diario = limitador(400, 86400000);
const empresasDemo = new Map<string, boolean>();

export const POST = conSesion(async (s, req) => {
  if (!iaActiva()) return json({ error: "Regenta IA no está activada en este servidor." }, 503);
  const p = Peticion.safeParse(await req.json().catch(() => null));
  if (!p.success || p.data.mensajes.at(-1)!.role !== "user") return json({ error: "Escribe tu pregunta" }, 400);
  if (!permitido(s.uid)) return json({ error: "Muchas preguntas seguidas: espera un minuto." }, 429);
  if (!empresasDemo.has(s.empresa)) empresasDemo.set(s.empresa, !!(await sinRLS(async (c) => (await c.query(`select demo from empresas where id = $1`, [s.empresa])).rows[0]?.demo)));
  if (empresasDemo.get(s.empresa) && (!porIp(ipCliente(req)) || !diario("demo"))) return json({ error: "La demo tiene un límite de preguntas a Regenta IA. Escríbenos por WhatsApp y te la mostramos completa." }, 429);
  // Respuesta en flujo: mientras la IA consulta herramientas se envía un espacio cada 3 s para que la plataforma no
  // corte la conexión por inactividad (Netlify la corta a los ~30 s sin datos). Al final va el JSON (los espacios
  // iniciales son JSON válido). Un error se informa en el mismo JSON con «error».
  const mensajes = p.data.mensajes;
  const cod = new TextEncoder();
  const flujo = new ReadableStream({
    async start(ctl) {
      const latido = setInterval(() => { try { ctl.enqueue(cod.encode(" ")); } catch {} }, 3000);
      ctl.enqueue(cod.encode(" "));
      let fin: unknown;
      try { fin = await responder(s, mensajes); }
      catch (e) { console.error(e); fin = { error: "Regenta IA no pudo responder ahora. Intenta de nuevo." }; }
      clearInterval(latido);
      ctl.enqueue(cod.encode(JSON.stringify(fin)));
      ctl.close();
    },
  });
  return new Response(flujo, { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-accel-buffering": "no" } });
});
