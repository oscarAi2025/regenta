import { sinRLS } from "@/lib/db";
import { conSesion, json } from "@/lib/api";
import { cancelarSuscripcionStripe, suscripcionStripe } from "@/lib/pagos";
import { encolar, enviarAhora } from "@/lib/correo";

/** El dueño cancela la renovación automática con tarjeta (Stripe). Lo ya pagado sigue vigente hasta su vencimiento. */
export const POST = conSesion(async (s) => {
  if (s.rol !== "dueno") return json({ error: "Solo el dueño puede cancelar la renovación" }, 403);
  const sub = await sinRLS((c) => suscripcionStripe(c, s.empresa));
  if (!sub) return json({ error: "Tu plan no tiene renovación automática con tarjeta" }, 404);
  if (sub.al_final) return json({ ok: true, mensaje: "La renovación ya estaba cancelada" });
  if (!(await cancelarSuscripcionStripe(sub.suscripcion, true))) return json({ error: "No pudimos cancelarla ahora. Inténtalo de nuevo o escríbenos por WhatsApp." }, 502);
  const claves = await sinRLS(async (c) => {
    await c.query(`update pagos_suscripcion set detalle = coalesce(detalle, '{}'::jsonb) || '{"cancelar_al_final":true}'::jsonb where suscripcion = $1`, [sub.suscripcion]);
    await c.query(`insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos) values ($1, $2, 'cancelar_renovacion', 'pagos_suscripcion', $3, '{}')`, [s.empresa, s.uid, sub.suscripcion]);
    // Constancia por correo a los dueños: qué se canceló y hasta cuándo sigue el plan.
    const e = (await c.query(`select e.plan, coalesce(e.nombre_comercial, e.razon_social) nombre, (select to_char(max(vence), 'DD/MM/YYYY') from pagos_suscripcion where empresa_id = e.id and estado = 'aprobado') vence from empresas e where e.id = $1`, [s.empresa])).rows[0];
    const out: string[] = [];
    for (const d of (await c.query(`select cu.email, cu.nombre from miembros m join cuentas cu on cu.id = m.user_id where m.empresa_id = $1 and m.activo and m.rol = 'dueno'`, [s.empresa])).rows) {
      const k = `renovacion-cancelada:${sub.suscripcion}:${d.email}`;
      if (await encolar(c, { clave: k, para: d.email, plantilla: "renovacion_cancelada", empresa: s.empresa, datos: { nombre: d.nombre, empresa: e.nombre, vence: e.vence, plan_id: e.plan } })) out.push(k);
    }
    return out;
  });
  for (const k of claves) await enviarAhora(k);
  return json({ ok: true, mensaje: "Listo: tu plan ya no se renovará. Sigue activo hasta el final de lo que pagaste." });
});
