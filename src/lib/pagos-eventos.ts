import "server-only";
import { sinRLS, type Tx } from "./db";
import { cancelarSuscripcionStripe } from "./pagos";
import { encolar } from "./correo";
import { invitar } from "./admin-datos";
import { dvNit, nitSinDv } from "./validar";

const PLAN: Record<string, string> = { esencial: "Esencial", pro: "Pro" };

/** Alta automática al aprobarse el pago: crea la droguería (sede, caja y numeraciones de prueba hasta su habilitación
 *  ante la DIAN), invita al dueño con su enlace para crear la contraseña y deja el pago ligado y atendido. Si el NIT ya
 *  es cliente (renovación o segundo pago), solo liga el pago. Sin NIT queda para la consola. Devuelve la clave del correo. */
async function darDeAlta(c: Tx, p: Record<string, any>): Promise<string | null> {
  if (p.empresa_id) return null;
  const nit = nitSinDv(p.nit); // sin dígito de verificación (aunque lo escriban pegado o con espacio)
  if (nit.length < 6 || nit.length > 10) return null;
  const existe = (await c.query(`select id from empresas where nit = $1`, [nit])).rows[0];
  if (existe) {
    // Solo se liga solo si quien paga ya es dueño de esa droguería; si no, lo revisa la consola (evita que un tercero con
    // el NIT de otra droguería quede ligado a ella).
    const propio = (await c.query(`select 1 from miembros m join cuentas cu on cu.id = m.user_id
      where m.empresa_id = $1 and m.rol = 'dueno' and m.activo and lower(cu.email) = lower($2)`, [existe.id, p.email])).rowCount;
    if (propio) await c.query(`update pagos_suscripcion set empresa_id = $2, atendido = true where referencia = $1`, [p.referencia, existe.id]);
    else await c.query(`update pagos_suscripcion set detalle = coalesce(detalle, '{}'::jsonb) || '{"revisar":"nit_existente"}'::jsonb where referencia = $1`, [p.referencia]);
    return null;
  }
  const e = (await c.query(`insert into empresas (nit, dv, razon_social, nombre_comercial, plan, telefono, email) values ($1, $2, $3, $4, $5, $6, $7) returning id`,
    [nit, dvNit(nit), String(p.empresa).toUpperCase(), p.empresa, p.plan, p.telefono, p.email])).rows[0].id as string;
  const sede = (await c.query(`insert into sedes (empresa_id, nombre) values ($1, 'Principal') returning id`, [e])).rows[0].id;
  await c.query(`insert into cajas (empresa_id, sede_id, nombre) values ($1, $2, 'Caja 1')`, [e, sede]);
  // Numeraciones de prueba: deja usar Regenta desde hoy; los documentos salen marcados como pruebas hasta que se carga la
  // resolución real de la DIAN en la consola (Facturación electrónica).
  for (const [tipo, prefijo] of [["pos", "PRPOS"], ["factura", "PRFE"], ["nota_credito", "PRNC"]])
    await c.query(`insert into resoluciones_dian (empresa_id, tipo, prefijo, desde, hasta, actual, pruebas) values ($1, $2, $3, 1, 1000000, 0, true)`, [e, tipo, prefijo]);
  const inv = await invitar(c, e, { nombre: p.nombre, email: p.email, rol: "dueno" });
  await c.query(`update pagos_suscripcion set empresa_id = $2, atendido = true where referencia = $1`, [p.referencia, e]);
  if (!inv.enlace) return null; // ya tenía contraseña: entra con la de siempre
  const clave = `invitacion:${inv.cuenta_id}:${p.referencia}`;
  await encolar(c, { clave, para: p.email, plantilla: "invitacion", empresa: e, datos: { nombre: p.nombre, empresa: p.empresa, enlace: inv.enlace } });
  return clave;
}

/** Cuando un pago cambia de estado: fija hasta cuándo va el periodo pagado, da de alta la droguería si es nueva y encola
 *  los correos. Se llama dentro de la misma transacción que actualiza el pago (webhooks y confirmación al volver).
 *  Devuelve las claves de los correos para enviarlos al instante. */
export async function alCambiarPago(c: Tx, referencia: string): Promise<string[]> {
  const p = (await c.query(`select * from pagos_suscripcion where referencia = $1`, [referencia])).rows[0];
  if (!p) return [];
  if (p.estado === "aprobado") {
    // El alta va en un punto de guardado: si algo falla (p. ej. el correo es de un superadministrador), el pago queda
    // aprobado igual y la droguería se crea a mano desde la consola («Aprobados sin atender»).
    let invitacion: string | null = null;
    await c.query("savepoint alta");
    try { invitacion = await darDeAlta(c, p); await c.query("release savepoint alta"); }
    catch (e) { await c.query("rollback to savepoint alta"); console.error("alta automática", referencia, (e as Error).message); }
    // Pagar reactiva la cuenta suspendida POR FALTA DE PAGO (no la que suspendió la consola) y deja el plan pagado
    // (salvo planes especiales de la consola, que no se rebajan).
    await c.query(`update empresas e set estado = case when e.estado = 'suspendida' and e.suspension = 'impago' then 'activa' else e.estado end,
        suspension = case when e.estado = 'suspendida' and e.suspension = 'impago' then null else e.suspension end,
        plan = case when e.plan in ('esencial', 'pro') then p.plan else e.plan end
      from pagos_suscripcion p where p.referencia = $1 and e.id = p.empresa_id and not e.demo`, [referencia]);
    const empresa = (await c.query(`select empresa_id from pagos_suscripcion where referencia = $1`, [referencia])).rows[0]?.empresa_id ?? null;
    // Una sola renovación automática por droguería: si este pago es de otra suscripción (o de otro medio), la suscripción
    // de Stripe anterior se cancela (cancelarReemplazadas, fuera de la transacción). Lo ya pagado no se pierde: el periodo
    // nuevo se suma al vencimiento actual.
    if (empresa) await c.query(`update pagos_suscripcion set detalle = coalesce(detalle, '{}'::jsonb) || '{"cancelar_stripe":true}'::jsonb
      where empresa_id = $1 and proveedor = 'stripe' and estado = 'aprobado' and suscripcion is not null and suscripcion is distinct from $2
        and not coalesce((detalle ->> 'cancelada')::boolean, false)`, [empresa, p.suscripcion ?? null]);
    // El periodo empieza hoy o donde termina el último periodo pagado de la misma empresa o correo (renovación anticipada).
    if (!p.vence) await c.query(`update pagos_suscripcion set vence = greatest(current_date, coalesce((select max(vence) from pagos_suscripcion q where q.referencia <> $1 and q.estado = 'aprobado'
        and (case when $2::uuid is not null then q.empresa_id = $2 else q.empresa_id is null and lower(q.email) = lower($3) end)), current_date)) + case when $4 = 'anio' then interval '1 year' else interval '1 month' end where referencia = $1`, [referencia, empresa, p.email, p.periodo]);
    const vence = (await c.query(`select to_char(vence, 'DD/MM/YYYY') v from pagos_suscripcion where referencia = $1`, [referencia])).rows[0]?.v;
    await encolar(c, { clave: `pago:${referencia}:aprobado`, para: p.email, plantilla: "pago_aprobado", empresa,
      datos: { nombre: p.nombre, plan: PLAN[p.plan] ?? p.plan, plan_id: p.plan, periodo: p.periodo === "anio" ? "anual" : "mensual", monto: p.monto, referencia, vence } });
    return [`pago:${referencia}:aprobado`, ...(invitacion ? [invitacion] : [])];
  }
  if (p.estado === "anulado" && p.empresa_id) {
    // Un pago aprobado que después se anula (reverso de Wompi): si la droguería no tiene otro pago vigente, se suspende
    // por falta de pago (un pago nuevo la reactiva sola) y se avisa al dueño. Queda marcado para revisión en la consola.
    await c.query(`update pagos_suscripcion set detalle = coalesce(detalle, '{}'::jsonb) || '{"revisar":"pago_anulado"}'::jsonb, atendido = false where referencia = $1`, [referencia]);
    const vigente = (await c.query(`select 1 from pagos_suscripcion where empresa_id = $1 and estado = 'aprobado' and referencia <> $2 and vence >= current_date`, [p.empresa_id, referencia])).rowCount;
    if (vigente) return [];
    const e = (await c.query(`update empresas set estado = 'suspendida', suspension = 'impago' where id = $1 and estado = 'activa' and not demo
      returning coalesce(nombre_comercial, razon_social) nombre`, [p.empresa_id])).rows[0];
    if (!e) return [];
    const claves: string[] = [];
    for (const d of (await c.query(`select cu.email, cu.nombre from miembros m join cuentas cu on cu.id = m.user_id where m.empresa_id = $1 and m.activo and m.rol = 'dueno'`, [p.empresa_id])).rows) {
      const k = `suspendida-anulado:${referencia}:${d.email}`;
      if (await encolar(c, { clave: k, para: d.email, plantilla: "cuenta_suspendida", empresa: p.empresa_id, datos: { nombre: d.nombre, empresa: e.nombre } })) claves.push(k);
    }
    return claves;
  }
  if (p.estado === "rechazado") {
    await encolar(c, { clave: `pago:${referencia}:rechazado`, para: p.email, plantilla: "pago_rechazado", datos: { nombre: p.nombre, plan: PLAN[p.plan] ?? p.plan, plan_id: p.plan } });
    return [`pago:${referencia}:rechazado`];
  }
  return [];
}

/** Cancela en Stripe las suscripciones reemplazadas por un pago nuevo (marcadas por alCambiarPago). Se llama después de
 *  cada pago aprobado y en la tarea diaria: si Stripe no responde, se reintenta la próxima vez. */
export async function cancelarReemplazadas() {
  const subs = await sinRLS(async (c) => (await c.query(`select distinct suscripcion from pagos_suscripcion
    where proveedor = 'stripe' and detalle ? 'cancelar_stripe' and not coalesce((detalle ->> 'cancelada')::boolean, false) and suscripcion is not null limit 20`)).rows.map((r) => r.suscripcion as string));
  for (const sub of subs) {
    if (!(await cancelarSuscripcionStripe(sub, false))) continue;
    await sinRLS((c) => c.query(`update pagos_suscripcion set detalle = coalesce(detalle, '{}'::jsonb) || '{"cancelada":true,"reemplazada":true}'::jsonb, actualizado = now() where suscripcion = $1`, [sub]));
  }
}
