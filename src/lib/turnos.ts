import "server-only";
import { puestoDeTrabajo, type Tx } from "./db";

/** Estado del turno de la caja de este puesto (o el que se pida) con sus cifras en vivo. */
export async function estadoTurno(c: Tx, empresa: string) {
  const { caja_id } = await puestoDeTrabajo(c, empresa);
  const caja = caja_id ? (await c.query(`select id, nombre from cajas where id = $1`, [caja_id])).rows[0] : null;
  const exige = (await c.query(`select exige_turno from empresas where id = $1`, [empresa])).rows[0]?.exige_turno ?? false;
  const t = caja ? (await c.query(`select t.id, t.base::float, t.abierto, m.nombre abre from turnos t left join miembros m on m.empresa_id = t.empresa_id and m.user_id = t.abre_usuario
      where t.caja_id = $1 and t.estado = 'abierto'`, [caja.id])).rows[0] : null;
  if (!t) return { caja, exige, turno: null };
  const resumen = (await c.query(`select resumen_turno($1) r`, [t.id])).rows[0].r;
  const movimientos = (await c.query(`select mc.tipo, mc.valor::float, mc.concepto, mc.creado, m.nombre usuario from movimientos_caja mc
      left join miembros m on m.empresa_id = mc.empresa_id and m.user_id = mc.usuario_id where mc.turno_id = $1 order by mc.creado`, [t.id])).rows;
  return { caja, exige, turno: { ...t, resumen, movimientos } };
}

