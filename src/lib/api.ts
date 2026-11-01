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
