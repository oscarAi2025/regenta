import "server-only";
import { NextResponse } from "next/server";
import { mensajeError } from "./db";
import { leerSesion, type Sesion } from "./sesion";

/** Envuelve un handler de API: exige sesión y traduce los errores de la base de datos a mensajes claros. */
export function conSesion(fn: (s: Sesion, req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>) {
  return async (req: Request, ctx: { params: Promise<Record<string, string>> }) => {
    if (!mismoOrigen(req)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
    const s = await leerSesion();
    if (!s) return NextResponse.json({ error: "Tu sesión venció: vuelve a entrar" }, { status: 401 });
    try {
      return await fn(s, req, ctx);
    } catch (e) {
      const { status, error } = mensajeError(e);
      return NextResponse.json({ error }, { status });
    }
  };
}
export const json = (d: unknown, status = 200) => NextResponse.json(d, { status });

/** Las escrituras solo se aceptan desde el propio sitio (defensa contra CSRF además de SameSite=lax). */
export function mismoOrigen(req: Request) {
  if (req.method === "GET" || req.method === "HEAD") return true;
  const origen = req.headers.get("origin");
  if (!origen) return req.headers.get("sec-fetch-site") !== "cross-site";
  try { return new URL(origen).host === (req.headers.get("x-forwarded-host") ?? req.headers.get("host")); } catch { return false; }
}

export const esUuid = (s: string) => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);

/** IP del visitante. Solo se cree la cabecera que pone la plataforma donde corre el sitio (Netlify o Vercel la
 *  sobrescriben siempre); fuera de ellas, solo si REGENTA_CABECERA_IP la nombra (p. ej. detrás de un proxy propio).
 *  Cualquier otra cabecera la puede escribir el visitante y se ignora. */
export function ipCliente(req: Request) {
  const h = req.headers;
  const cabecera = process.env.REGENTA_CABECERA_IP
    ?? (process.env.NETLIFY || process.env.SITE_ID ? "x-nf-client-connection-ip" : process.env.VERCEL ? "x-vercel-forwarded-for" : null);
  const v = cabecera ? h.get(cabecera)?.split(",")[0]?.trim() : null;
  return v || "local";
}

/** Límite de peticiones en memoria por clave y ventana; limpia lo viejo para no crecer sin fin. */
export function limitador(max: number, ventanaMs: number) {
  const mapa = new Map<string, number[]>();
  return (clave: string) => {
    const ahora = Date.now();
    if (mapa.size > 5000) for (const [k, v] of mapa) if (!v.some((t) => ahora - t < ventanaMs)) mapa.delete(k);
    const v = (mapa.get(clave) ?? []).filter((t) => ahora - t < ventanaMs);
    if (v.length >= max) { mapa.set(clave, v); return false; }
    v.push(ahora); mapa.set(clave, v); return true;
  };
}
