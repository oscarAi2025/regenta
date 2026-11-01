import { NextResponse } from "next/server";
import { sinRLS } from "@/lib/db";
import { crearSesion, cerrarSesion, demoActiva, leerSesion, type Rol } from "@/lib/sesion";
import { mismoOrigen } from "@/lib/api";

/** Acceso de demostración con los usuarios sembrados (se apaga en producción sin REGENTA_DEMO=1). */
export async function POST(req: Request) {
  if (!demoActiva()) return NextResponse.json({ error: "Acceso de demostración desactivado" }, { status: 404 });
  // Solo desde el propio sitio y con JSON (un formulario de otra web no puede cambiar la sesión de nadie).
  if (!mismoOrigen(req) || !(req.headers.get("content-type") ?? "").includes("application/json")) return NextResponse.json({ error: "Solicitud no permitida" }, { status: 403 });
  const actual = await leerSesion();
  if (actual) {
    const esDemo = await sinRLS(async (c) => (await c.query(`select demo from empresas where id = $1`, [actual.empresa])).rows[0]?.demo);
    if (!esDemo) return NextResponse.json({ error: "Ya tienes una sesión abierta: sal primero" }, { status: 409 });
  }
  const { uid } = (await req.json().catch(() => ({}))) as { uid?: string };
  if (!uid || !/^[0-9a-f-]{36}$/.test(uid)) return NextResponse.json({ error: "Usuario no válido" }, { status: 400 });
  const m = await sinRLS(async (c) => (await c.query(
    `select m.empresa_id, m.nombre, m.rol from miembros m join empresas e on e.id = m.empresa_id
     where m.user_id = $1 and m.activo and e.demo order by m.creado limit 1`, [uid])).rows[0]);
  if (!m) return NextResponse.json({ error: "Usuario de demostración no encontrado" }, { status: 404 });
  await crearSesion({ uid, empresa: m.empresa_id, nombre: m.nombre, rol: m.rol as Rol });
  return NextResponse.json({ ok: true, rol: m.rol });
}

export async function DELETE(req: Request) {
  if (!mismoOrigen(req)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  await cerrarSesion();
  return NextResponse.json({ ok: true });
}
