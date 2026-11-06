import "server-only";
import type { Tx } from "./db";

export type ProductoEtiqueta = { id: string; nombre: string; laboratorio: string | null; ean: string | null; codigos: string[];
  precio_caja: number; precio_unidad: number | null; unidades_por_caja: number; copias: number };

const columnas = `p.id, p.nombre, p.laboratorio, p.ean, p.precio_caja::float, p.precio_unidad::float, p.unidades_por_caja,
  coalesce((select array_agg(pc.codigo order by pc.creado, pc.id) from producto_codigos pc where pc.producto_id = p.id), '{}') codigos`;

/** Productos para etiquetar: los elegidos (ids) o lo recibido en la compra N.º (una etiqueta por producto). La compra se
 *  lee por la vista de recepciones, que también ve la bodega (sin dinero). */
export async function productosEtiquetas(c: Tx, empresa: string, o: { ids?: string[]; compra?: number }) {
  if (o.compra !== undefined) {
    const k = (await c.query(`select id, numero, proveedor, numero_factura, estado from v_recepciones where empresa_id = $1 and numero = $2`, [empresa, o.compra])).rows[0];
    if (!k) return null;
    const productos: ProductoEtiqueta[] = (await c.query(`select ${columnas}, 1 copias from productos p
      where p.empresa_id = $1 and p.id in (select l.producto_id from v_recepcion_lineas l where l.compra_id = $2) order by p.nombre`, [empresa, k.id])).rows;
    return { compra: { numero: k.numero as number, proveedor: k.proveedor as string, factura: k.numero_factura as string, anulada: k.estado === "anulada" }, productos };
  }
  const ids = (o.ids ?? []).slice(0, 300);
  const productos: ProductoEtiqueta[] = ids.length ? (await c.query(`select ${columnas}, 1 copias from productos p where p.empresa_id = $1 and p.activo and p.id = any($2::uuid[])
    order by array_position($2::uuid[], p.id)`, [empresa, ids])).rows : [];
  return { compra: null, productos };
}
