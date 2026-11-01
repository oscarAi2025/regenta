import { NextResponse } from "next/server";
import { sinRLS } from "@/lib/db";
import { crearSesion, demoActiva, type Rol } from "@/lib/sesion";

// Un clic desde la portada: entra a la droguería de demostración como dueño (o con ?rol=cajero|bodega), sin registro.
const DEMO: Record<string, string> = { dueno: "00000000-0000-4000-8000-000000000001", cajero: "00000000-0000-4000-8000-000000000002", bodega: "00000000-0000-4000-8000-000000000003" };

export async function GET(req: Request) {
  const url = new URL(req.url);
  if (!demoActiva()) return NextResponse.redirect(new URL("/#demo", url));
  const uid = DEMO[url.searchParams.get("rol") ?? "dueno"] ?? DEMO.dueno;
  const m = await sinRLS(async (c) => (await c.query(`select empresa_id, nombre, rol from miembros where user_id = $1 and activo limit 1`, [uid])).rows[0]);
  if (!m) return NextResponse.redirect(new URL("/entrar", url));
  await crearSesion({ uid, empresa: m.empresa_id, nombre: m.nombre, rol: m.rol as Rol });
  return NextResponse.redirect(new URL(m.rol === "cajero" ? "/caja" : "/inicio", url));
}
