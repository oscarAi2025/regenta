import { puede } from "@/lib/sesion";
import { comoUsuario } from "@/lib/db";
import { conSesion, esUuid, json } from "@/lib/api";
import { ProductoEntrada, primerError } from "@/lib/validar";
import { cajaElegida } from "@/lib/caja-elegida";
import { entrarExistencia, leerExistencia } from "@/lib/existencia";

/** Edita un producto (precio, fracción, mínimo, datos) y, si viene, entra un lote con su vencimiento como inventario
 *  inicial en la misma transacción. El cambio de precio queda en la auditoría (trigger). */
export const PATCH = conSesion(async (s, req, ctx) => {
  if (!puede.verCostos(s.rol)) return json({ error: "Solo el dueño o el administrador cambian productos" }, 403); // el permiso se mira antes que los datos
  const { id } = await ctx.params;
  if (!esUuid(id)) return json({ error: "No encontrado" }, 404);
  const body = await req.json().catch(() => null);
  if (body && body.activo === false) {
    const n = await comoUsuario(s, async (c) => (await c.query(`update productos set activo = false where id = $1 and empresa_id = $2`, [id, s.empresa])).rowCount);
    return n ? json({ ok: true }) : json({ error: "No tienes permiso para retirar productos" }, 403);
  }
  const p = ProductoEntrada.safeParse(body);
  if (!p.success) return json({ error: primerError(p.error) }, 400);
  const ex = leerExistencia(body);
  if (ex && !ex.success) return json({ error: primerError(ex.error) }, 400);
  const d = p.data;
  if (d.unidades_por_caja === 1) d.precio_unidad = null;
  const caja = ex?.success ? await cajaElegida() : null;
  const n = await comoUsuario(s, async (c) => {
    if (d.ean) {
      const ya = (await c.query(`select nombre from productos where empresa_id = $1 and ean = $2 and activo and id <> $3`, [s.empresa, d.ean, id])).rows[0];
      if (ya) throw Object.assign(new Error(`Ya tienes otro producto con ese código de barras: ${ya.nombre}`), { code: "P0001" });
    }
    const n = (await c.query(
      `update productos set nombre = $3, laboratorio = $4, ean = nullif($5, ''), iva = $6, unidades_por_caja = $7, precio_caja = $8, precio_unidad = $9, stock_minimo = $10, registro_sanitario = nullif(upper($11), ''), categoria = $12,
         control_especial = coalesce($14, control_especial), requiere_formula = coalesce($13, requiere_formula) or coalesce($14, control_especial)
       where id = $1 and empresa_id = $2`,
      [id, s.empresa, d.nombre, d.laboratorio || null, d.ean ?? "", d.iva, d.unidades_por_caja, d.precio_caja, d.precio_unidad ?? null, d.stock_minimo, d.registro_sanitario ?? "", d.categoria ?? null,
        d.requiere_formula ?? null, d.control_especial ?? null])).rowCount;
    if (n && ex?.success) await entrarExistencia(c, s.empresa, caja, id, ex.data);
    return n;
  });
  return n ? json({ ok: true }) : json({ error: "No tienes permiso para editar productos" }, 403);
});
