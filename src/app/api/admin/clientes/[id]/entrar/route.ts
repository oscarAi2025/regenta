import { NextResponse } from "next/server";
import { sinRLS } from "@/lib/db";
import { esUuid } from "@/lib/api";
import { conAdmin, evento } from "@/lib/admin";
import { crearSesion, type Rol } from "@/lib/sesion";

/** Entrar a la droguería de un cliente como su dueño, para darle soporte. Queda en la bitácora. */
export const POST = conAdmin(async (a, _req, ctx) => {
  const { id } = await ctx.params;
  if (!esUuid(id)) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const m = (await sinRLS((c) => c.query(`select m.user_id, m.nombre, m.rol from miembros m where m.empresa_id = $1 and m.activo order by (m.rol = 'dueno') desc, m.creado limit 1`, [id]))).rows[0];
  if (!m) return NextResponse.json({ error: "Este cliente no tiene usuarios activos" }, { status: 409 });
  await crearSesion({ uid: m.user_id, empresa: id, nombre: `${m.nombre} (soporte: ${a.nombre})`, rol: m.rol as Rol });
  await evento(a, "entrar_como", id, { usuario: m.user_id, rol: m.rol });
  return NextResponse.json({ ir: "/inicio" });
});
