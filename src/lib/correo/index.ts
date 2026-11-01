import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { sinRLS, type Tx } from "../db";
import { SITIO, CORREO } from "../sitio";
import { COMERCIALES, EMBUDO, PLANTILLAS, type Plantilla } from "./plantillas";

// Cola de correos. Todo correo se encola con una clave única (nunca sale dos veces) y lo envía la tarea programada
// (/api/tareas) o el propio flujo con enviarAhora(). Proveedor: Resend (RESEND_API_KEY). Sin la llave, los correos
// quedan «simulado» y se ven en la consola: nada se pierde ni se envía a medias.
//   CORREO_REMITENTE  p. ej. «Regenta <hola@tudominio.co>» (dominio verificado en Resend)
//   CORREO_RESPUESTA  a dónde llegan las respuestas (por defecto gerencia@farmagenericoscolombia.com)

const MAX_INTENTOS = 5;
const secreto = () => {
  const s = process.env.REGENTA_SESSION_SECRET ?? (process.env.NODE_ENV !== "production" ? "solo-desarrollo-cambiar-en-produccion-0123456789" : "");
  if (s.length < 32) throw new Error("Falta REGENTA_SESSION_SECRET (mínimo 32 caracteres)");
  return s;
};

/** Token de baja firmado (no se puede dar de baja a otra persona adivinando el enlace). */
export const tokenBaja = (email: string) => {
  const e = email.trim().toLowerCase();
  return Buffer.from(e).toString("base64url") + "." + createHmac("sha256", "baja:" + secreto()).update(e).digest("base64url").slice(0, 32);
};
export function leerTokenBaja(t: string) {
  const [cuerpo, firma] = t.split(".");
  if (!cuerpo || !firma) return null;
  const email = Buffer.from(cuerpo, "base64url").toString("utf8");
  const a = Buffer.from(firma), b = Buffer.from(tokenBaja(email).split(".")[1]);
  return a.length === b.length && timingSafeEqual(a, b) ? email : null;
}
export const enlaceBaja = (email: string) => `${SITIO}/baja?t=${tokenBaja(email)}`;

type Encolar = { clave: string; para: string; plantilla: Plantilla; datos?: Record<string, unknown>; programado?: Date; empresa?: string | null };

/** Encola un correo (dentro de la transacción que lo origina). Devuelve false si ya existía o si la persona se dio de
 *  baja de los comerciales. */
export async function encolar(c: Tx, e: Encolar) {
  const para = e.para.trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(para)) return false;
  const comercial = COMERCIALES.includes(e.plantilla);
  if (comercial && (await c.query(`select 1 from correos_bajas where email = $1`, [para])).rowCount) return false;
  const r = await c.query(`insert into correos (clave, para, plantilla, tipo, datos, programado, empresa_id) values ($1, $2, $3, $4, $5, $6, $7) on conflict (clave) do nothing`,
    [e.clave, para, e.plantilla, comercial ? "comercial" : "transaccional", JSON.stringify(e.datos ?? {}), e.programado ?? new Date(), e.empresa ?? null]);
  return (r.rowCount ?? 0) > 0;
}

/** Encola el embudo de venta de una solicitud de demo (solo si autorizó correos). */
export async function encolarEmbudo(c: Tx, s: { id: number; email: string; nombre: string; drogueria: string; acepta: boolean }) {
  await encolar(c, { clave: `solicitud:${s.id}`, para: s.email, plantilla: "solicitud_recibida", datos: { nombre: s.nombre, drogueria: s.drogueria } });
  if (!s.acepta) return;
  const ahora = Date.now();
  for (const [plantilla, dias] of EMBUDO)
    await encolar(c, { clave: `embudo:${s.id}:${plantilla}`, para: s.email, plantilla, datos: { nombre: s.nombre, drogueria: s.drogueria }, programado: new Date(ahora + dias * 864e5) });
}

async function enviarResend(m: { id: number; para: string; asunto: string; html: string; texto: string; comercial: boolean; plantilla: string }) {
  const remitente = process.env.CORREO_REMITENTE;
  if (!process.env.RESEND_API_KEY || !remitente) return { simulado: true as const };
  const cab: Record<string, string> = {};
  if (m.comercial) { cab["List-Unsubscribe"] = `<${SITIO}/api/correo/baja?t=${tokenBaja(m.para)}>, <mailto:${CORREO}?subject=Baja>`; cab["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"; }
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json", "idempotency-key": `regenta-${m.id}` },
    body: JSON.stringify({ from: remitente, to: [m.para], subject: m.asunto, html: m.html, text: m.texto, reply_to: process.env.CORREO_RESPUESTA ?? CORREO, headers: cab, tags: [{ name: "plantilla", value: m.plantilla }] }),
  });
  const j = await r.json().catch(() => ({})) as { id?: string; message?: string; name?: string };
  if (!r.ok) throw Object.assign(new Error(j.message ?? `Resend respondió ${r.status}`), { definitivo: r.status >= 400 && r.status < 500 && r.status !== 429 });
  return { id: j.id ?? null };
}

/** Envía los correos que ya tocan (máx. `max`). Reintenta con espera creciente; los errores 4xx no se reintentan. */
export async function enviarPendientes(max = 50, soloId?: number) {
  const r = { enviados: 0, simulados: 0, errores: 0 };
  for (let i = 0; i < max; i++) {
    const m = await sinRLS(async (c) => (await c.query(
      `update correos set estado = 'enviando', intentos = intentos + 1 where id = (
         select id from correos where estado = 'pendiente' and programado <= now() and ($1::bigint is null or id = $1) order by programado, id limit 1 for update skip locked)
       returning id, para, plantilla, tipo, datos`, [soloId ?? null])).rows[0]);
    if (!m) break;
    try {
      // Una baja posterior al encolado también detiene los comerciales pendientes.
      const baja = m.tipo === "comercial" && (await sinRLS((c) => c.query(`select 1 from correos_bajas where email = $1`, [m.para]))).rowCount;
      if (baja) { await sinRLS((c) => c.query(`update correos set estado = 'cancelado', error = 'Se dio de baja' where id = $1`, [m.id])); continue; }
      const p = PLANTILLAS[m.plantilla as Plantilla];
      if (!p) throw Object.assign(new Error(`Plantilla desconocida: ${m.plantilla}`), { definitivo: true });
      const correo = p({ ...m.datos, baja: enlaceBaja(m.para) });
      const res = await enviarResend({ id: Number(m.id), para: m.para, asunto: correo.asunto, html: correo.html, texto: correo.texto, comercial: m.tipo === "comercial", plantilla: m.plantilla });
      // Los enlaces de activación no se quedan guardados en claro después de enviados.
      await sinRLS((c) => c.query(`update correos set estado = $2, proveedor_id = $3, enviado = now(), error = null, datos = datos - 'enlace' where id = $1`, [m.id, "simulado" in res ? "simulado" : "enviado", "id" in res ? res.id : null]));
      if ("simulado" in res) r.simulados++; else r.enviados++;
    } catch (e) {
      const definitivo = (e as { definitivo?: boolean }).definitivo;
      await sinRLS((c) => c.query(`update correos set estado = case when $3 or intentos >= $4 then 'error' else 'pendiente' end, error = $2,
        programado = now() + make_interval(mins => 5 * intentos * intentos) where id = $1`, [m.id, String((e as Error).message).slice(0, 500), !!definitivo, MAX_INTENTOS]));
      r.errores++;
    }
  }
  return r;
}

/** Envía de inmediato un correo recién encolado (sin esperar la tarea). Nunca rompe el flujo que lo llama. */
export async function enviarAhora(clave: string) {
  try {
    const id = (await sinRLS((c) => c.query(`select id from correos where clave = $1 and estado = 'pendiente' and programado <= now()`, [clave]))).rows[0]?.id;
    if (id) await enviarPendientes(1, Number(id));
  } catch (e) { console.error("correo", e); }
}

/** Recordatorios de renovación de pagos con QR o Wompi (no se cobran solos): 5 días antes, 1 día antes y 1 día después. */
export async function programarRecordatorios() {
  return sinRLS(async (c) => {
    const filas = (await c.query(`
      select distinct on (p.empresa_id) p.empresa_id, p.referencia, p.plan, p.vence::text vence, p.email, p.nombre, coalesce(e.nombre_comercial, e.razon_social) empresa
      from pagos_suscripcion p join empresas e on e.id = p.empresa_id
      where p.estado = 'aprobado' and p.proveedor in ('wompi', 'qr') and p.vence is not null and e.estado = 'activa' and not e.demo
      order by p.empresa_id, p.vence desc`)).rows;
    let n = 0;
    const hoy = new Date(new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" }) + "T00:00:00Z");
    for (const f of filas) {
      const vence = new Date(f.vence + "T00:00:00Z");
      const dias = Math.round((vence.getTime() - hoy.getTime()) / 864e5);
      const plantilla: Plantilla | null = dias === 5 || dias === 1 ? "renovacion_proxima" : dias === -1 ? "renovacion_vencida" : null;
      if (!plantilla) continue;
      const venceTxt = vence.toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
      if (await encolar(c, { clave: `renovacion:${f.referencia}:${dias}`, para: f.email, plantilla, empresa: f.empresa_id,
        datos: { nombre: f.nombre, empresa: f.empresa, plan: f.plan === "pro" ? "Pro" : "Esencial", plan_id: f.plan, vence: venceTxt } })) n++;
    }
    // Pagos que se quedaron a medias (pendientes de más de 1 hora y menos de 2 días): un solo correo de ayuda.
    const abandonados = (await c.query(`select referencia, email, nombre, plan from pagos_suscripcion p where estado = 'pendiente' and proveedor <> 'qr' and creado between now() - interval '2 days' and now() - interval '1 hour'
      and not exists (select 1 from pagos_suscripcion q where lower(q.email) = lower(p.email) and q.estado = 'aprobado' and q.creado > p.creado)`)).rows;
    for (const a of abandonados) if (await encolar(c, { clave: `abandonado:${a.email.toLowerCase()}:${a.plan}`, para: a.email, plantilla: "pago_abandonado", datos: { nombre: a.nombre, plan: a.plan === "pro" ? "Pro" : "Esencial", plan_id: a.plan } })) n++;
    return { encolados: n };
  });
}
