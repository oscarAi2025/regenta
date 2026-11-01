import { z } from "zod";
import { conSesion, json } from "@/lib/api";
import { iaActiva, responder } from "@/lib/ia/claude";

const Peticion = z.object({ mensajes: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().trim().min(1).max(2000) })).min(1).max(20) });

// Límite sencillo por usuario: 20 preguntas por minuto (por instancia del servidor).
const uso = new Map<string, number[]>();
const permitido = (uid: string) => {
  const ahora = Date.now(), v = (uso.get(uid) ?? []).filter((t) => ahora - t < 60000);
  if (v.length >= 20) return false;
  v.push(ahora); uso.set(uid, v); return true;
};

export const POST = conSesion(async (s, req) => {
  if (!iaActiva()) return json({ error: "Regenta IA no está activada en este servidor." }, 503);
  const p = Peticion.safeParse(await req.json().catch(() => null));
  if (!p.success || p.data.mensajes.at(-1)!.role !== "user") return json({ error: "Escribe tu pregunta" }, 400);
  if (!permitido(s.uid)) return json({ error: "Muchas preguntas seguidas: espera un minuto." }, 429);
  try { return json(await responder(s, p.data.mensajes)); }
  catch (e) { console.error(e); return json({ error: "Regenta IA no pudo responder ahora. Intenta de nuevo." }, 502); }
});
