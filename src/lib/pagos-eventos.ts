import "server-only";
import type { Tx } from "./db";
import { encolar } from "./correo";

const PLAN: Record<string, string> = { esencial: "Esencial", pro: "Pro" };

/** Cuando un pago cambia de estado: fija hasta cuándo va el periodo pagado y encola el correo que corresponde.
 *  Se llama dentro de la misma transacción que actualiza el pago (webhooks y confirmación al volver). */
export async function alCambiarPago(c: Tx, referencia: string) {
  const p = (await c.query(`select * from pagos_suscripcion where referencia = $1`, [referencia])).rows[0];
  if (!p) return null;
  if (p.estado === "aprobado") {
    // El periodo empieza hoy o donde termina el último periodo pagado de la misma empresa o correo (renovación anticipada).
    if (!p.vence) await c.query(`update pagos_suscripcion set vence = greatest(current_date, coalesce((select max(vence) from pagos_suscripcion q where q.referencia <> $1 and q.estado = 'aprobado'
        and (q.empresa_id = $2 or lower(q.email) = lower($3))), current_date)) + case when $4 = 'anio' then interval '1 year' else interval '1 month' end where referencia = $1`, [referencia, p.empresa_id, p.email, p.periodo]);
    const vence = (await c.query(`select to_char(vence, 'DD/MM/YYYY') v from pagos_suscripcion where referencia = $1`, [referencia])).rows[0]?.v;
    await encolar(c, { clave: `pago:${referencia}:aprobado`, para: p.email, plantilla: "pago_aprobado", empresa: p.empresa_id,
      datos: { nombre: p.nombre, plan: PLAN[p.plan] ?? p.plan, plan_id: p.plan, periodo: p.periodo === "anio" ? "anual" : "mensual", monto: p.monto, referencia, vence } });
    return `pago:${referencia}:aprobado`;
  }
  if (p.estado === "rechazado") {
    await encolar(c, { clave: `pago:${referencia}:rechazado`, para: p.email, plantilla: "pago_rechazado", datos: { nombre: p.nombre, plan: PLAN[p.plan] ?? p.plan, plan_id: p.plan } });
    return `pago:${referencia}:rechazado`;
  }
  return null;
}
