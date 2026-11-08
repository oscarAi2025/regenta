import "server-only";
import { createHash } from "node:crypto";
import { cookies } from "next/headers";
import { sinRLS } from "./db";
import { esUuid, ipCliente } from "./api";
import { dispositivo, geoDesde, leerOrigen } from "./visitas-demo-core";

/**
 * Visitas a la droguería de demostración (consola /admin/demo, 08/11/2026): de dónde vienen, desde qué ciudad y
 * dispositivo, y qué hacen dentro. Nunca rompe la demo: cualquier fallo (p. ej. sin el SQL 039) se ignora.
 * Ubicación: la que da Netlify a partir de la IP (cabecera x-nf-geo), a nivel de ciudad; la IP no se guarda, solo un
 * resumen irreversible (HMAC) para saber si la misma persona vuelve.
 */
export const COOKIE_VISITA = "regenta_demo_visita";
export const COOKIE_ORIGEN = "regenta_origen";
export const TIPOS_EVENTO = ["pagina", "venta", "ia", "oferta", "contratar", "whatsapp", "datos"] as const;
export type TipoEvento = (typeof TIPOS_EVENTO)[number];

const corto = (s: unknown, n: number) => (typeof s === "string" ? s.replace(/[\u0000-\u001f]+/g, " ").trim().slice(0, n) : "") || null;
const enNetlify = () => !!(process.env.NETLIFY || process.env.SITE_ID);

/** Ciudad, departamento y país según Netlify (solo se cree la cabecera en Netlify, que la sobrescribe siempre). */
export const geo = (req: Request) => geoDesde(enNetlify() ? req.headers.get("x-nf-geo") : null);

/** Resumen irreversible de la IP para reconocer visitas repetidas sin guardarla. */
export function visitante(req: Request) {
  const ip = ipCliente(req);
  if (ip === "local") return null;
  return createHash("sha256").update(`${process.env.REGENTA_SESSION_SECRET ?? ""}:visitante:${ip}`).digest("hex").slice(0, 16);
}

/** Crea la visita al entrar a la demo y deja su id en una cookie de la sesión de demo. */
export async function crearVisita(req: Request, rol: string) {
  try {
    const jar = await cookies();
    const o = leerOrigen(jar.get(COOKIE_ORIGEN)?.value);
    // Sin cookie de origen (entrada directa a /demo): el referente de esta petición, si viene de otro sitio.
    if (!o.origen) { try { const r = new URL(req.headers.get("referer") ?? ""); if (r.host && r.host !== req.headers.get("host")) o.origen = corto(r.host.replace(/^www\./, ""), 60); } catch {} }
    const g = geo(req), d = dispositivo(req.headers.get("user-agent") ?? "");
    const id = await sinRLS(async (c) => (await c.query(
      `insert into demo_visitas (rol, ciudad, region, pais, dispositivo, navegador, sistema, origen, campana, landing, referente, visitante)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12) returning id`,
      [rol, g.ciudad, g.region, g.pais, d.dispositivo, d.navegador, d.sistema, o.origen ?? "directo", o.campana, o.landing, o.referente, visitante(req)])).rows[0].id as string);
    jar.set(COOKIE_VISITA, id, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 12 * 3600 });
    return id;
  } catch (e) { console.error("visita demo", (e as Error).message); return null; }
}

/** Id de la visita actual (cookie), o null. */
export async function visitaActual() {
  const v = (await cookies()).get(COOKIE_VISITA)?.value ?? "";
  return esUuid(v) ? v : null;
}

/** Guarda un paso de la visita. Silencioso ante cualquier fallo. */
export async function registrarEvento(visita: string | null, tipo: TipoEvento, detalle?: string | null) {
  if (!visita) return;
  try {
    await sinRLS(async (c) => {
      const r = await c.query(`update demo_visitas set ultima = now() where id = $1 and creada > now() - interval '1 day'`, [visita]);
      if (r.rowCount) await c.query(`insert into demo_eventos (visita_id, tipo, detalle) values ($1, $2, $3)`, [visita, tipo, corto(detalle, 240)]);
    });
  } catch (e) { console.error("evento demo", (e as Error).message); }
}
