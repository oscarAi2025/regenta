import { NextResponse } from "next/server";
import { sinRLS } from "@/lib/db";
import { crearSesion, cerrarSesion, demoActiva, type Rol } from "@/lib/sesion";

/** Acceso de demostración con los usuarios sembrados (se apaga en producción sin REGENTA_DEMO=1). */
export async function POST(req: Request) {
  if (!demoActiva()) return NextResponse.json({ error: "Acceso de demostración desactivado" }, { status: 404 });
  const { uid } = (await req.json().catch(() => ({}))) as { uid?: string };
  if (!uid || !/^[0-9a-f-]{36}$/.test(uid)) return NextResponse.json({ error: "Usuario no válido" }, { status: 400 });
  const m = await sinRLS(async (c) => (await c.query(
    `select m.empresa_id, m.nombre, m.rol from miembros m join empresas e on e.id = m.empresa_id
     where m.user_id = $1 and m.activo and e.nit like '90000000%' order by m.creado limit 1`, [uid])).rows[0]);
  if (!m) return NextResponse.json({ error: "Usuario de demostración no encontrado" }, { status: 404 });
  await crearSesion({ uid, empresa: m.empresa_id, nombre: m.nombre, rol: m.rol as Rol });
  return NextResponse.json({ ok: true, rol: m.rol });
}

export async function DELETE() {
  await cerrarSesion();
  return NextResponse.json({ ok: true });
}
