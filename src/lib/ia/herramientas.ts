import "server-only";
import { comoUsuario, sinComodines } from "../db";
import { puede, type Sesion } from "../sesion";

// Herramientas de SOLO LECTURA que Regenta IA puede usar. Todas corren como el usuario (seguridad por fila):
// la IA ve exactamente lo que ese usuario ve, ni más ni menos. Los costos solo aparecen para dueño/administrador.

type Esquema = { type: "object"; properties: Record<string, { type: string; description: string }>; required?: string[] };
export type Herramienta = { name: string; description: string; input_schema: Esquema };

export const HERRAMIENTAS: Herramienta[] = [
  { name: "resumen_ventas", description: "Ventas cerradas de la droguería entre dos fechas (AAAA-MM-DD, zona Bogotá): total, número de ventas, ticket promedio, ventas por día, medios de pago y los productos más vendidos.",
    input_schema: { type: "object", properties: { desde: { type: "string", description: "Fecha inicial AAAA-MM-DD" }, hasta: { type: "string", description: "Fecha final AAAA-MM-DD (incluida)" } }, required: ["desde", "hasta"] } },
  { name: "buscar_producto", description: "Busca productos por nombre, laboratorio o código de barras. Devuelve precios, existencias vigentes, lotes con vencimiento, ritmo de venta y días de cobertura.",
    input_schema: { type: "object", properties: { texto: { type: "string", description: "Palabras del nombre o código de barras" } }, required: ["texto"] } },
  { name: "pedido_sugerido", description: "Productos que se venden y no alcanzan para los próximos 18 días, con las cajas sugeridas a pedir.",
    input_schema: { type: "object", properties: { limite: { type: "number", description: "Máximo de productos (por defecto 20)" } } } },
  { name: "riesgo_vencimiento", description: "Lotes que, al ritmo de venta actual, no se alcanzarán a vender antes de vencer (próximos 6 meses), con unidades y valor en riesgo.",
    input_schema: { type: "object", properties: { limite: { type: "number", description: "Máximo de lotes (por defecto 20)" } } } },
  { name: "sin_rotacion", description: "Productos con existencias que no se venden hace más de 45 días.",
    input_schema: { type: "object", properties: { limite: { type: "number", description: "Máximo de productos (por defecto 20)" } } } },
  { name: "alertas_invima", description: "Alertas sanitarias de medicamentos del INVIMA del último año y su cruce con el inventario (por lote, registro sanitario o nombre) y si ya se revisaron.",
    input_schema: { type: "object", properties: {} } },
  { name: "patron_semanal", description: "Qué días de la semana vende más o menos la droguería (últimas 8 semanas), como porcentaje frente al promedio.",
    input_schema: { type: "object", properties: {} } },
];

const fechaOk = (f: unknown) => (typeof f === "string" && /^\d{4}-\d{2}-\d{2}$/.test(f) ? f : null);
const limite = (n: unknown, def = 20) => Math.max(1, Math.min(50, Math.floor(Number(n) || def)));

/** Ejecuta una herramienta y devuelve datos en JSON (o un error legible para la IA). */
export async function ejecutar(s: Sesion, nombre: string, entrada: Record<string, unknown>): Promise<unknown> {
  const costos = puede.verCostos(s.rol);
  return comoUsuario(s, async (c) => {
    switch (nombre) {
      case "resumen_ventas": {
        const desde = fechaOk(entrada.desde), hasta = fechaOk(entrada.hasta);
        if (!desde || !hasta) return { error: "Fechas no válidas: usa AAAA-MM-DD" };
        const rango = `v.empresa_id = $1 and v.estado = 'cerrada' and (v.creado at time zone 'America/Bogota')::date between $2 and $3`;
        const total = (await c.query(`select count(*)::int ventas, coalesce(sum(total), 0)::float total, coalesce(round(avg(total)), 0)::float promedio from ventas v where ${rango}`, [s.empresa, desde, hasta])).rows[0];
        const dias = (await c.query(`select (v.creado at time zone 'America/Bogota')::date::text dia, count(*)::int ventas, sum(total)::float total from ventas v where ${rango} group by 1 order by 1`, [s.empresa, desde, hasta])).rows;
        const medios = (await c.query(`select p.medio, sum(p.valor - case when p.medio = 'efectivo' and p.primero then v.cambio else 0 end)::float valor from (select *, row_number() over (partition by venta_id, medio order by id) = 1 primero from pagos) p join ventas v on v.id = p.venta_id where ${rango} group by 1 order by 2 desc`, [s.empresa, desde, hasta])).rows;
        const top = (await c.query(`select l.descripcion producto, sum(l.unidades)::int unidades, sum(l.total)::float total from venta_lineas l join ventas v on v.id = l.venta_id where ${rango} group by 1 order by 3 desc limit 10`, [s.empresa, desde, hasta])).rows;
        return { desde, hasta, ...total, por_dia: dias.slice(-62), medios_de_pago: medios, mas_vendidos: top };
      }
      case "buscar_producto": {
        const t = String(entrada.texto ?? "").trim().toLowerCase().slice(0, 80);
        if (t.length < 2) return { error: "Escribe al menos 2 letras" };
        const palabras = t.split(/\s+/).slice(0, 6).map(sinComodines);
        return (await c.query(`select p.nombre, p.laboratorio, p.ean codigo_barras, p.registro_sanitario, p.unidades_por_caja, p.precio_caja::float, p.precio_unidad::float,
            pr.existencias, pr.venta_dia::float venta_por_dia, pr.dias_cobertura::float, pr.sugerido_cajas,
            (select json_agg(json_build_object('lote', l.lote, 'vence', l.vence, 'unidades', l.unidades) order by l.vence) from v_stock_lotes l where l.producto_id = p.id and l.unidades > 0) lotes
          from productos p join prediccion_productos($1) pr on pr.producto_id = p.id
          where p.empresa_id = $1 and p.activo and (p.ean = $2 or (select bool_and(lower(p.nombre || ' ' || coalesce(p.laboratorio, '')) like '%' || w || '%') from unnest($3::text[]) w))
          order by pr.venta_dia desc limit 8`, [s.empresa, t, palabras])).rows;
      }
      case "pedido_sugerido":
        return (await c.query(`select nombre, laboratorio, unidades_por_caja, existencias, venta_dia::float venta_por_dia, dias_cobertura::float, sugerido_cajas
          from prediccion_productos($1) where sugerido_unidades > 0 and venta_dia > 0 order by dias_cobertura nulls first limit $2`, [s.empresa, limite(entrada.limite)])).rows;
      case "riesgo_vencimiento":
        return (await c.query(`select nombre, lote, vence::text, dias, unidades, venta_dia::float venta_por_dia, unidades_en_riesgo ${costos ? ", valor_en_riesgo::float" : ""}
          from riesgo_vencimiento($1) order by coalesce(valor_en_riesgo, unidades_en_riesgo) desc limit $2`, [s.empresa, limite(entrada.limite)])).rows;
      case "sin_rotacion":
        return (await c.query(`select nombre, laboratorio, existencias, ultima_venta::text from prediccion_productos($1)
          where existencias > 0 and (ultima_venta is null or ultima_venta < current_date - 45) order by existencias desc limit $2`, [s.empresa, limite(entrada.limite)])).rows;
      case "alertas_invima":
        return (await c.query(`select numero, tipo, titulo, motivo, fecha::text, url, producto tu_producto, nivel coincidencia, lote, unidades, revisada from alertas_empresa($1) order by fecha desc limit 40`, [s.empresa])).rows;
      case "patron_semanal":
        return (await c.query(`select * from patron_semanal($1)`, [s.empresa])).rows;
      default:
        return { error: `Herramienta desconocida: ${nombre}` };
    }
  });
}
