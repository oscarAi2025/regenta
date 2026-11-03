import { z } from "zod";
import { NextResponse } from "next/server";
import { sinRLS } from "@/lib/db";
import { esUuid } from "@/lib/api";
import { conAdmin, evento } from "@/lib/admin";
import { alCambiarPago, cancelarReemplazadas } from "@/lib/pagos-eventos";
import { nuevaReferencia } from "@/lib/pagos";
import { enviarAhora } from "@/lib/correo";

const Manual = z.object({ plan: z.enum(["esencial", "pro"]), periodo: z.enum(["mes", "anio"]), monto: z.number().int().positive().max(100_000_000),
  medio: z.enum(["Transferencia", "Consignación", "Efectivo", "Otro"]), soporte: z.string().trim().max(80).optional() });

/** Registrar un pago recibido por fuera de las pasarelas (transferencia, efectivo…): cuenta igual que uno en línea:
 *  reactiva si estaba suspendida por impago, deja el plan pagado, suma el periodo y le llega el correo de pago aprobado. */
export const POST = conAdmin(async (a, req, ctx) => {
  const { id } = await ctx.params;
  if (!esUuid(id)) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const p = Manual.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message ?? "Revisa los datos" }, { status: 400 });
  const d = p.data, referencia = nuevaReferencia(d.plan);
  const claves = await sinRLS(async (c) => {
    const e = (await c.query(`select e.nit, e.demo, coalesce(e.nombre_comercial, e.razon_social) nombre, e.telefono,
        (select cu.email from miembros m join cuentas cu on cu.id = m.user_id where m.empresa_id = e.id and m.rol = 'dueno' and m.activo order by m.creado limit 1) email,
        (select m.nombre from miembros m where m.empresa_id = e.id and m.rol = 'dueno' and m.activo order by m.creado limit 1) dueno
      from empresas e where e.id = $1`, [id])).rows[0];
    if (!e || e.demo) return null;
    await c.query(`insert into pagos_suscripcion (referencia, plan, periodo, monto, proveedor, nombre, empresa, nit, email, telefono, empresa_id, estado, metodo, atendido, detalle)
      values ($1, $2, $3, $4, 'manual', $5, $6, $7, $8, $9, $10, 'aprobado', $11, true, $12)`,
      [referencia, d.plan, d.periodo, d.monto, e.dueno ?? e.nombre, e.nombre, e.nit, e.email ?? "sin-correo@regenta.pro", e.telefono ?? "0000000", id, d.medio, JSON.stringify({ manual: true, soporte: d.soporte ?? null, por: a.nombre })]);
    await evento(a, "pago_manual", id, { referencia, ...d }, c);
    return alCambiarPago(c, referencia);
  });
  if (!claves) return NextResponse.json({ error: "Cliente no encontrado (la demo no recibe pagos)" }, { status: 404 });
  for (const k of claves) await enviarAhora(k);
  await cancelarReemplazadas();
  return NextResponse.json({ ok: true, mensaje: `Pago registrado (${referencia}): plan y vencimiento aplicados` }, { status: 201 });
});
