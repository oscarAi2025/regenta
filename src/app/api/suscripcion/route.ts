import { sinRLS } from "@/lib/db";
import { conSesion, json } from "@/lib/api";
import { cancelarSuscripcionStripe, suscripcionStripe } from "@/lib/pagos";

/** El dueño cancela la renovación automática con tarjeta (Stripe). Lo ya pagado sigue vigente hasta su vencimiento. */
export const POST = conSesion(async (s) => {
  if (s.rol !== "dueno") return json({ error: "Solo el dueño puede cancelar la renovación" }, 403);
  const sub = await sinRLS((c) => suscripcionStripe(c, s.empresa));
  if (!sub) return json({ error: "Tu plan no tiene renovación automática con tarjeta" }, 404);
  if (sub.al_final) return json({ ok: true, mensaje: "La renovación ya estaba cancelada" });
  if (!(await cancelarSuscripcionStripe(sub.suscripcion, true))) return json({ error: "No pudimos cancelarla ahora. Inténtalo de nuevo o escríbenos por WhatsApp." }, 502);
  await sinRLS(async (c) => {
    await c.query(`update pagos_suscripcion set detalle = coalesce(detalle, '{}'::jsonb) || '{"cancelar_al_final":true}'::jsonb where suscripcion = $1`, [sub.suscripcion]);
    await c.query(`insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos) values ($1, $2, 'cancelar_renovacion', 'pagos_suscripcion', $3, '{}')`, [s.empresa, s.uid, sub.suscripcion]);
  });
  return json({ ok: true, mensaje: "Listo: tu plan ya no se renovará. Sigue activo hasta el final de lo que pagaste." });
});
