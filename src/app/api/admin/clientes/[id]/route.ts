import { z } from "zod";
import { NextResponse } from "next/server";
import { sinRLS } from "@/lib/db";
import { esUuid } from "@/lib/api";
import { conAdmin, evento } from "@/lib/admin";
import { encolar, enviarAhora } from "@/lib/correo";

const Cambio = z.object({ estado: z.enum(["activa", "suspendida"]).optional(), plan: z.enum(["esencial", "pro", "cadena", "socio"]).optional(), nota: z.string().trim().max(2000).nullish() });

/** Activar o suspender, cambiar el plan o la nota interna de un cliente. */
export const PATCH = conAdmin(async (a, req, ctx) => {
  const { id } = await ctx.params;
  if (!esUuid(id)) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const p = Cambio.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Datos no válidos" }, { status: 400 });
  const d = p.data;
  const claves: string[] = [];
  const n = await sinRLS(async (c) => {
    const antes = (await c.query(`select estado, coalesce(nombre_comercial, razon_social) nombre from empresas where id = $1 for update`, [id])).rows[0];
    const r = await c.query(`update empresas set estado = coalesce($2, estado), plan = coalesce($3, plan), nota_admin = case when $4::boolean then $5 else nota_admin end where id = $1 and not demo`,
      [id, d.estado ?? null, d.plan ?? null, d.nota !== undefined, d.nota ?? null]);
    if (r.rowCount && d.estado === "suspendida" && antes?.estado !== "suspendida") {
      const duenos = (await c.query(`select cu.email, cu.nombre from miembros m join cuentas cu on cu.id = m.user_id where m.empresa_id = $1 and m.activo and m.rol = 'dueno'`, [id])).rows;
      for (const u of duenos) { const k = `suspendida:${id}:${u.email}:${Date.now()}`; if (await encolar(c, { clave: k, para: u.email, plantilla: "cuenta_suspendida", empresa: id, datos: { nombre: u.nombre, empresa: antes.nombre } })) claves.push(k); }
    }
    return r;
  });
  for (const k of claves) await enviarAhora(k);
  if (!n.rowCount) return NextResponse.json({ error: "Cliente no encontrado (la demo no se modifica desde aquí)" }, { status: 404 });
  await evento(a, d.estado ? (d.estado === "activa" ? "activar_cliente" : "suspender_cliente") : d.plan ? "cambiar_plan" : "nota_cliente", id, d);
  return NextResponse.json({ ok: true, mensaje: d.estado === "suspendida" ? "Cliente suspendido" : d.estado === "activa" ? "Cliente activado" : "Guardado" });
});
