import { comoUsuario } from "@/lib/db";
import { conSesion } from "@/lib/api";
import { puede } from "@/lib/sesion";
import { libroXlsx, type Columna } from "@/lib/xlsx";

/** Inventario completo en Excel: una hoja por producto (existencias, precios, valor) y otra por lote (vencimiento, estado).
 *  Los costos solo salen para quien los puede ver (dueño y administrador). */
export const GET = conSesion(async (s) => {
  const costos = puede.verCostos(s.rol);
  const d = await comoUsuario(s, async (c) => {
    const e = (await c.query(`select coalesce(nombre_comercial, razon_social) nombre from empresas where id = $1`, [s.empresa])).rows[0];
    const hoy = (await c.query(`select (now() at time zone 'America/Bogota')::date::text d`)).rows[0].d as string;
    const productos = (await c.query(`
      select p.ean, p.nombre, p.laboratorio, p.categoria, p.unidades_por_caja upc, p.precio_caja::float, p.precio_unidad::float, p.iva::float iva, p.stock_minimo,
        coalesce(st.vendibles, 0)::int vendibles, coalesce(st.no_vendibles, 0)::int no_vendibles, st.proximo::text proximo, coalesce(st.lotes, 0)::int lotes,
        ${costos ? "st.valor_costo::float valor_costo, st.sin_costo::int sin_costo" : "null::float valor_costo, 0 sin_costo"}
      from productos p left join lateral (
        select sum(unidades) filter (where (vence is null or vence >= current_date) and not bloqueado) vendibles,
               sum(unidades) filter (where vence < current_date or bloqueado) no_vendibles,
               min(vence) filter (where unidades > 0 and (vence is null or vence >= current_date)) proximo,
               count(*) filter (where unidades > 0) lotes
               ${costos ? ", sum(s.unidades * lc.costo_unidad) filter (where s.unidades > 0) valor_costo, count(*) filter (where s.unidades > 0 and lc.lote_id is null) sin_costo" : ""}
        from v_stock_lotes s ${costos ? "left join lote_costos lc on lc.lote_id = s.lote_id" : ""} where s.producto_id = p.id) st on true
      where p.empresa_id = $1 and p.activo order by p.nombre`, [s.empresa])).rows;
    const lotes = (await c.query(`
      select p.ean, p.nombre, p.laboratorio, s.lote, s.vence::text vence, (s.vence - current_date) dias, s.unidades, p.unidades_por_caja upc, s.bloqueado, l.bloqueo_tipo,
        ${costos ? "lc.costo_unidad::float costo" : "null::float costo"}
      from v_stock_lotes s join productos p on p.id = s.producto_id join lotes l on l.id = s.lote_id ${costos ? "left join lote_costos lc on lc.lote_id = s.lote_id" : ""}
      where s.empresa_id = $1 and s.unidades > 0 and p.activo order by p.nombre, s.vence nulls last, s.lote`, [s.empresa])).rows;
    return { e, hoy, productos, lotes };
  });

  const P: Columna[] = [
    { titulo: "Código de barras", ancho: 17, tipo: "texto" }, { titulo: "Producto", ancho: 46, tipo: "texto" }, { titulo: "Laboratorio", ancho: 22, tipo: "texto" },
    { titulo: "Categoría", ancho: 16, tipo: "texto" }, { titulo: "Unidades por caja", ancho: 10, tipo: "entero" },
    { titulo: "Existencias vendibles (und)", ancho: 13, tipo: "entero" }, { titulo: "Cajas completas", ancho: 10, tipo: "entero" },
    { titulo: "Vencidas o separadas (und)", ancho: 13, tipo: "entero" }, { titulo: "Lotes con existencias", ancho: 10, tipo: "entero" },
    { titulo: "Próximo vencimiento", ancho: 13, tipo: "fecha" }, { titulo: "Stock mínimo (und)", ancho: 10, tipo: "entero" }, { titulo: "Estado", ancho: 16, tipo: "texto" },
    { titulo: "Precio caja (IVA incl.)", ancho: 14, tipo: "pesos" }, { titulo: "Precio unidad (IVA incl.)", ancho: 14, tipo: "pesos" }, { titulo: "IVA", ancho: 7, tipo: "porcentaje" },
    ...(costos ? [{ titulo: "Valor a costo", ancho: 15, tipo: "pesos" } as Columna] : []),
    { titulo: "Valor a precio de venta", ancho: 16, tipo: "pesos" },
  ];
  const estado = (x: { vendibles: number; stock_minimo: number }) => (x.vendibles <= 0 ? "Agotado" : x.stock_minimo > 0 && x.vendibles <= x.stock_minimo ? "Bajo el mínimo" : "Disponible");
  const filasP = d.productos.map((x) => [
    x.ean, x.nombre, x.laboratorio ?? "", x.categoria, x.upc, x.vendibles, x.upc > 1 ? Math.floor(x.vendibles / x.upc) : x.vendibles, x.no_vendibles, x.lotes,
    x.proximo, x.stock_minimo, estado(x), x.precio_caja, x.precio_unidad, (x.iva ?? 0) / 100,
    ...(costos ? [x.valor_costo === null ? null : Math.round(x.valor_costo)] : []),
    Math.round((x.vendibles / Math.max(x.upc, 1)) * x.precio_caja),
  ]);
  const L: Columna[] = [
    { titulo: "Código de barras", ancho: 17, tipo: "texto" }, { titulo: "Producto", ancho: 46, tipo: "texto" }, { titulo: "Laboratorio", ancho: 22, tipo: "texto" },
    { titulo: "Lote", ancho: 16, tipo: "texto" }, { titulo: "Vence", ancho: 12, tipo: "fecha" }, { titulo: "Días para vencer", ancho: 10, tipo: "entero" },
    { titulo: "Unidades", ancho: 10, tipo: "entero" }, { titulo: "Cajas completas", ancho: 10, tipo: "entero" }, { titulo: "Estado", ancho: 22, tipo: "texto" },
    ...(costos ? [{ titulo: "Costo por unidad", ancho: 14, tipo: "pesos" } as Columna, { titulo: "Valor a costo", ancho: 15, tipo: "pesos" } as Columna] : []),
  ];
  const BLOQUEO: Record<string, string> = { invima: "Alerta INVIMA: no se vende", cuarentena: "Cuarentena: no se vende", devolucion: "Devolución en revisión" };
  const filasL = d.lotes.map((x) => [
    x.ean, x.nombre, x.laboratorio ?? "", x.lote, x.vence, x.dias, x.unidades, x.upc > 1 ? Math.floor(x.unidades / x.upc) : x.unidades,
    x.bloqueado ? BLOQUEO[x.bloqueo_tipo] ?? "Separado: no se vende" : x.dias !== null && x.dias < 0 ? "Vencido: no se vende" : x.dias !== null && x.dias <= 90 ? "Vence en 90 días o menos" : "Vigente",
    ...(costos ? [x.costo, x.costo === null ? null : Math.round(x.costo * x.unidades)] : []),
  ]);
  const libro = libroXlsx([{ nombre: "Productos", columnas: P, filas: filasP }, { nombre: "Lotes", columnas: L, filas: filasL }]);
  const archivo = `inventario-${String(d.e?.nombre ?? "drogueria").normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").toLowerCase()}-${d.hoy}.xlsx`;
  return new Response(Buffer.from(libro), { headers: {
    "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "content-disposition": `attachment; filename="${archivo}"`, "cache-control": "private, no-store",
  } });
});
