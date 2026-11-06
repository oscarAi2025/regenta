import "server-only";
import { sinRLS } from "./db";
import { csv } from "./reportes";
import { zip } from "./zip";

// Copia completa de los datos de una droguería (términos, punto 5): un ZIP con CSV que abren en Excel. Lo descarga el dueño
// desde Mi droguería o la consola (también con la cuenta suspendida o terminada). Los XML y PDF de los documentos
// electrónicos están en la DIAN y en el proveedor de facturación: cada documento lleva su CUFE/CUDE y el enlace de consulta.
const HOJAS: { archivo: string; sql: string; columnas: [string, string][] }[] = [
  { archivo: "productos.csv", sql: `select nombre, laboratorio, ean, registro_sanitario, categoria, iva, unidades_por_caja, precio_caja, precio_unidad, stock_minimo, case when requiere_formula then 'sí' else 'no' end venta_con_formula, case when control_especial then 'sí' else 'no' end control_especial, activo from productos where empresa_id = $1 order by nombre`,
    columnas: [["nombre", "Producto"], ["laboratorio", "Laboratorio"], ["ean", "Código de barras"], ["registro_sanitario", "Registro INVIMA"], ["categoria", "Categoría"], ["iva", "IVA %"], ["unidades_por_caja", "Unidades por caja"], ["precio_caja", "Precio caja"], ["precio_unidad", "Precio unidad"], ["stock_minimo", "Stock mínimo"], ["venta_con_formula", "Venta con fórmula"], ["control_especial", "Control especial"], ["activo", "Activo"]] },
  { archivo: "inventario_por_lote.csv", sql: `select p.nombre, p.ean, s.lote, to_char(s.vence, 'YYYY-MM-DD') vence, s.unidades, s.bloqueado, sd.nombre sede from v_stock_lotes s join productos p on p.id = s.producto_id join sedes sd on sd.id = s.sede_id where s.empresa_id = $1 and s.unidades <> 0 order by p.nombre, s.vence`,
    columnas: [["nombre", "Producto"], ["ean", "Código de barras"], ["lote", "Lote"], ["vence", "Vence"], ["unidades", "Unidades"], ["bloqueado", "Bloqueado"], ["sede", "Sede"]] },
  { archivo: "clientes.csv", sql: `select tipo_doc, numero_doc, dv, nombre, email, telefono, autoriza_datos, to_char(creado at time zone 'America/Bogota', 'YYYY-MM-DD') creado from clientes where empresa_id = $1 order by nombre`,
    columnas: [["tipo_doc", "Tipo de documento"], ["numero_doc", "Número"], ["dv", "DV"], ["nombre", "Nombre"], ["email", "Correo"], ["telefono", "Teléfono"], ["autoriza_datos", "Autoriza datos"], ["creado", "Registrado"]] },
  { archivo: "ventas.csv", sql: `select to_char(v.creado at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI') fecha, v.tipo_doc, v.prefijo, v.numero, c.nombre cliente, c.numero_doc, v.base, v.iva, v.total, v.devuelto, v.estado, v.condicion, cj.nombre caja, m.nombre vendedor
      from ventas v left join clientes c on c.id = v.cliente_id left join cajas cj on cj.id = v.caja_id left join miembros m on m.user_id = v.usuario_id and m.empresa_id = v.empresa_id where v.empresa_id = $1 order by v.creado`,
    columnas: [["fecha", "Fecha"], ["tipo_doc", "Documento"], ["prefijo", "Prefijo"], ["numero", "Número"], ["cliente", "Cliente"], ["numero_doc", "Documento cliente"], ["base", "Base"], ["iva", "IVA"], ["total", "Total"], ["devuelto", "Devuelto"], ["estado", "Estado"], ["condicion", "Condición"], ["caja", "Caja"], ["vendedor", "Vendedor"]] },
  { archivo: "ventas_detalle.csv", sql: `select v.prefijo, v.numero, to_char(v.creado at time zone 'America/Bogota', 'YYYY-MM-DD') fecha, l.descripcion, l.presentacion, lo.lote, l.cantidad, l.unidades, l.precio, l.descuento, l.iva_pct, l.base, l.iva, l.total
      from venta_lineas l join ventas v on v.id = l.venta_id left join lotes lo on lo.id = l.lote_id where l.empresa_id = $1 order by v.creado, l.id`,
    columnas: [["prefijo", "Prefijo"], ["numero", "Número"], ["fecha", "Fecha"], ["descripcion", "Producto"], ["presentacion", "Presentación"], ["lote", "Lote"], ["cantidad", "Cantidad"], ["unidades", "Unidades"], ["precio", "Precio"], ["descuento", "Descuento"], ["iva_pct", "IVA %"], ["base", "Base"], ["iva", "IVA"], ["total", "Total"]] },
  { archivo: "pagos_de_ventas.csv", sql: `select v.prefijo, v.numero, p.medio, p.valor, p.referencia from pagos p join ventas v on v.id = p.venta_id where p.empresa_id = $1 order by v.creado`,
    columnas: [["prefijo", "Prefijo"], ["numero", "Número"], ["medio", "Medio"], ["valor", "Valor"], ["referencia", "Referencia"]] },
  { archivo: "cartera.csv", sql: `select v.prefijo, v.numero, c.nombre cliente, c.numero_doc, v.total, coalesce(a.abonado, 0) abonado, v.total - v.devuelto - coalesce(a.abonado, 0) saldo,
      to_char(v.vence_pago, 'YYYY-MM-DD') vence, greatest(0, current_date - v.vence_pago) dias_mora
      from ventas v join clientes c on c.id = v.cliente_id left join (select venta_id, sum(valor) abonado from abonos where not anulado group by venta_id) a on a.venta_id = v.id
      where v.empresa_id = $1 and v.condicion = 'credito' and v.estado = 'cerrada' and v.total - v.devuelto - coalesce(a.abonado, 0) > 0 order by v.vence_pago`,
    columnas: [["prefijo", "Prefijo"], ["numero", "Número"], ["cliente", "Cliente"], ["numero_doc", "Documento"], ["total", "Total"], ["abonado", "Abonado"], ["saldo", "Saldo"], ["vence", "Vence"], ["dias_mora", "Días de mora"]] },
  { archivo: "abonos.csv", sql: `select v.prefijo, v.numero, to_char(a.creado at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI') fecha, a.medio, a.valor, a.referencia, a.anulado from abonos a join ventas v on v.id = a.venta_id where a.empresa_id = $1 order by a.creado`,
    columnas: [["prefijo", "Prefijo"], ["numero", "Número"], ["fecha", "Fecha"], ["medio", "Medio"], ["valor", "Valor"], ["referencia", "Referencia"], ["anulado", "Anulado"]] },
  { archivo: "devoluciones.csv", sql: `select to_char(d.creado at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI') fecha, v.prefijo, v.numero, d.motivo, d.base, d.iva, d.total, d.medio from devoluciones d join ventas v on v.id = d.venta_id where d.empresa_id = $1 order by d.creado`,
    columnas: [["fecha", "Fecha"], ["prefijo", "Prefijo venta"], ["numero", "Número venta"], ["motivo", "Motivo"], ["base", "Base"], ["iva", "IVA"], ["total", "Total"], ["medio", "Medio"]] },
  { archivo: "documentos_dian.csv", sql: `select tipo, prefijo, numero, estado, cufe, qr, simulado, to_char(creado at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI') fecha from documentos_dian where empresa_id = $1 order by creado`,
    columnas: [["tipo", "Tipo"], ["prefijo", "Prefijo"], ["numero", "Número"], ["estado", "Estado"], ["cufe", "CUFE/CUDE"], ["qr", "Consulta DIAN"], ["simulado", "Prueba"], ["fecha", "Fecha"]] },
  { archivo: "movimientos_inventario.csv", sql: `select to_char(m.creado at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI') fecha, p.nombre, lo.lote, m.tipo, m.cantidad, m.motivo from movimientos m join productos p on p.id = m.producto_id left join lotes lo on lo.id = m.lote_id where m.empresa_id = $1 order by m.creado`,
    columnas: [["fecha", "Fecha"], ["nombre", "Producto"], ["lote", "Lote"], ["tipo", "Tipo"], ["cantidad", "Unidades"], ["motivo", "Motivo"]] },
  { archivo: "libro_control_especial.csv", sql: `select to_char(l.fecha at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI') fecha, case l.tipo when 'dispensacion' then 'Dispensación' else 'Reintegro' end movimiento,
      p.nombre producto, lo.lote, nullif(l.salida, 0) salida, nullif(l.reintegro, 0) reintegro, l.paciente_tipo_doc, l.paciente_doc, l.paciente_nombre, l.medico_nombre, l.medico_registro,
      l.formula_numero, to_char(l.formula_fecha, 'YYYY-MM-DD') formula_fecha, l.prefijo || l.numero venta, l.motivo
      from v_libro_control l join productos p on p.id = l.producto_id left join lotes lo on lo.id = l.lote_id where l.empresa_id = $1 order by l.fecha, l.id`,
    columnas: [["fecha", "Fecha"], ["movimiento", "Movimiento"], ["producto", "Producto"], ["lote", "Lote"], ["salida", "Salida (unidades)"], ["reintegro", "Reintegro (unidades)"],
      ["paciente_tipo_doc", "Tipo de documento"], ["paciente_doc", "Documento del paciente"], ["paciente_nombre", "Paciente"], ["medico_nombre", "Médico"], ["medico_registro", "Registro profesional"],
      ["formula_numero", "N.º de fórmula"], ["formula_fecha", "Fecha de la fórmula"], ["venta", "Venta"], ["motivo", "Observación"]] },
  { archivo: "turnos_de_caja.csv", sql: `select cj.nombre caja, to_char(t.abierto at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI') abierto, to_char(t.cerrado at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI') cerrado, t.base, t.efectivo_esperado, t.efectivo_contado, t.diferencia, t.observaciones from turnos t join cajas cj on cj.id = t.caja_id where t.empresa_id = $1 order by t.abierto`,
    columnas: [["caja", "Caja"], ["abierto", "Abierto"], ["cerrado", "Cerrado"], ["base", "Base"], ["efectivo_esperado", "Efectivo esperado"], ["efectivo_contado", "Efectivo contado"], ["diferencia", "Diferencia"], ["observaciones", "Observaciones"]] },
];

/** ZIP con todos los datos de la droguería y el nombre sugerido del archivo. */
export async function exportarEmpresa(empresa: string): Promise<{ nombre: string; datos: Buffer } | null> {
  return sinRLS(async (c) => {
    const e = (await c.query(`select nit, coalesce(nombre_comercial, razon_social) nombre from empresas where id = $1`, [empresa])).rows[0];
    if (!e) return null;
    const archivos: { nombre: string; datos: string }[] = [];
    for (const h of HOJAS) archivos.push({ nombre: h.archivo, datos: csv((await c.query(h.sql, [empresa])).rows, h.columnas) });
    archivos.push({ nombre: "LEEME.txt", datos: `Copia de los datos de ${e.nombre} (NIT ${e.nit}) en Regenta, generada el ${new Date().toLocaleString("es-CO", { timeZone: "America/Bogota" })}.\r\nLos archivos .csv se abren con Excel. Los XML y PDF de los documentos electrónicos se consultan en la DIAN con el CUFE/CUDE de documentos_dian.csv.\r\n` });
    const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
    return { nombre: `regenta-${e.nit}-${hoy}.zip`, datos: zip(archivos) };
  });
}
