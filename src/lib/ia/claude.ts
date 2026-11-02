import "server-only";
import type { Sesion } from "../sesion";
import { ejecutar, herramientasPara } from "./herramientas";

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
  return `Eres Regenta IA, el asesor experto de la droguería dentro del programa Regenta. Hoy es ${hoy} (Bogotá). Hablas con ${s.nombre.split(" (")[0]}, rol ${s.rol}.

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
- Cada recomendación de gestión (qué pedir, qué rotar, qué revisar) dice de qué dato sale.`;
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
    const r = await llamar({ model: MODELO(), max_tokens: 2000, system: sistema(s), tools: herramientasPara(s.rol), messages: turnos });
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
