import "server-only";
import { comoUsuario, sinComodines } from "../db";
import { puede, type Sesion } from "../sesion";
import { COSTO_POR_REVISAR, LOTE_COSTO_POR_REVISAR } from "../reportes";

// Herramientas de SOLO LECTURA que Regenta IA puede usar. Todas corren como el usuario (seguridad por fila):
// la IA ve exactamente lo que ese usuario ve, ni más ni menos. Los costos solo aparecen para dueño/administrador.

type Esquema = { type: "object"; properties: Record<string, { type: string; description: string }>; required?: string[] };
export type Herramienta = { name: string; description: string; input_schema: Esquema };

export const HERRAMIENTAS: Herramienta[] = [
  { name: "resumen_ventas", description: "Ventas de la droguería entre dos fechas (AAAA-MM-DD, zona Bogotá), netas de devoluciones como en Reportes: ventas brutas, devoluciones del periodo (por la fecha en que se hicieron), ventas netas (bruto menos devoluciones; usa esta cifra como «lo que vendió»), número de ventas, ticket promedio, ventas netas por día, lo cobrado por medio de pago y los productos más vendidos (netos de lo devuelto).",
    input_schema: { type: "object", properties: { desde: { type: "string", description: "Fecha inicial AAAA-MM-DD" }, hasta: { type: "string", description: "Fecha final AAAA-MM-DD (incluida)" } }, required: ["desde", "hasta"] } },
  { name: "buscar_producto", description: "Busca productos por nombre, laboratorio o código de barras. Devuelve precios, existencias vigentes, lotes con vencimiento, ritmo de venta y días de cobertura.",
    input_schema: { type: "object", properties: { texto: { type: "string", description: "Palabras del nombre o código de barras" } }, required: ["texto"] } },
  { name: "pedido_sugerido", description: "Productos que se venden de forma recurrente (en al menos 2 días distintos de las últimas 8 semanas; un pedido puntual no cuenta) y no alcanzan para los próximos 18 días. El ritmo viene en cajas_vendidas_por_dia (úsalo al hablar) y en unidades_sueltas_por_dia (tabletas o unidades sueltas, no cajas). Trae las cajas sugeridas a pedir, el precio de venta por caja y (dueño y administrador) el último costo, el margen y el valor estimado del pedido. Úsala para preguntas de qué pedir o cuánto vale el pedido en vez de buscar producto por producto (para el margen de lo YA vendido usa rentabilidad_productos).",
    input_schema: { type: "object", properties: { limite: { type: "number", description: "Máximo de productos (por defecto 20)" } } } },
  { name: "riesgo_vencimiento", description: "Lotes que, al ritmo de venta actual, no se alcanzarán a vender antes de vencer (próximos 6 meses), con unidades y valor en riesgo.",
    input_schema: { type: "object", properties: { limite: { type: "number", description: "Máximo de lotes (por defecto 20)" } } } },
  { name: "sin_rotacion", description: "Productos con existencias que no se venden hace más de 45 días y que tampoco se recibieron en esos 45 días (ultima_entrada = fecha del último lote recibido). Las existencias vienen en unidades sueltas y en cajas.",
    input_schema: { type: "object", properties: { limite: { type: "number", description: "Máximo de productos (por defecto 20)" } } } },
  { name: "alertas_invima", description: "Alertas sanitarias de medicamentos del INVIMA del último año y su cruce con el inventario (por lote, registro sanitario o nombre) y si ya se revisaron.",
    input_schema: { type: "object", properties: {} } },
  { name: "resumen_inventario", description: "Foto del inventario de hoy: productos activos, productos con existencias, unidades vendibles, lotes vencidos o bloqueados, lotes que vencen en 30 y 90 días, productos agotados y, para el dueño o el administrador, el valor del inventario a costo y los lotes sin costo (como en Inventario).",
    input_schema: { type: "object", properties: {} } },
  { name: "costos_proveedores", description: "Lo que le cuesta cada producto según las facturas de compra registradas (últimos 12 meses): por proveedor, el último costo por unidad sin IVA, el más bajo y la fecha; quién lo vende más barato y cuánto subió el costo. Úsala para «¿a quién le compro más barato…?», «¿subió el precio de…?» o para comparar proveedores.",
    input_schema: { type: "object", properties: { texto: { type: "string", description: "Producto o principio activo (opcional; sin texto, los productos con más compras)" }, proveedor: { type: "string", description: "Nombre del proveedor (opcional)" } } } },
  { name: "rentabilidad_productos", description: "Ganancia y margen REALES por producto entre dos fechas (AAAA-MM-DD, zona Bogotá), igual que Reportes: venta sin IVA neta de lo devuelto, costo de lo vendido con el costo del lote que salió en cada venta, ganancia y margen % sobre la venta sin IVA. Solo cuenta las líneas con costo válido; lo vendido sin costo o con costo por revisar se informa aparte y NO entra en el margen. Úsala para «¿qué me deja más?», «margen de…», «productos más rentables» o «los que menos dejan».",
    input_schema: { type: "object", properties: { desde: { type: "string", description: "Fecha inicial AAAA-MM-DD" }, hasta: { type: "string", description: "Fecha final AAAA-MM-DD (incluida)" },
      orden: { type: "string", description: "«ganancia» (por defecto), «margen» o «menor_margen»" }, limite: { type: "number", description: "Máximo de productos (por defecto 20)" } }, required: ["desde", "hasta"] } },
  { name: "patron_semanal", description: "Qué días de la semana vende más o menos la droguería (últimas 8 semanas), como porcentaje frente al promedio.",
    input_schema: { type: "object", properties: {} } },
];

const fechaOk = (f: unknown) => (typeof f === "string" && /^\d{4}-\d{2}-\d{2}$/.test(f) ? f : null);
const limite = (n: unknown, def = 20) => Math.max(1, Math.min(50, Math.floor(Number(n) || def)));

/** Ejecuta una herramienta y devuelve datos en JSON (o un error legible para la IA). */
/** Cifras del negocio (ventas totales, patrón semanal): solo dueño y administrador. */
const SOLO_GERENCIA = new Set(["resumen_ventas", "patron_semanal", "costos_proveedores", "rentabilidad_productos"]);
/** Inventario y predicción (qué pedir, qué no rota, qué se vence, alertas, foto del inventario): el vendedor no ve
 *  inventario en su menú (Navegacion.tsx), así que la IA tampoco se lo da; la cajera sí (sin costos), porque despacha FEFO. */
const PREDICCION = new Set(["pedido_sugerido", "riesgo_vencimiento", "sin_rotacion", "resumen_inventario", "alertas_invima"]);
const vePrediccion = (rol: string) => rol !== "vendedor";
export const herramientasPara = (rol: string) => HERRAMIENTAS.filter((h) => (puede.verCostos(rol as Sesion["rol"]) || !SOLO_GERENCIA.has(h.name)) && (vePrediccion(rol) || !PREDICCION.has(h.name)));

export async function ejecutar(s: Sesion, nombre: string, entrada: Record<string, unknown>): Promise<unknown> {
  const costos = puede.verCostos(s.rol);
  if (!costos && SOLO_GERENCIA.has(nombre)) return { error: "Esta consulta es solo para el dueño o el administrador de la droguería." };
  if (!vePrediccion(s.rol) && PREDICCION.has(nombre)) return { error: "Esta consulta no está disponible para el rol de vendedor." };
  return comoUsuario(s, async (c) => {
    switch (nombre) {
      case "resumen_ventas": {
        const desde = fechaOk(entrada.desde), hasta = fechaOk(entrada.hasta);
        if (!desde || !hasta) return { error: "Fechas no válidas: usa AAAA-MM-DD" };
        // Igual que Reportes (src/lib/reportes.ts, datosReporte): las ventas cerradas por su fecha y las devoluciones restan
        // el día en que se hacen (como su nota crédito). Antes la IA daba las ventas brutas sin restar devoluciones.
        const p = [s.empresa, desde, hasta];
        const rango = `v.empresa_id = $1 and v.origen is null and v.estado = 'cerrada' and (v.creado at time zone 'America/Bogota')::date between $2::date and $3::date`;
        const rangoD = `d.empresa_id = $1 and (d.creado at time zone 'America/Bogota')::date between $2::date and $3::date`;
        const t = (await c.query(`select count(*)::int ventas, coalesce(sum(total), 0)::float bruto from ventas v where ${rango}`, p)).rows[0] as { ventas: number; bruto: number };
        const dev = (await c.query(`select count(*)::int cantidad, coalesce(sum(total), 0)::float total from devoluciones d where ${rangoD}`, p)).rows[0] as { cantidad: number; total: number };
        const cent = (n: number) => Math.round(n * 100) / 100;
        const dias = (await c.query(`select dia::text, coalesce(v.ventas, 0)::int ventas, coalesce(v.bruto, 0)::float bruto, coalesce(d.devoluciones, 0)::float devoluciones,
            (coalesce(v.bruto, 0) - coalesce(d.devoluciones, 0))::float netas
          from (select (v.creado at time zone 'America/Bogota')::date dia, count(*) ventas, sum(total) bruto from ventas v where ${rango} group by 1) v
          full join (select (d.creado at time zone 'America/Bogota')::date dia, sum(total) devoluciones from devoluciones d where ${rangoD} group by 1) d using (dia)
          order by dia`, p)).rows;
        const medios = (await c.query(`select p.medio, sum(p.valor - case when p.medio = 'efectivo' and p.primero then v.cambio else 0 end)::float valor from (select *, row_number() over (partition by venta_id, medio order by id) = 1 primero from pagos) p join ventas v on v.id = p.venta_id where ${rango} group by 1 order by 2 desc`, p)).rows;
        const top = (await c.query(`select l.descripcion producto, (sum(l.unidades) - coalesce(sum(dv.unidades), 0))::int unidades, (sum(l.total) - coalesce(sum(dv.total), 0))::float total
          from venta_lineas l join ventas v on v.id = l.venta_id
          left join lateral (select sum(dl.unidades) unidades, sum(dl.total) total from devolucion_lineas dl where dl.venta_linea_id = l.id) dv on true
          where ${rango} group by l.producto_id, l.descripcion order by 3 desc limit 10`, p)).rows;
        return { desde, hasta, ventas: t.ventas, ventas_brutas: cent(t.bruto), devoluciones: { cantidad: dev.cantidad, total: cent(dev.total) }, ventas_netas: cent(t.bruto - dev.total),
          promedio: t.ventas ? Math.round(t.bruto / t.ventas) : 0, por_dia: dias.slice(-62),
          ...(dias.length > 62 ? { nota_por_dia: `Por día van solo los últimos 62 de ${dias.length} días del rango; los totales sí son de todo el rango.` } : {}),
          cobrado_por_medio_de_pago: medios, mas_vendidos: top };
      }
      case "buscar_producto": {
        const t = String(entrada.texto ?? "").trim().toLowerCase().slice(0, 80);
        if (t.length < 2) return { error: "Escribe al menos 2 letras" };
        const palabras = t.split(/\s+/).slice(0, 6).map(sinComodines);
        return (await c.query(`select p.nombre, p.laboratorio, p.ean codigo_barras, p.registro_sanitario, p.unidades_por_caja, p.precio_caja::float, p.precio_unidad::float,
            pr.existencias, pr.venta_dia::float venta_por_dia, pr.dias_cobertura::float, pr.sugerido_cajas,
            (select json_agg(json_build_object('lote', l.lote, 'vence', l.vence, 'unidades', l.unidades) order by l.vence) from v_stock_lotes l where l.producto_id = p.id and l.unidades > 0) lotes
          from productos p join prediccion_productos($1) pr on pr.producto_id = p.id
          where p.empresa_id = $1 and p.activo and (p.ean = $2 or (select bool_and(sin_tildes(p.nombre || ' ' || coalesce(p.laboratorio, '')) like '%' || sin_tildes(w) || '%') from unnest($3::text[]) w))
          order by pr.venta_dia desc limit 8`, [s.empresa, t, palabras])).rows;
      }
      case "pedido_sugerido": {
        // Con precio de venta (y, para dueño y administrador, último costo y margen) y el valor del pedido: así una sola
        // consulta responde «qué pido, cuánto vale y qué me deja más», sin buscar producto por producto.
        const filas = (await c.query(`select pr.nombre, pr.laboratorio, pr.unidades_por_caja, pr.existencias existencias_unidades,
            round(pr.venta_dia / greatest(pr.unidades_por_caja, 1), 2)::float cajas_vendidas_por_dia, pr.venta_dia::float unidades_sueltas_por_dia,
            pr.dias_cobertura::float, pr.sugerido_cajas, p.precio_caja::float precio_venta_caja,
            (case when e.responsable_iva then p.iva else 0 end)::float iva_venta
            ${costos ? `, (select lc.costo_unidad * greatest(pr.unidades_por_caja, 1) from lote_costos lc join lotes l on l.id = lc.lote_id
                 where l.producto_id = pr.producto_id order by l.creado desc limit 1)::float ultimo_costo_caja` : ""}
          from prediccion_productos($1) pr join productos p on p.id = pr.producto_id join empresas e on e.id = p.empresa_id
          where pr.sugerido_unidades > 0 and pr.venta_dia > 0 order by pr.dias_cobertura nulls first limit $2`, [s.empresa, limite(entrada.limite)])).rows;
        // Margen sobre la venta SIN IVA (el costo va sin IVA): igual que Reportes. Con IVA quedaba inflado ~16 puntos al 19 %.
        const conMargen = filas.map(({ iva_venta, ...f }) => costos && f.ultimo_costo_caja && f.precio_venta_caja
          ? { ...f, margen_pct: Math.round((1 - f.ultimo_costo_caja / (f.precio_venta_caja / (1 + iva_venta / 100))) * 1000) / 10, costo_pedido: Math.round(f.ultimo_costo_caja * f.sugerido_cajas) } : f);
        return conMargen;   // costo_pedido = último costo registrado × cajas sugeridas (sin costo registrado no viene)
      }
      case "riesgo_vencimiento":
        return (await c.query(`select nombre, lote, vence::text, dias, unidades, venta_dia::float venta_por_dia, unidades_en_riesgo ${costos ? ", valor_en_riesgo::float" : ""}
          from riesgo_vencimiento($1) order by coalesce(valor_en_riesgo, unidades_en_riesgo) desc limit $2`, [s.empresa, limite(entrada.limite)])).rows;
      case "sin_rotacion":
        // Quieto = con existencias, sin venta en 45 días y sin mercancía recibida en esos 45 días (lo que acaba de llegar
        // todavía no ha tenido tiempo de venderse: no es capital parado).
        return (await c.query(`select pr.nombre, pr.laboratorio, pr.existencias existencias_unidades, round(pr.existencias::numeric / greatest(pr.unidades_por_caja, 1), 1)::float cajas,
            pr.ultima_venta::text, (select max(l.creado at time zone 'America/Bogota')::date from lotes l where l.producto_id = pr.producto_id)::text ultima_entrada
          from prediccion_productos($1) pr
          where pr.existencias > 0 and (pr.ultima_venta is null or pr.ultima_venta < current_date - 45)
            and not exists (select 1 from lotes l where l.producto_id = pr.producto_id and l.creado >= now() - interval '45 days')
          order by pr.existencias desc limit $2`, [s.empresa, limite(entrada.limite)])).rows;
      case "alertas_invima":
        return (await c.query(`select numero, tipo, titulo, motivo, fecha::text, url, producto tu_producto, nivel coincidencia, lote, unidades, revisada from alertas_empresa($1) order by fecha desc limit 40`, [s.empresa])).rows;
      case "resumen_inventario": {
        // Mismas cifras que la pantalla Inventario: vendible = lotes vigentes y no bloqueados; valor a costo de lo vendible.
        const r = (await c.query(`select
            (select count(*) from productos p where p.empresa_id = $1 and p.activo)::int productos_activos,
            (select count(distinct s.producto_id) from v_stock_vigente s where s.empresa_id = $1 and s.unidades > 0)::int productos_con_existencias,
            (select coalesce(sum(s.unidades), 0) from v_stock_vigente s where s.empresa_id = $1 and s.unidades > 0)::int unidades_vendibles,
            (select count(*) from v_stock_lotes s where s.empresa_id = $1 and s.unidades > 0 and s.vence < current_date)::int lotes_vencidos,
            (select count(*) from v_stock_lotes s where s.empresa_id = $1 and s.unidades > 0 and s.bloqueado)::int lotes_bloqueados,
            (select count(*) from v_stock_vigente s where s.empresa_id = $1 and s.unidades > 0 and s.vence <= current_date + 30)::int lotes_vencen_30_dias,
            (select count(*) from v_stock_vigente s where s.empresa_id = $1 and s.unidades > 0 and s.vence <= current_date + 90)::int lotes_vencen_90_dias,
            (select count(*) from productos p where p.empresa_id = $1 and p.activo
               and not exists (select 1 from v_stock_vigente s where s.producto_id = p.id and s.unidades > 0))::int productos_agotados`, [s.empresa])).rows[0];
        if (!costos) return r;
        const v = (await c.query(`select coalesce(sum(s.unidades * lc.costo_unidad) filter (where not ${LOTE_COSTO_POR_REVISAR}), 0)::float valor,
            count(*) filter (where lc.lote_id is null)::int lotes_sin_costo, count(*) filter (where ${LOTE_COSTO_POR_REVISAR})::int lotes_costo_por_revisar
          from v_stock_vigente s join productos p on p.id = s.producto_id left join lote_costos lc on lc.lote_id = s.lote_id where s.empresa_id = $1 and s.unidades > 0`, [s.empresa])).rows[0];
        return { ...r, valor_inventario_a_costo: v.valor, lotes_sin_costo: v.lotes_sin_costo, lotes_costo_por_revisar: v.lotes_costo_por_revisar,
          nota: "El valor a costo no incluye los lotes sin costo ni los de costo por revisar (costo por unidad mayor que 3 veces el precio: se corrigen en Inventario)." };
      }
      case "costos_proveedores": {
        const palabras = String(entrada.texto ?? "").toLowerCase().split(/\s+/).filter(Boolean).slice(0, 5).map(sinComodines);
        const prov = sinComodines(String(entrada.proveedor ?? "").trim().toLowerCase());
        const filas = (await c.query(`
          with l as (
            select p.id producto_id, p.nombre producto, p.laboratorio, pr.nombre proveedor, c.fecha_factura, cl.costo_unidad_sin_iva::float costo
              from compra_lineas cl join compras c on c.id = cl.compra_id and c.estado <> 'anulada' join productos p on p.id = cl.producto_id
              join proveedores pr on pr.id = c.proveedor_id
             where c.empresa_id = $1 and c.fecha_factura >= current_date - 365 and cl.costo_unidad_sin_iva > 0
               and (cardinality($2::text[]) = 0 or (select bool_and(sin_tildes(lower(p.nombre || ' ' || coalesce(p.laboratorio, ''))) like '%' || sin_tildes(w) || '%') from unnest($2::text[]) w))
               and ($3 = '' or sin_tildes(lower(pr.nombre)) like '%' || sin_tildes($3) || '%'))
          select producto, laboratorio, proveedor, count(*)::int compras, min(costo) costo_minimo,
                 (array_agg(costo order by fecha_factura desc))[1] ultimo_costo, max(fecha_factura)::text ultima_compra,
                 (array_agg(costo order by fecha_factura asc))[1] primer_costo
            from l group by producto_id, producto, laboratorio, proveedor
            order by producto, ultimo_costo limit 60`, [s.empresa, palabras, prov])).rows;
        if (!filas.length) return { nota: "No hay compras con costo registradas para eso en los últimos 12 meses (las compras «por costear» no cuentan)." };
        return { costos_por_unidad_sin_iva: filas, nota: "Costos por unidad pagada, sin IVA, de las facturas registradas en Compras. «primer_costo» frente a «ultimo_costo» muestra si subió." };
      }
      case "rentabilidad_productos": {
        const desde = fechaOk(entrada.desde), hasta = fechaOk(entrada.hasta);
        if (!desde || !hasta) return { error: "Fechas no válidas: usa AAAA-MM-DD" };
        // Mismas reglas que Reportes (src/lib/reportes.ts): sin IVA, neto de devoluciones, costo del lote vendido; las líneas sin
        // costo o con costo por revisar no entran en el margen (se informan aparte). Las ventas anuladas no cuentan.
        const orden = entrada.orden === "margen" ? "margen_pct desc nulls last" : entrada.orden === "menor_margen" ? "margen_pct asc nulls last" : "ganancia desc";
        const OK = `lc.lote_id is not null and not ${COSTO_POR_REVISAR}`;
        const filas = (await c.query(`with x as (
            select l.producto_id, l.descripcion producto,
              coalesce(sum(l.unidades - coalesce(dv.unidades, 0)) filter (where ${OK}), 0) unidades,
              coalesce(sum(l.base - coalesce(dv.base, 0)) filter (where ${OK}), 0) venta,
              coalesce(sum((l.unidades - coalesce(dv.unidades, 0)) * lc.costo_unidad) filter (where ${OK}), 0) costo,
              coalesce(sum(l.base - coalesce(dv.base, 0)) filter (where not (${OK}) or lc.lote_id is null), 0) venta_sin_costo_valido
            from venta_lineas l join ventas v on v.id = l.venta_id left join lote_costos lc on lc.lote_id = l.lote_id
            left join lateral (select sum(dl.unidades) unidades, sum(dl.base) base from devolucion_lineas dl where dl.venta_linea_id = l.id) dv on true
            where v.empresa_id = $1 and v.origen is null and v.estado = 'cerrada' and (v.creado at time zone 'America/Bogota')::date between $2::date and $3::date
            group by l.producto_id, l.descripcion)
          select producto, unidades::int unidades_netas, round(venta, 2)::float venta_sin_iva, round(costo, 2)::float costo, round(venta - costo, 2)::float ganancia,
                 case when venta > 0 then round((venta - costo) / venta * 100, 1) end::float margen_pct, round(venta_sin_costo_valido, 2)::float venta_sin_costo_valido
          from x where venta > 0 or venta_sin_costo_valido > 0 order by ${orden} limit $4`, [s.empresa, desde, hasta, limite(entrada.limite)])).rows;
        if (!filas.length) return { nota: `No hay ventas cerradas entre ${desde} y ${hasta}.` };
        return { desde, hasta, productos: filas, nota: "Margen = ganancia / venta sin IVA, solo de lo vendido con costo válido. «venta_sin_costo_valido» es lo vendido sin costo registrado o con costo por revisar: no entra en el margen." };
      }
      case "patron_semanal":
        return (await c.query(`select * from patron_semanal($1)`, [s.empresa])).rows;
      default:
        return { error: `Herramienta desconocida: ${nombre}` };
    }
  });
}
