import "server-only";
import type { Sesion } from "../sesion";
import { HERRAMIENTAS, ejecutar } from "./herramientas";

// Regenta IA: conversación con un modelo de Claude (Anthropic) que responde con los datos de la droguería
// usando solo las herramientas de lectura. La clave va en ANTHROPIC_API_KEY (variable de entorno del servidor).

export const iaActiva = () => Boolean(process.env.ANTHROPIC_API_KEY);
const URL_API = () => (process.env.REGENTA_IA_URL ?? "https://api.anthropic.com") + "/v1/messages";
const MODELO = () => process.env.REGENTA_IA_MODELO ?? "claude-sonnet-5-5";

export type Mensaje = { role: "user" | "assistant"; content: string };
type Bloque = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } | { type: "tool_result"; tool_use_id: string; content: string };
type Turno = { role: "user" | "assistant"; content: string | Bloque[] };

const sistema = (s: Sesion) => {
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
  return `Eres Regenta IA, el asistente de la droguería dentro del programa Regenta. Hoy es ${hoy} (Bogotá). Hablas con ${s.nombre.split(" (")[0]}, rol ${s.rol}.
Reglas:
- Responde en español de Colombia, corto y directo, con cifras en pesos ($12.500) y fechas legibles.
- Usa SIEMPRE las herramientas para cualquier dato de ventas, inventario, lotes, predicciones o alertas. Nunca inventes cifras ni productos; si una herramienta no trae el dato, dilo.
- Si te piden algo que cambia datos (vender, ajustar, borrar), explica dónde se hace en Regenta: tú solo consultas.
- No das indicaciones de dosis, diagnóstico ni tratamiento: eso es del criterio del profesional; tú ayudas con la gestión de la droguería.
- Cuando des una recomendación (qué pedir, qué rotar, qué revisar), di de qué dato sale.`;
};

async function llamar(cuerpo: unknown) {
  const r = await fetch(URL_API(), {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
    body: JSON.stringify(cuerpo), signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) throw new Error(`El servicio de IA respondió ${r.status}`);
  return r.json() as Promise<{ content: Bloque[]; stop_reason: string }>;
}

/** Responde la conversación. Devuelve el texto final y qué herramientas consultó (para mostrarlo en pantalla). */
export async function responder(s: Sesion, mensajes: Mensaje[]) {
  const turnos: Turno[] = mensajes.map((m) => ({ role: m.role, content: m.content }));
  const usadas: string[] = [];
  for (let paso = 0; paso < 6; paso++) {
    const r = await llamar({ model: MODELO(), max_tokens: 1200, system: sistema(s), tools: HERRAMIENTAS, messages: turnos });
    const llamadas = r.content.filter((b): b is Extract<Bloque, { type: "tool_use" }> => b.type === "tool_use");
    if (r.stop_reason !== "tool_use" || !llamadas.length) {
      const texto = r.content.filter((b): b is Extract<Bloque, { type: "text" }> => b.type === "text").map((b) => b.text).join("\n").trim();
      return { respuesta: texto || "No tengo una respuesta para eso.", herramientas: usadas };
    }
    turnos.push({ role: "assistant", content: r.content });
    const resultados: Bloque[] = [];
    for (const ll of llamadas) {
      usadas.push(ll.name);
      let datos: unknown;
      try { datos = await ejecutar(s, ll.name, ll.input ?? {}); } catch { datos = { error: "No se pudo consultar ese dato" }; }
      resultados.push({ type: "tool_result", tool_use_id: ll.id, content: JSON.stringify(datos).slice(0, 30000) });
    }
    turnos.push({ role: "user", content: resultados });
  }
  return { respuesta: "La pregunta necesitó demasiadas consultas. Hazla más concreta, por favor.", herramientas: usadas };
}
