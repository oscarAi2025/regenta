// Resumen completo de un turno, leído como el dueño de su droguería. Desde el cierre ciego (auditoría 17/11/2026, AUD-02)
// la cajera ya no recibe el efectivo esperado ni las ventas por medio de pago mientras el turno está abierto: las pruebas
// que comprueban esas cifras las leen así.
export async function resumenTurno(pool, turno) {
  const c = await pool.connect();
  try {
    await c.query("begin");
    const emp = (await c.query(`select empresa_id from turnos where id = $1`, [turno])).rows[0].empresa_id;
    const uid = (await c.query(`select user_id from miembros where empresa_id = $1 and rol = 'dueno' and activo order by creado limit 1`, [emp])).rows[0].user_id;
    await c.query("select set_config('request.jwt.claims', $1, true)", [JSON.stringify({ sub: uid, role: "authenticated" })]);
    await c.query("set local role authenticated");
    return (await c.query(`select resumen_turno($1) r`, [turno])).rows[0].r;
  } finally { await c.query("rollback").catch(() => {}); c.release(); }
}
