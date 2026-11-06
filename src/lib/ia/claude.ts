import "server-only";
import type { Sesion } from "../sesion";
import { ejecutar, herramientasPara } from "./herramientas";
import { CONOCIMIENTO_REGENTA } from "./conocimiento";
import { comoUsuario } from "../db";

// Regenta IA: conversación con un modelo de Claude (Anthropic) que responde con los datos de la droguería
// usando solo las herramientas de lectura. La clave va en ANTHROPIC_API_KEY (variable de entorno del servidor).

export const iaActiva = () => Boolean(process.env.ANTHROPIC_API_KEY);
const URL_API = () => (process.env.REGENTA_IA_URL ?? "https://api.anthropic.com") + "/v1/messages";
const MODELO = () => process.env.REGENTA_IA_MODELO ?? "claude-sonnet-5-5";

/** Error de la API de Anthropic con su código y su mensaje (va al registro del servidor y a la prueba de la consola). */
export class ErrorIA extends Error {
  constructor(public status: number, detalleApi: string) { super(`Anthropic respondió ${status}: ${detalleApi}`); }
}
async function detalle(r: Response) {
  const t = await r.text().catch(() => "");
  try { const j = JSON.parse(t); return j?.error?.message ?? j?.message ?? t.slice(0, 300); } catch { return t.slice(0, 300) || "sin detalle"; }
}

/** Mensaje para quien usa Regenta según la causa (sin datos internos). */
export function mensajeError(e: unknown) {
  const st = e instanceof ErrorIA ? e.status : 0;
  if (st === 401 || st === 403) return "Regenta IA está en mantenimiento en este momento. Puedes seguir usando Regenta con normalidad; vuelve a intentarlo más tarde.";
  if (st === 400 && /credit|balance|billing/i.test((e as Error).message)) return "Regenta IA está en mantenimiento en este momento. Puedes seguir usando Regenta con normalidad; vuelve a intentarlo más tarde.";
  if (st === 429 || st === 529 || st === 503) return "Regenta IA está muy solicitada en este momento. Intenta de nuevo en un minuto.";
  if ((e as Error)?.name === "TimeoutError") return "Regenta IA tardó demasiado en responder. Intenta de nuevo o haz la pregunta más concreta.";
  return "Regenta IA no pudo responder ahora. Intenta de nuevo.";
}

/** Prueba mínima del servicio (consola → Sistema): modelo configurado, respuesta y tiempo. No usa datos de ninguna droguería. */
export async function probarIA() {
  if (!iaActiva()) return { ok: false, mensaje: "Falta ANTHROPIC_API_KEY en el servidor" };
  const t0 = Date.now();
  try {
    const r = await fetch(URL_API(), {
      method: "POST",
      headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
      body: JSON.stringify({ model: MODELO(), max_tokens: 16, messages: [{ role: "user", content: "Responde solo: OK" }] }), signal: AbortSignal.timeout(30000),
    });
    if (!r.ok) return { ok: false, mensaje: `Regenta IA falla con el modelo ${MODELO()}: Anthropic respondió ${r.status} · ${await detalle(r)}` };
    const j = (await r.json()) as { model?: string; content?: { type: string; text?: string }[] };
    return { ok: true, mensaje: `Regenta IA responde (${j.model ?? MODELO()}, ${Date.now() - t0} ms): «${(j.content?.find((b) => b.type === "text")?.text ?? "").trim()}»` };
  } catch (e) {
    return { ok: false, mensaje: `Regenta IA no respondió (${MODELO()}): ${(e as Error).message}` };
  }
}

export type Mensaje = { role: "user" | "assistant"; content: string };
type Bloque = { type: "text"; text: string } | { type: "tool_use"; id: string; name: string; input: Record<string, unknown> } | { type: "tool_result"; tool_use_id: string; content: string };
type Turno = { role: "user" | "assistant"; content: string | Bloque[] };

// Instrucciones fijas (iguales para todos: van primero y en caché) y, aparte, quién pregunta, la fecha y si es la demo.
const BASE = `Eres Regenta IA: el asesor experto de la droguería dentro del programa Regenta y, a la vez, el mejor conocedor y defensor de Regenta como producto.

Tu nivel es el de un químico farmacéutico y regente de farmacia colombiano con años de mostrador, gerencia de droguería y venta farmacéutica. Dominas:
- Regencia y normativa colombiana: Decreto 780 de 2016 (título de servicio farmacéutico), Resolución 1403 de 2007 (manual de procesos: recepción técnica, almacenamiento, dispensación, FEFO, devoluciones, cadena de frío, temperatura y humedad), medicamentos de control especial y Fondo Nacional de Estupefacientes (Resolución 1478 de 2006), farmacovigilancia y reporte al INVIMA, visitas de la secretaría de salud, facturación electrónica DIAN (POS electrónico, Resolución 165 de 2023).
- Farmacología y farmacia: indicaciones, mecanismo, contraindicaciones, interacciones, efectos adversos, embarazo y lactancia, equivalentes genéricos y comerciales por principio activo, formas farmacéuticas, conservación.
- Medicina general aplicada al mostrador: orientar síntomas leves, reconocer signos de alarma y remitir.
- Venta consultiva y gestión: venta cruzada útil (p. ej. sales de rehidratación con antidiarreico, protector gástrico cuando aplica), rotación, márgenes, pedido, exhibición, cartera y servicio al cliente.

Cómo trabajas:
- Español de Colombia, directo y profesional. Respuestas cortas por defecto; si te piden detalle, profundiza con estructura (viñetas o pasos).
- Datos de la droguería (ventas, inventario, lotes, existencias, predicciones, alertas): usa SIEMPRE las herramientas; nunca inventes cifras ni productos. Cuando recomiendes un producto o un equivalente, búscalo con buscar_producto y di si hay existencias y a qué precio.
- Conocimiento farmacéutico y normativo: responde con criterio técnico y di la base (ficha técnica, norma). Si no estás seguro de un dato puntual (una cifra, un artículo), dilo y sugiere verificarlo en la fuente oficial (INVIMA, normograma).
- Dispensación: los medicamentos de venta con fórmula médica solo se dispensan con prescripción; los de control especial además con su recetario oficial y registro. Para medicamentos de venta libre puedes orientar con la posología del registro sanitario o el inserto para adultos, siempre indicando leer el inserto. En niños, embarazo, lactancia, adultos mayores polimedicados o enfermedades crónicas, recomienda consultar al médico antes de dar dosis.
- Signos de alarma (dolor de pecho, dificultad para respirar, fiebre alta persistente o en menores de 3 meses, sangrado, deshidratación, síntomas neurológicos, reacción alérgica grave): indica remitir de inmediato a urgencias.
- No diagnosticas ni reemplazas al médico: orientas, dispensas con criterio y remites cuando corresponde.
- Si te piden algo que cambia datos (vender, ajustar, borrar), explica dónde se hace en Regenta: tú solo consultas.
- Cada recomendación de gestión (qué pedir, qué rotar, qué revisar) dice de qué dato sale.
- Dudas sobre el programa (cómo se hace algo, dónde está, qué incluye, cuánto cuesta): responde con la guía de Regenta de abajo.

${CONOCIMIENTO_REGENTA}`;

const contexto = (s: Sesion, demo: boolean) => {
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
  return `Hoy es ${hoy} (Bogotá). Hablas con ${s.nombre.split(" (")[0]}, rol ${s.rol}.` + (demo
    ? `\nEstás en la DEMO de Regenta: quien escribe está evaluando el programa con datos de ejemplo (no son de su droguería). Además de responder, ayúdale a descubrir lo que Regenta hace por su droguería, invítalo a probar la función en la demo y, cuando muestre interés, recomiéndale el plan que le sirve y cómo contratarlo.`
    : "");
};

export type Evento = { t: "texto"; d: string } | { t: "limpiar" } | { t: "consulta"; h: string };
type Respuesta = { content: Bloque[]; stop_reason: string };

/** Lee la respuesta en flujo (SSE) de la API de Anthropic: avisa cada pedazo de texto en cuanto llega y arma los bloques
 *  completos (texto y llamadas a herramientas) para el siguiente paso. Si el servidor responde JSON (sin flujo), lo usa tal cual. */
async function llamar(cuerpo: Record<string, unknown>, emitir: (e: Evento) => void): Promise<Respuesta> {
  const r = await fetch(URL_API(), {
    method: "POST",
    headers: { "content-type": "application/json", "x-api-key": process.env.ANTHROPIC_API_KEY!, "anthropic-version": "2023-06-01" },
    body: JSON.stringify({ ...cuerpo, stream: true }), signal: AbortSignal.timeout(60000),
  });
  if (!r.ok) throw new ErrorIA(r.status, await detalle(r));
  if (!(r.headers.get("content-type") ?? "").includes("text/event-stream")) {
    const j = (await r.json()) as Respuesta;
    for (const b of j.content) if (b.type === "text" && b.text) emitir({ t: "texto", d: b.text });
    return j;
  }
  const bloques: (Bloque & { json?: string })[] = [];
  let stop = "end_turn", resto = "";
  const dec = new TextDecoder();
  const leerEvento = (crudo: string) => {
    const data = crudo.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim()).join("");
    if (!data) return;
    const e = JSON.parse(data);
    if (e.type === "content_block_start") {
      const b = e.content_block;
      bloques[e.index] = b.type === "tool_use" ? { type: "tool_use", id: b.id, name: b.name, input: {}, json: "" } : { type: "text", text: "" };
      if (b.type === "tool_use") emitir({ t: "consulta", h: b.name });
    } else if (e.type === "content_block_delta") {
      const b = bloques[e.index];
      if (e.delta.type === "text_delta" && b?.type === "text") { b.text += e.delta.text; emitir({ t: "texto", d: e.delta.text }); }
      else if (e.delta.type === "input_json_delta" && b?.type === "tool_use") b.json += e.delta.partial_json;
    } else if (e.type === "message_delta" && e.delta?.stop_reason) stop = e.delta.stop_reason;
    else if (e.type === "error") throw new Error(e.error?.message ?? "Error del servicio de IA");
  };
  for await (const trozo of r.body as unknown as AsyncIterable<Uint8Array>) {
    resto += dec.decode(trozo, { stream: true });
    let i;
    while ((i = resto.indexOf("\n\n")) >= 0) { leerEvento(resto.slice(0, i)); resto = resto.slice(i + 2); }
  }
  if (resto.trim()) leerEvento(resto);
  // Un bloque de texto vacío (la IA abre texto y pasa directo a consultar) no se puede devolver a la API: «text content
  // blocks must be non-empty» (medido en producción 06/11 con «¿cuánto vale mi inventario?»).
  const content = bloques.filter((b) => b && (b.type !== "text" || b.text.trim() !== "")).map((b) => {
    if (b.type !== "tool_use") return b;
    let input: Record<string, unknown> = {};
    try { input = b.json ? JSON.parse(b.json) : {}; } catch {}
    return { type: "tool_use" as const, id: b.id, name: b.name, input };
  });
  return { content, stop_reason: stop };
}

/** Responde la conversación. El texto llega por «emitir» a medida que se escribe; si la IA decide consultar datos, el
 *  texto provisional se descarta («limpiar») y se avisa qué consulta. Las consultas de un mismo paso corren en paralelo.
 *  Devuelve el texto final y qué herramientas consultó. */
export async function responder(s: Sesion, mensajes: Mensaje[], emitir: (e: Evento) => void = () => {}) {
  const turnos: Turno[] = mensajes.map((m) => ({ role: m.role, content: m.content }));
  const usadas: string[] = [];
  // Instrucciones y herramientas en caché: a partir de la segunda pregunta la IA empieza a responder antes.
  const demo = await comoUsuario(s, async (c) => Boolean((await c.query(`select demo from empresas where id = $1`, [s.empresa])).rows[0]?.demo)).catch(() => false);
  const system = [{ type: "text", text: BASE, cache_control: { type: "ephemeral" } }, { type: "text", text: contexto(s, demo) }];
  for (let paso = 0; paso < 6; paso++) {
    const r = await llamar({ model: MODELO(), max_tokens: 2000, system, tools: herramientasPara(s.rol), messages: turnos }, emitir);
    const llamadas = r.content.filter((b): b is Extract<Bloque, { type: "tool_use" }> => b.type === "tool_use");
    if (r.stop_reason !== "tool_use" || !llamadas.length) {
      const texto = r.content.filter((b): b is Extract<Bloque, { type: "text" }> => b.type === "text").map((b) => b.text).join("\n").trim();
      return { respuesta: texto || "No tengo una respuesta para eso.", herramientas: usadas };
    }
    emitir({ t: "limpiar" });
    turnos.push({ role: "assistant", content: r.content });
    usadas.push(...llamadas.map((ll) => ll.name));
    const resultados: Bloque[] = await Promise.all(llamadas.map(async (ll) => {
      let datos: unknown;
      try { datos = await ejecutar(s, ll.name, ll.input ?? {}); } catch { datos = { error: "No se pudo consultar ese dato" }; }
      return { type: "tool_result" as const, tool_use_id: ll.id, content: JSON.stringify(datos).slice(0, 30000) };
    }));
    turnos.push({ role: "user", content: resultados });
  }
  return { respuesta: "La pregunta necesitó demasiadas consultas. Hazla más concreta, por favor.", herramientas: usadas };
}
