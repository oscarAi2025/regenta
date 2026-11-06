import "server-only";
import type { Tx } from "./db";

export type LoteSeparado = { lote_id: string; lote: string; vence: string | null; vencido: boolean; unidades: number; producto_id: string; nombre: string;
  laboratorio: string | null; unidades_por_caja: number; tipo: "invima" | "cuarentena" | "devolucion"; motivo: string | null; desde: string | null; dias: number | null };

/** Lotes separados con existencias (cuarentena, devoluciones en revisión y alertas del INVIMA), los más viejos primero. */
export async function lotesSeparados(c: Tx, empresa: string): Promise<LoteSeparado[]> {
  return (await c.query(`select l.id lote_id, l.lote, l.vence::text, coalesce(l.vence < current_date, false) vencido, s.unidades, p.id producto_id, p.nombre, p.laboratorio,
      p.unidades_por_caja, l.bloqueo_tipo tipo, l.bloqueo_motivo motivo, to_char(l.bloqueo_desde at time zone 'America/Bogota', 'DD/MM/YYYY HH24:MI') desde,
      (current_date - (l.bloqueo_desde at time zone 'America/Bogota')::date)::int dias
    from lotes l join v_stock_lotes s on s.lote_id = l.id join productos p on p.id = l.producto_id
    where l.empresa_id = $1 and l.bloqueado and s.unidades > 0
    order by (l.bloqueo_tipo = 'invima'), l.bloqueo_desde nulls first, p.nombre limit 500`, [empresa])).rows;
}
