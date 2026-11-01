import "server-only";
import { nuevoToken, hashToken } from "./claves";
import { SITIO } from "./sitio";
import type { Tx } from "./db";

export const ROLES = { dueno: "Dueño", admin: "Administrador", cajero: "Cajera/o", bodeguero: "Bodega" } as const;

/** Crea (o reutiliza por correo) una cuenta, la vuelve miembro de la empresa y genera su enlace de invitación (7 días). */
const negar = (m: string) => Object.assign(new Error(m), { code: "P0001" });

/** Las cuentas de superadministrador nunca se tocan desde la ficha de un cliente (ni enlace ni contraseña). */
async function exigirNoSuper(c: Tx, cuenta: string) {
  if ((await c.query(`select 1 from superadmins where user_id = $1`, [cuenta])).rowCount) throw negar("Ese correo es de un administrador de Regenta: usa otro correo para este cliente");
}

export async function invitar(c: Tx, empresa: string, d: { nombre: string; email: string; rol: keyof typeof ROLES }) {
  const e = (await c.query(`select demo from empresas where id = $1`, [empresa])).rows[0];
  if (!e) throw negar("Cliente no encontrado");
  if (e.demo) throw negar("A la droguería de demostración no se le agregan usuarios reales");
  const previa = (await c.query(`select id from cuentas where lower(email) = lower($1)`, [d.email])).rows[0];
  if (previa) await exigirNoSuper(c, previa.id);
  const cuenta = (await c.query(`insert into cuentas (email, nombre) values (lower($1), $2) on conflict ((lower(email))) do update set nombre = cuentas.nombre returning id, clave_hash is not null tiene_clave`, [d.email, d.nombre])).rows[0];
  await c.query(`insert into miembros (empresa_id, user_id, nombre, rol) values ($1, $2, $3, $4) on conflict (empresa_id, user_id) do update set rol = excluded.rol, activo = true, nombre = excluded.nombre`, [empresa, cuenta.id, d.nombre, d.rol]);
  const enlace = cuenta.tiene_clave ? null : await enlaceInvitacion(c, cuenta.id);
  return { cuenta_id: cuenta.id as string, enlace };
}

export async function enlaceInvitacion(c: Tx, cuenta: string) {
  await exigirNoSuper(c, cuenta);
  const t = nuevoToken();
  await c.query(`update invitaciones set usada = now() where cuenta_id = $1 and usada is null`, [cuenta]); // solo vale el último enlace
  await c.query(`insert into invitaciones (token_hash, cuenta_id, expira) values ($1, $2, now() + interval '7 days')`, [hashToken(t), cuenta]);
  return `${SITIO}/activar?t=${t}`;
}
