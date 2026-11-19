import "server-only";
import { NextResponse } from "next/server";
import { pool } from "./db";
import type { Sesion } from "./sesion";
import { controlEspecialIncluido, MENSAJE_CONTROL_PLAN } from "./planes";

/** ¿El plan de la droguería incluye el módulo de control especial? (Pro, Cadena, Socio o la demo). */
export async function controlEspecialActivo(empresa: string): Promise<boolean> {
  const e = (await pool.query(`select plan, demo from empresas where id = $1`, [empresa])).rows[0];
  return !!e && controlEspecialIncluido(e.plan, e.demo);
}

type Manejador = (s: Sesion, req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;
/** Envoltorio para las rutas API del módulo: con un plan que no lo incluye responde 403 con un mensaje claro. */
export const conControlEspecial = (fn: Manejador): Manejador => async (s, req, ctx) =>
  (await controlEspecialActivo(s.empresa)) ? fn(s, req, ctx) : NextResponse.json({ error: MENSAJE_CONTROL_PLAN, plan: "requiere_pro" }, { status: 403 });
