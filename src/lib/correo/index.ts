import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import nodemailer, { type Transporter } from "nodemailer";
import { sinRLS, type Tx } from "../db";
import { SITIO, CORREO } from "../sitio";
import { COMERCIALES, EMBUDO, PLANTILLAS, type Plantilla } from "./plantillas";

// Cola de correos. Todo correo se encola con una clave única (nunca sale dos veces) y lo envía la tarea programada
// (/api/tareas) o el propio flujo con enviarAhora(). Proveedor, en este orden:
//   1. Buzón propio de Google Workspace por SMTP (smtp.gmail.com:465): SMTP_USER (buzón) y SMTP_PASS (contraseña de
//      aplicación). Es lo mismo que usa Justicia Activa: sin servicios intermedios.
//   2. Resend (RESEND_API_KEY + CORREO_REMITENTE con dominio verificado).
// Sin ninguno, los correos quedan «simulado» y se ven en la consola: nada se pierde ni se envía a medias.
//   CORREO_REMITENTE  p. ej. «Regenta <hola@regenta.pro>». Con SMTP debe ser el buzón o un alias suyo («Enviar como»).
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
  const nuevo = (r.rowCount ?? 0) > 0;
  // Todo correo transaccional a un cliente es un evento que la gerencia también debe saber.
  // Absolutamente todo (Oscar, 04/11/2026): también los comerciales del embudo, avisados cuando salen.
  if (nuevo && e.plantilla !== "aviso_interno" && para !== correoAvisos())
    await avisar(c, `aviso:${e.clave}`, e.plantilla, { ...(e.datos ?? {}), para, empresa_id: e.empresa ?? null }, e.programado);
  return nuevo;
}

/** Correo de la gerencia que recibe los avisos internos (CORREO_AVISOS; por defecto el de la empresa). */
export const correoAvisos = () => (process.env.CORREO_AVISOS?.trim() || CORREO).toLowerCase();
const PRIVADOS = ["enlace", "llave", "baja", "token", "clave", "contrasena"];

/** Aviso interno a la gerencia (demo, registro, pago, DIAN…). Una sola vez por clave; nunca lleva enlaces de acceso. */
export async function avisar(c: Tx, clave: string, evento: string, datos: Record<string, unknown> = {}, programado?: Date) {
  const limpio = Object.fromEntries(Object.entries(datos).filter(([k, v]) => !PRIVADOS.includes(k) && (v === null || ["string", "number", "boolean"].includes(typeof v))));
  await c.query(`insert into correos (clave, para, plantilla, tipo, datos, programado, empresa_id) values ($1, $2, 'aviso_interno', 'transaccional', $3, $5, $4) on conflict (clave) do nothing`,
    [clave, correoAvisos(), JSON.stringify({ evento, ...limpio }), typeof datos.empresa_id === "string" ? datos.empresa_id : null, programado ?? new Date()]);
}

/** Encola el embudo de venta de una solicitud de demo (solo si autorizó correos). */
export async function encolarEmbudo(c: Tx, s: { id: number; email: string; nombre: string; drogueria: string; acepta: boolean }) {
  await encolar(c, { clave: `solicitud:${s.id}`, para: s.email, plantilla: "solicitud_recibida", datos: { nombre: s.nombre, drogueria: s.drogueria } });
  if (!s.acepta) return;
  const ahora = Date.now();
  for (const [plantilla, dias] of EMBUDO)
    await encolar(c, { clave: `embudo:${s.id}:${plantilla}`, para: s.email, plantilla, datos: { nombre: s.nombre, drogueria: s.drogueria }, programado: new Date(ahora + dias * 864e5) });
}

type Saliente = { id: number; para: string; asunto: string; html: string; texto: string; comercial: boolean; plantilla: string };

const smtpUser = () => process.env.SMTP_USER?.trim() ?? "";
const smtpPass = () => (process.env.SMTP_PASS ?? "").replace(/\s+/g, ""); // Google la muestra en grupos de 4 con espacios
let transporte: Transporter | null = null;

function cabeceras(m: Saliente) {
  const cab: Record<string, string> = {};
  if (m.comercial) { cab["List-Unsubscribe"] = `<${SITIO}/api/correo/baja?t=${tokenBaja(m.para)}>, <mailto:${CORREO}?subject=Baja>`; cab["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"; }
  return cab;
}

/** Elige el proveedor configurado. */
async function enviar(m: Saliente) {
  if (smtpUser() && smtpPass()) return enviarSmtp(m);
  return enviarResend(m);
}

async function enviarSmtp(m: Saliente) {
  const puerto = Number(process.env.SMTP_PORT ?? 465);
  transporte ??= nodemailer.createTransport({ host: process.env.SMTP_HOST ?? "smtp.gmail.com", port: puerto, secure: puerto === 465, auth: { user: smtpUser(), pass: smtpPass() }, connectionTimeout: 10000, socketTimeout: 15000 });
  try {
    const r = await transporte.sendMail({
      from: process.env.CORREO_REMITENTE || { name: "Regenta", address: smtpUser() }, to: m.para, subject: m.asunto, html: m.html, text: m.texto,
      replyTo: process.env.CORREO_RESPUESTA ?? CORREO, headers: { ...cabeceras(m), "X-Regenta-Id": String(m.id) },
    });
    return { id: r.messageId ?? null };
  } catch (e) {
    // Un destinatario rechazado (550–553) no se arregla reintentando. Un 535 (usuario o contraseña) es de
    // configuración: se reintenta, así que al corregir SMTP_PASS los correos salen solos.
    const code = (e as { responseCode?: number }).responseCode ?? 0;
    throw Object.assign(new Error(`SMTP: ${(e as Error).message}`), { definitivo: code >= 550 && code <= 553 });
  }
}

async function enviarResend(m: Saliente) {
  const remitente = process.env.CORREO_REMITENTE;
  if (!process.env.RESEND_API_KEY || !remitente) return { simulado: true as const };
  const cab = cabeceras(m);
  const r = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { authorization: `Bearer ${process.env.RESEND_API_KEY}`, "content-type": "application/json", "idempotency-key": `regenta-${m.id}` },
    body: JSON.stringify({ from: remitente, to: [m.para], subject: m.asunto, html: m.html, text: m.texto, reply_to: process.env.CORREO_RESPUESTA ?? CORREO, headers: cab, tags: [{ name: "plantilla", value: m.plantilla }] }),
  });
  const j = await r.json().catch(() => ({})) as { id?: string; message?: string; name?: string };
  if (!r.ok) throw Object.assign(new Error(j.message ?? `Resend respondió ${r.status}`), { definitivo: r.status >= 400 && r.status < 500 && r.status !== 429 });
  return { id: j.id ?? null };
}

/** Envía los correos que ya tocan (máx. `max`, y sin pasar de `presupuesto` ms para no cortar la función a la mitad).
 *  Reintenta con espera creciente; los errores 4xx no se reintentan. Un correo que quedó «enviando» más de 10 minutos
 *  (la función se cortó entre el envío y el registro) vuelve a la cola: Resend no lo duplica gracias a la clave de idempotencia. */
export async function enviarPendientes(max = 50, soloId?: number, presupuesto = 15000) {
  const r = { enviados: 0, simulados: 0, errores: 0, recuperados: 0 };
  const inicio = Date.now();
  if (soloId === undefined) r.recuperados = (await sinRLS((c) => c.query(`update correos set estado = 'pendiente', programado = now()
    where estado = 'enviando' and programado < now() - interval '10 minutes'`))).rowCount ?? 0;
  for (let i = 0; i < max && Date.now() - inicio < presupuesto; i++) {
    const m = await sinRLS(async (c) => (await c.query(
      `update correos set estado = 'enviando', intentos = intentos + 1, programado = now() where id = (
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
      const res = await enviar({ id: Number(m.id), para: m.para, asunto: correo.asunto, html: correo.html, texto: correo.texto, comercial: m.tipo === "comercial", plantilla: m.plantilla });
      // Los enlaces de activación no se quedan guardados en claro después de enviados.
      await sinRLS((c) => c.query(`update correos set estado = $2, proveedor_id = $3, enviado = now(), error = null, datos = datos - 'enlace' where id = $1`, [m.id, "simulado" in res ? "simulado" : "enviado", "id" in res ? res.id : null]));
      if ("simulado" in res) r.simulados++; else r.enviados++;
    } catch (e) {
      const definitivo = (e as { definitivo?: boolean }).definitivo;
      // Si ya no se reintenta, el enlace de contraseña tampoco se queda guardado en claro.
      await sinRLS((c) => c.query(`update correos set estado = case when $3 or intentos >= $4 then 'error' else 'pendiente' end, error = $2,
        datos = case when $3 or intentos >= $4 then datos - 'enlace' else datos end,
        programado = now() + make_interval(mins => 5 * intentos * intentos) where id = $1`, [m.id, String((e as Error).message).slice(0, 500), !!definitivo, MAX_INTENTOS]));
      r.errores++;
    }
  }
  return r;
}

/** Envía de inmediato un correo recién encolado (sin esperar la tarea). Nunca rompe el flujo que lo llama. */
export async function enviarAhora(clave: string) {
  try {
    const ids = (await sinRLS((c) => c.query(`select id from correos where clave = any($1) and estado = 'pendiente' and programado <= now() order by id`, [[clave, `aviso:${clave}`]]))).rows;
    for (const { id } of ids) await enviarPendientes(1, Number(id));
  } catch (e) { console.error("correo", e); }
}

/** Recordatorios de renovación de lo que no se cobra solo (QR, Wompi o Stripe cancelada): 5 días antes, 1 día antes y 1 día después. */
export async function programarRecordatorios() {
  return sinRLS(async (c) => {
    const filas = (await c.query(`
      select * from (
        select distinct on (p.empresa_id) p.empresa_id, p.referencia, p.plan, p.vence::text vence, p.email, p.nombre, p.proveedor,
               coalesce((p.detalle ->> 'cancelada')::boolean or (p.detalle ->> 'cancelar_al_final')::boolean, false) cancelada,
               coalesce(e.nombre_comercial, e.razon_social) empresa
        from pagos_suscripcion p join empresas e on e.id = p.empresa_id
        where p.estado = 'aprobado' and p.vence is not null and e.estado = 'activa' and not e.demo
        order by p.empresa_id, p.vence desc) u
      where not (u.proveedor = 'stripe' and not u.cancelada)`)).rows; // el último pago de cualquier medio; Stripe vigente se renueva solo
    let n = 0;
    const hoy = new Date(new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" }) + "T00:00:00Z");
    for (const f of filas) {
      const vence = new Date(f.vence + "T00:00:00Z");
      const dias = Math.round((vence.getTime() - hoy.getTime()) / 864e5);
      const plantilla: Plantilla | null = dias === 5 || dias === 1 ? "renovacion_proxima" : dias === -1 ? "renovacion_vencida" : null;
      if (!plantilla) continue;
      const venceTxt = vence.toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
      // A los dueños de hoy (el pago pudo hacerlo otra persona o un dueño anterior) y a quien pagó.
      const para = new Map<string, string>([[String(f.email).toLowerCase(), f.nombre]]);
      for (const d of (await c.query(`select cu.email, cu.nombre from miembros m join cuentas cu on cu.id = m.user_id where m.empresa_id = $1 and m.activo and m.rol = 'dueno' and cu.activa`, [f.empresa_id])).rows) para.set(String(d.email).toLowerCase(), d.nombre);
      for (const [email, nombre] of para)
        if (await encolar(c, { clave: `renovacion:${f.referencia}:${dias}${email === String(f.email).toLowerCase() ? "" : `:${email}`}`, para: email, plantilla, empresa: f.empresa_id,
          datos: { nombre, empresa: f.empresa, plan: f.plan === "pro" ? "Pro" : "Esencial", plan_id: f.plan, vence: venceTxt } })) n++;
    }
    // Pagos que se quedaron a medias (pendientes de más de 1 hora y menos de 2 días): un solo correo de ayuda.
    const abandonados = (await c.query(`select referencia, email, nombre, plan from pagos_suscripcion p where estado = 'pendiente' and proveedor <> 'qr' and creado between now() - interval '2 days' and now() - interval '1 hour'
      and not exists (select 1 from pagos_suscripcion q where lower(q.email) = lower(p.email) and q.estado = 'aprobado' and q.creado > p.creado)`)).rows;
    for (const a of abandonados) if (await encolar(c, { clave: `abandonado:${a.email.toLowerCase()}:${a.plan}`, para: a.email, plantilla: "pago_abandonado", datos: { nombre: a.nombre, plan: a.plan === "pro" ? "Pro" : "Esencial", plan_id: a.plan } })) n++;
    return { encolados: n };
  });
}
