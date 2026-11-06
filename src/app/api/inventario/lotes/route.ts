import { comoUsuario } from "@/lib/db";
import { conSesion, esUuid, json } from "@/lib/api";
import { puede } from "@/lib/sesion";

/** Lotes de un producto con sus existencias (también vencidos, bloqueados o en cero), o todos los lotes vencidos con
 *  existencias (?vencidos=1) para darlos de baja de una vez. Para ajustes y conteos: dueño, administrador o bodega. */
export const GET = conSesion(async (s, req) => {
  if (!puede.moverInventario(s.rol)) return json({ error: "Solo el dueño, el administrador o la bodega ajustan el inventario" }, 403);
  const sp = new URL(req.url).searchParams;
  const producto = sp.get("producto") ?? "", vencidos = sp.get("vencidos") === "1";
  if (!vencidos && !esUuid(producto)) return json({ error: "Elige un producto" }, 400);
  const costo = puede.verCostos(s.rol) ? "(select costo_unidad::float from lote_costos lc where lc.lote_id = s.lote_id)" : "null::float";
  const lotes = await comoUsuario(s, async (c) => (await c.query(
    `select s.lote_id, s.lote, s.vence::text, s.unidades, s.bloqueado, (s.vence < current_date) vencido, ${costo} costo,
            p.id producto_id, p.nombre, p.laboratorio, p.unidades_por_caja
     from v_stock_lotes s join productos p on p.id = s.producto_id
     where s.empresa_id = $1 and ${vencidos ? "s.vence < current_date and s.unidades > 0" : "s.producto_id = $2"}
     order by ${vencidos ? "p.nombre, s.vence" : "(s.unidades > 0) desc, s.vence nulls last, s.lote"} limit 500`,
    vencidos ? [s.empresa] : [s.empresa, producto])).rows);
  return json({ lotes });
});
