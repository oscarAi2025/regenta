import { comoUsuario } from "@/lib/db";
import { conSesion, esUuid, json } from "@/lib/api";
import { pistas } from "@/lib/alternativas";
import { puede } from "@/lib/sesion";

/** Para no perder la venta: productos con existencias parecidos a uno agotado (mismo principio activo y, si se
 *  conoce, la misma concentración). */
export const GET = conSesion(async (s, req) => {
  if (!puede.vender(s.rol)) return json({ error: "No tienes permiso" }, 403);
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!esUuid(id)) return json({ error: "Producto no válido" }, 400);
  const productos = await comoUsuario(s, async (c) => {
    const base = (await c.query(`select nombre from productos where id = $1 and empresa_id = $2`, [id, s.empresa])).rows[0];
    if (!base) return [];
    const { principio, concentracion } = pistas(base.nombre);
    if (!principio) return [];
    // Concentración como número completo (500 no debe coincidir con 1500 ni con 5000).
    const conc = concentracion ? `(^|[^0-9.,])${concentracion.valor.replace(".", "[.,]")}\\s*${concentracion.unidad}` : null;
    return (await c.query(
      `select p.id, p.nombre, p.laboratorio, p.ean, p.iva::float, p.unidades_por_caja, p.precio_caja::float, p.precio_unidad::float,
              p.stock_minimo, st.unidades::int, st.proximo_vence::text, false as exacto, p.requiere_formula, p.control_especial
       from productos p
       join lateral (select sum(unidades) unidades, min(vence) filter (where unidades > 0) proximo_vence from v_stock_vigente where producto_id = p.id) st on true
       where p.empresa_id = $1 and p.activo and p.id <> $2 and st.unidades > 0
         and translate(lower(p.nombre), 'áéíóúü', 'aeiouu') like '%' || $3 || '%'
         and ($4::text is null or translate(lower(p.nombre), 'áéíóúü', 'aeiouu') ~ $4)
       order by st.unidades desc limit 5`, [s.empresa, id, principio, conc])).rows;
  });
  return json({ productos });
});
