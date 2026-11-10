import "server-only";
import { sinRLS } from "./db";
import { csv } from "./reportes";
import { zip } from "./zip";

// Copia completa de los datos de una droguería (términos, punto 5): un ZIP con CSV que abren en Excel. Lo descarga el dueño
// desde Mi droguería o la consola (también con la cuenta suspendida o terminada). Los XML y PDF de los documentos
// electrónicos están en la DIAN y en el proveedor de facturación: cada documento lleva su CUFE/CUDE y el enlace de consulta;
// los XML guardados (035) no van en esta copia (pesan mucho): se descargan desde Documentos DIAN.
const HOJAS: { archivo: string; sql: string; columnas: [string, string][] }[] = [
  { archivo: "productos.csv", sql: `select nombre, laboratorio, ean, registro_sanitario, categoria, iva, unidades_por_caja, precio_caja, precio_unidad, stock_minimo, case when requiere_formula then 'sí' else 'no' end venta_con_formula, case when control_especial then 'sí' else 'no' end control_especial, activo from productos where empresa_id = $1 order by nombre`,
    columnas: [["nombre", "Producto"], ["laboratorio", "Laboratorio"], ["ean", "Código de barras"], ["registro_sanitario", "Registro INVIMA"], ["categoria", "Categoría"], ["iva", "IVA %"], ["unidades_por_caja", "Unidades por caja"], ["precio_caja", "Precio caja"], ["precio_unidad", "Precio unidad"], ["stock_minimo", "Stock mínimo"], ["venta_con_formula", "Venta con fórmula"], ["control_especial", "Control especial"], ["activo", "Activo"]] },
  { archivo: "inventario_por_lote.csv", sql: `select p.nombre, p.ean, s.lote, to_char(s.vence, 'YYYY-MM-DD') vence, s.unidades, s.bloqueado,
      case lo.bloqueo_tipo when 'invima' then 'Alerta INVIMA' when 'cuarentena' then 'Cuarentena' when 'devolucion' then 'Devolución de cliente' end separado_por, lo.bloqueo_motivo, sd.nombre sede
      from v_stock_lotes s join lotes lo on lo.id = s.lote_id join productos p on p.id = s.producto_id join sedes sd on sd.id = s.sede_id where s.empresa_id = $1 and s.unidades <> 0 order by p.nombre, s.vence`,
    columnas: [["nombre", "Producto"], ["ean", "Código de barras"], ["lote", "Lote"], ["vence", "Vence"], ["unidades", "Unidades"], ["bloqueado", "Bloqueado"], ["separado_por", "Separado por"],
      ["bloqueo_motivo", "Motivo de la separación"], ["sede", "Sede"]] },
  { archivo: "codigos_alternos.csv", sql: `select p.nombre, p.ean, k.codigo, to_char(k.creado at time zone 'America/Bogota', 'YYYY-MM-DD') creado from producto_codigos k join productos p on p.id = k.producto_id where k.empresa_id = $1 order by p.nombre, k.codigo`,
    columnas: [["nombre", "Producto"], ["ean", "Código principal"], ["codigo", "Código alterno"], ["creado", "Agregado"]] },
  { archivo: "clientes.csv", sql: `select tipo_doc, numero_doc, dv, nombre, email, telefono, autoriza_datos, to_char(creado at time zone 'America/Bogota', 'YYYY-MM-DD') creado from clientes where empresa_id = $1 order by nombre`,
    columnas: [["tipo_doc", "Tipo de documento"], ["numero_doc", "Número"], ["dv", "DV"], ["nombre", "Nombre"], ["email", "Correo"], ["telefono", "Teléfono"], ["autoriza_datos", "Autoriza datos"], ["creado", "Registrado"]] },
  { archivo: "ventas.csv", sql: `select to_char(v.creado at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI') fecha, v.tipo_doc, v.prefijo, v.numero, c.nombre cliente, c.numero_doc, v.base, v.iva, v.total, v.devuelto, v.estado, v.condicion, cj.nombre caja, m.nombre vendedor,
      case when v.origen = 'alegra' then 'Cartera traída de Alegra (total = saldo pendiente)' else 'Regenta' end origen
      from ventas v left join clientes c on c.id = v.cliente_id left join cajas cj on cj.id = v.caja_id left join miembros m on m.user_id = v.usuario_id and m.empresa_id = v.empresa_id where v.empresa_id = $1 order by v.creado`,
    columnas: [["fecha", "Fecha"], ["tipo_doc", "Documento"], ["prefijo", "Prefijo"], ["numero", "Número"], ["cliente", "Cliente"], ["numero_doc", "Documento cliente"], ["base", "Base"], ["iva", "IVA"], ["total", "Total"], ["devuelto", "Devuelto"], ["estado", "Estado"], ["condicion", "Condición"], ["caja", "Caja"], ["vendedor", "Vendedor"], ["origen", "Origen"]] },
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
  // Bloque 3: documentos soporte, notas de ajuste y notas débito (con sus líneas), gastos y cambios de precio.
  { archivo: "documentos_soporte_y_notas.csv", sql: `select case d.tipo when 'soporte' then 'Documento soporte' when 'ajuste_soporte' then 'Nota de ajuste al documento soporte' else 'Nota débito' end tipo,
      d.prefijo || d.numero numero, to_char(d.creado at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI') fecha, coalesce(pr.nombre, cl.nombre) tercero, coalesce(pr.nit, cl.numero_doc) documento,
      (select string_agg(c.numero::text || ' (' || c.numero_factura || ')', ', ' order by c.numero) from soporte_compras sc join compras c on c.id = sc.compra_id where sc.documento_id = d.id) compras,
      o.prefijo || o.numero origen, d.concepto, d.motivo, to_char(d.periodo_desde, 'YYYY-MM-DD') periodo_desde, to_char(d.periodo_hasta, 'YYYY-MM-DD') periodo_hasta, d.base, d.iva, d.total, d.estado, d.cufe, d.simulado
      from documentos_dian d left join proveedores pr on pr.id = d.proveedor_id left join documentos_dian o on o.id = d.origen_id left join ventas v on v.id = o.venta_id left join clientes cl on cl.id = v.cliente_id
      where d.empresa_id = $1 and d.tipo in ('soporte', 'ajuste_soporte', 'nota_debito') order by d.creado`,
    columnas: [["tipo", "Tipo"], ["numero", "Número"], ["fecha", "Fecha"], ["tercero", "Proveedor o cliente"], ["documento", "NIT o documento"], ["compras", "Compras soportadas"], ["origen", "Documento de origen"],
      ["concepto", "Concepto"], ["motivo", "Motivo"], ["periodo_desde", "Periodo desde"], ["periodo_hasta", "Periodo hasta"], ["base", "Base"], ["iva", "IVA"], ["total", "Total"], ["estado", "Estado"], ["cufe", "CUDS/CUDE"], ["simulado", "Prueba"]] },
  { archivo: "documentos_soporte_y_notas_detalle.csv", sql: `select d.prefijo || d.numero numero, l.descripcion, l.codigo, l.cantidad, l.precio, l.iva_pct, l.base, l.iva, l.total
      from documento_lineas l join documentos_dian d on d.id = l.documento_id where l.empresa_id = $1 order by d.creado, l.id`,
    columnas: [["numero", "Documento"], ["descripcion", "Descripción"], ["codigo", "Código"], ["cantidad", "Cantidad"], ["precio", "Precio sin IVA"], ["iva_pct", "IVA %"], ["base", "Base"], ["iva", "IVA"], ["total", "Total"]] },
  { archivo: "gastos.csv", sql: `select 'G-' || g.numero numero, to_char(g.fecha, 'YYYY-MM-DD') fecha, categoria_gasto_texto(g.categoria) categoria, g.descripcion, g.medio, g.valor, g.referencia, cj.nombre caja,
      case when g.anulado then 'sí' else 'no' end anulado, g.motivo, to_char(g.creado at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI') registrado
      from gastos g left join cajas cj on cj.id = g.caja_id where g.empresa_id = $1 order by g.numero`,
    columnas: [["numero", "Gasto"], ["fecha", "Fecha"], ["categoria", "Categoría"], ["descripcion", "Descripción"], ["medio", "Medio"], ["valor", "Valor"], ["referencia", "Referencia"],
      ["caja", "Salió de la caja"], ["anulado", "Anulado"], ["motivo", "Motivo de anulación"], ["registrado", "Registrado"]] },
  { archivo: "cambios_de_precio.csv", sql: `select k.numero, to_char(k.creado at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI') fecha, k.descripcion, k.productos,
      to_char(k.revertido at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI') revertido, k.revertidos from cambios_precio k where k.empresa_id = $1 order by k.numero`,
    columnas: [["numero", "Cambio"], ["fecha", "Fecha"], ["descripcion", "Descripción"], ["productos", "Productos"], ["revertido", "Revertido"], ["revertidos", "Productos revertidos"]] },
  { archivo: "cambios_de_precio_detalle.csv", sql: `select k.numero, p.nombre producto, l.caja_antes, l.caja_despues, l.unidad_antes, l.unidad_despues, case when l.revertida then 'sí' else 'no' end revertida
      from cambio_precio_lineas l join cambios_precio k on k.id = l.cambio_id join productos p on p.id = l.producto_id where l.empresa_id = $1 order by k.numero, p.nombre`,
    columnas: [["numero", "Cambio"], ["producto", "Producto"], ["caja_antes", "Precio caja antes"], ["caja_despues", "Precio caja después"], ["unidad_antes", "Precio unidad antes"],
      ["unidad_despues", "Precio unidad después"], ["revertida", "Revertida"]] },
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
  // Bloque 2: recibos de caja de clientes, compras y proveedores, cuentas por pagar y pedidos del mostrador.
  { archivo: "recibos_caja.csv", sql: `select r.numero, to_char(r.creado at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI') fecha, c.nombre cliente, c.tipo_doc || ' ' || c.numero_doc documento, r.medio, r.valor, r.referencia, cj.nombre caja, r.saldo_anterior,
      (select string_agg(x ->> 'factura', ', ') from jsonb_array_elements(r.aplicado) x) facturas, case when r.anulado then 'sí' else 'no' end anulado, r.motivo
      from recibos_caja r join clientes c on c.id = r.cliente_id left join cajas cj on cj.id = r.caja_id where r.empresa_id = $1 order by r.numero`,
    columnas: [["numero", "Recibo"], ["fecha", "Fecha"], ["cliente", "Cliente"], ["documento", "Documento"], ["medio", "Medio"], ["valor", "Valor"], ["referencia", "Referencia"], ["caja", "Caja"],
      ["saldo_anterior", "Saldo anterior"], ["facturas", "Facturas abonadas"], ["anulado", "Anulado"], ["motivo", "Motivo de anulación"]] },
  { archivo: "proveedores.csv", sql: `select nombre, nit, dv, telefono, email, contacto, direccion, ciudad, plazo_dias, case when responsable_iva then 'sí' else 'no' end responsable_iva, case when activo then 'sí' else 'no' end activo from proveedores where empresa_id = $1 order by nombre`,
    columnas: [["nombre", "Proveedor"], ["nit", "NIT"], ["dv", "DV"], ["telefono", "Teléfono"], ["email", "Correo"], ["contacto", "Contacto"], ["direccion", "Dirección"], ["ciudad", "Ciudad"],
      ["plazo_dias", "Plazo (días)"], ["responsable_iva", "Responsable de IVA"], ["activo", "Activo"]] },
  { archivo: "compras.csv", sql: `select c.numero, to_char(c.fecha_factura, 'YYYY-MM-DD') fecha_factura, p.nombre proveedor, p.nit, c.numero_factura, c.condicion, to_char(c.vence_pago, 'YYYY-MM-DD') vence_pago,
      c.subtotal, c.descuento, c.iva, c.total, c.total_papel, c.estado, c.motivo_anulacion, to_char(c.creado at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI') registrada
      from compras c join proveedores p on p.id = c.proveedor_id where c.empresa_id = $1 order by c.numero`,
    columnas: [["numero", "Compra"], ["fecha_factura", "Fecha de la factura"], ["proveedor", "Proveedor"], ["nit", "NIT"], ["numero_factura", "Factura del proveedor"], ["condicion", "Condición"],
      ["vence_pago", "Vence el pago"], ["subtotal", "Subtotal"], ["descuento", "Descuento"], ["iva", "IVA"], ["total", "Total"], ["total_papel", "Total en la factura"], ["estado", "Estado"],
      ["motivo_anulacion", "Motivo de anulación"], ["registrada", "Registrada"]] },
  { archivo: "compras_detalle.csv", sql: `select c.numero, c.numero_factura, pr.nombre producto, lo.lote, to_char(lo.vence, 'YYYY-MM-DD') vence, l.unidades, l.bonificadas, l.costo, l.costo_por, l.descuento_pct, l.iva_pct, l.base, l.iva, l.total, l.costo_lote
      from compra_lineas l join compras c on c.id = l.compra_id join productos pr on pr.id = l.producto_id join lotes lo on lo.id = l.lote_id where l.empresa_id = $1 order by c.numero, l.id`,
    columnas: [["numero", "Compra"], ["numero_factura", "Factura del proveedor"], ["producto", "Producto"], ["lote", "Lote"], ["vence", "Vence"], ["unidades", "Unidades pagadas"], ["bonificadas", "Bonificadas"],
      ["costo", "Costo sin IVA"], ["costo_por", "Costo por"], ["descuento_pct", "Descuento %"], ["iva_pct", "IVA %"], ["base", "Base"], ["iva", "IVA"], ["total", "Total"], ["costo_lote", "Costo por unidad del lote"]] },
  { archivo: "pagos_proveedores.csv", sql: `select to_char(g.creado at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI') fecha, p.nombre proveedor, p.nit, g.medio, g.valor, g.referencia, cj.nombre caja,
      (select string_agg(c.numero_factura || ' (' || a.valor || ')', ', ' order by a.id) from pago_aplicaciones a join compras c on c.id = a.compra_id where a.pago_id = g.id) facturas,
      case when g.anulado then 'sí' else 'no' end anulado, g.motivo
      from pagos_proveedor g join proveedores p on p.id = g.proveedor_id left join cajas cj on cj.id = g.caja_id where g.empresa_id = $1 order by g.creado`,
    columnas: [["fecha", "Fecha"], ["proveedor", "Proveedor"], ["nit", "NIT"], ["medio", "Medio"], ["valor", "Valor"], ["referencia", "Referencia"], ["caja", "Salió de la caja"],
      ["facturas", "Facturas pagadas"], ["anulado", "Anulado"], ["motivo", "Motivo de anulación"]] },
  { archivo: "devoluciones_proveedores.csv", sql: `select d.numero, to_char(d.creado at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI') fecha, p.nombre proveedor, c.numero_factura, d.motivo, d.valor, d.estado, d.nc_proveedor, d.valor_nc
      from devoluciones_proveedor d join proveedores p on p.id = d.proveedor_id join compras c on c.id = d.compra_id where d.empresa_id = $1 order by d.numero`,
    columnas: [["numero", "Devolución"], ["fecha", "Fecha"], ["proveedor", "Proveedor"], ["numero_factura", "Factura del proveedor"], ["motivo", "Motivo"], ["valor", "Valor"], ["estado", "Estado"],
      ["nc_proveedor", "Nota crédito del proveedor"], ["valor_nc", "Valor de la nota crédito"]] },
  { archivo: "cuentas_por_pagar.csv", sql: `select proveedor, nit, numero, numero_factura, to_char(fecha_factura, 'YYYY-MM-DD') fecha_factura, to_char(vence_pago, 'YYYY-MM-DD') vence_pago, total, pagado, notas_credito, saldo, dias_vencida
      from v_cuentas_por_pagar where empresa_id = $1 and saldo > 0 order by vence_pago, proveedor`,
    columnas: [["proveedor", "Proveedor"], ["nit", "NIT"], ["numero", "Compra"], ["numero_factura", "Factura del proveedor"], ["fecha_factura", "Fecha de la factura"], ["vence_pago", "Vence"],
      ["total", "Total"], ["pagado", "Pagado"], ["notas_credito", "Notas crédito"], ["saldo", "Saldo"], ["dias_vencida", "Días vencida"]] },
  { archivo: "pedidos.csv", sql: `select case pm.tipo when 'espera' then 'Venta en espera' when 'domicilio' then 'Domicilio' else 'Cotización' end tipo, pm.numero, pm.estado,
      to_char(pm.creado at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI') fecha, coalesce(cl.nombre, pm.contacto) cliente, pm.telefono, pm.direccion, pm.nota, to_char(pm.vence, 'YYYY-MM-DD') vence,
      v.prefijo || v.numero venta, pm.motivo, (select count(*) from pedido_lineas pl where pl.pedido_id = pm.id) lineas
      from pedidos_mostrador pm left join clientes cl on cl.id = pm.cliente_id left join ventas v on v.id = pm.venta_id where pm.empresa_id = $1 order by pm.creado`,
    columnas: [["tipo", "Tipo"], ["numero", "Número"], ["estado", "Estado"], ["fecha", "Fecha"], ["cliente", "Cliente"], ["telefono", "Teléfono"], ["direccion", "Dirección"], ["nota", "Nota"],
      ["vence", "Válida hasta"], ["venta", "Venta"], ["motivo", "Motivo de cancelación"], ["lineas", "Productos"]] },
];

/** ZIP con todos los datos de la droguería y el nombre sugerido del archivo. */
export async function exportarEmpresa(empresa: string): Promise<{ nombre: string; datos: Buffer } | null> {
  return sinRLS(async (c) => {
    const e = (await c.query(`select nit, coalesce(nombre_comercial, razon_social) nombre from empresas where id = $1`, [empresa])).rows[0];
    if (!e) return null;
    const archivos: { nombre: string; datos: string }[] = [];
    for (const h of HOJAS) archivos.push({ nombre: h.archivo, datos: csv((await c.query(h.sql, [empresa])).rows, h.columnas) });
    archivos.push({ nombre: "LEEME.txt", datos: `Copia de los datos de ${e.nombre} (NIT ${e.nit}) en Regenta, generada el ${new Date().toLocaleString("es-CO", { timeZone: "America/Bogota" })}.\r\nLos archivos .csv se abren con Excel. Los documentos electrónicos se consultan en la DIAN con el CUFE/CUDE de documentos_dian.csv; sus XML se descargan en Regenta, en Documentos DIAN (uno a uno o en ZIP por fechas).\r\n` });
    const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
    return { nombre: `regenta-${e.nit}-${hoy}.zip`, datos: zip(archivos) };
  });
}
