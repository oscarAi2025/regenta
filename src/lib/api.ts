import "server-only";
import { NextResponse } from "next/server";
import { mensajeError } from "./db";
import { leerSesion, type Sesion } from "./sesion";

/** Envuelve un handler de API: exige sesión y traduce los errores de la base de datos a mensajes claros. */
export function conSesion(fn: (s: Sesion, req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>) {
  return async (req: Request, ctx: { params: Promise<Record<string, string>> }) => {
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
