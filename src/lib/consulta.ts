import "server-only";
import { sinRLS } from "./db";

/** Datos de la droguería para la pantalla de cuenta suspendida: plan, último periodo pagado y desde cuándo está suspendida. */
export async function estadoCuenta(empresa: string) {
  return sinRLS(async (c) => (await c.query(`select coalesce(e.nombre_comercial, e.razon_social) nombre, e.nit, e.dv, e.plan, e.estado, e.suspension,
      to_char((select max(p.vence) from pagos_suscripcion p where p.empresa_id = e.id and p.estado = 'aprobado'), 'DD/MM/YYYY') vence,
      (select min(d.fecha)::text from (select (creado at time zone 'America/Bogota')::date fecha from documentos_dian where empresa_id = e.id) d) primer_documento,
      (select count(*)::int from documentos_dian where empresa_id = e.id and not simulado) documentos
    from empresas e where e.id = $1`, [empresa])).rows[0] as { nombre: string; nit: string; dv: string | null; plan: string; estado: string; suspension: string | null;
      vence: string | null; primer_documento: string | null; documentos: number } | undefined);
}

/** Datos para renovar sin volver a escribir nada: el dueño, su droguería y el último celular con el que pagó. */
export async function datosRenovacion(uid: string, empresa: string) {
  return sinRLS(async (c) => (await c.query(`select k.nombre, k.email, coalesce(e.nombre_comercial, e.razon_social) empresa,
      e.nit || coalesce('-' || e.dv, '') nit, e.plan,
      coalesce((select p.telefono from pagos_suscripcion p where p.empresa_id = e.id and p.telefono is not null order by p.creado desc limit 1), e.telefono, '') telefono
    from cuentas k, empresas e where k.id = $1 and e.id = $2 and not e.demo`, [uid, empresa])).rows[0] as
    { nombre: string; email: string; empresa: string; nit: string; plan: string; telefono: string } | undefined);
}
