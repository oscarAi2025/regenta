import "server-only";
import type { Tx } from "./db";
import { pesosExactos } from "./compras";
import { nombreCategoria } from "./gastos";
import { fechaValida } from "./reportes";

// Bitácora del dueño: lo que pasó en la droguería que conviene revisar (precios, anulaciones, devoluciones, descuentos sobre
// el tope de la cajera, ajustes y bajas, turnos con diferencia, crédito de clientes, rangos de temperatura, equipo y
// configuración), escrito en español. Sale de la tabla auditoria (solo la leen el dueño y el administrador) y, para los
// descuentos, de las líneas de venta con un descuento mayor al tope que hoy tiene la cajera.

export const TIPOS_BITACORA: Record<string, { nombre: string; acciones: string[] }> = {
  precio: { nombre: "Precios y costos", acciones: ["cambio_precio", "completar_costo", "corregir_costo"] },
  anulacion: { nombre: "Anulaciones", acciones: ["anular_venta", "anular_compra", "anular_pago_proveedor", "anular_recibo", "anular_abono", "anular_gasto", "anular_conteo", "pedido_cancelado"] },
  devolucion: { nombre: "Devoluciones", acciones: ["devolucion", "devolucion_proveedor", "nc_proveedor"] },
  descuento: { nombre: "Descuentos sobre el tope", acciones: [] },
  ajuste: { nombre: "Ajustes y bajas", acciones: ["ajuste_inventario", "entrada_ajuste"] },
  turno: { nombre: "Turnos y caja", acciones: ["cerrar_turno", "venta_sin_turno", "venta_sin_conexion"] },
  credito: { nombre: "Crédito de clientes", acciones: ["credito_cliente", "mora_bloqueo", "credito_autorizado"] },
  rango: { nombre: "Rangos de temperatura", acciones: ["rango_temperatura"] },
  dian: { nombre: "Documentos DIAN", acciones: ["nota_debito", "documento_soporte", "ajuste_soporte", "reenviar_dian"] },
  compras: { nombre: "Compras y gastos", acciones: ["registrar_gasto", "cargos_compra"] },
  configuracion: { nombre: "Equipo y configuración", acciones: ["configurar_empresa", "configurar_formulas", "cambio_formula", "cambiar_usuario", "invitar_usuario", "crear_caja", "cambiar_caja"] },
};
const TIPO_DE: Record<string, string> = Object.fromEntries(Object.entries(TIPOS_BITACORA).flatMap(([t, x]) => x.acciones.map((a) => [a, t])));
TIPO_DE.descuento_sobre_tope = "descuento";

export type FiltroBitacora = { tipo: string; usuario: string; desde: string; hasta: string; pagina: number };
export function filtroBitacora(sp: Record<string, string | undefined> | URLSearchParams): FiltroBitacora {
  const g = (k: string) => (sp instanceof URLSearchParams ? sp.get(k) : sp[k]) ?? "";
  const pagina = Math.max(1, Math.min(10000, Math.floor(Number(g("pagina")) || 1)));
  let desde = fechaValida(g("desde")) ? g("desde") : "", hasta = fechaValida(g("hasta")) ? g("hasta") : "";
  if (desde && hasta && desde > hasta) [desde, hasta] = [hasta, desde];
  return { tipo: g("tipo") in TIPOS_BITACORA ? g("tipo") : "", usuario: /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(g("usuario")) ? g("usuario").toLowerCase() : "", desde, hasta, pagina };
}

export type FilaBitacora = { clave: string; fecha: string; usuario: string; tipo: string; tipo_nombre: string; titulo: string; detalle: string };
export const POR_PAGINA = 50;

type Cruda = { clave: string; fecha: string; usuario: string | null; accion: string; entidad_id: string | null; datos: Record<string, unknown> | null;
  producto: string | null; venta: string | null; cliente: string | null; caja: string | null; miembro: string | null; lote: string | null };

/** Una página de la bitácora (50 eventos, más recientes primero) y el total de eventos con esos filtros. */
export async function bitacora(c: Tx, empresa: string, f: FiltroBitacora) {
  const acciones = f.tipo ? TIPOS_BITACORA[f.tipo].acciones : Object.values(TIPOS_BITACORA).flatMap((x) => x.acciones);
  const descuentos = !f.tipo || f.tipo === "descuento";
  const p: unknown[] = [empresa, acciones, f.usuario || null, f.desde || null, f.hasta || null, descuentos, POR_PAGINA, (f.pagina - 1) * POR_PAGINA];
  const fechas = (col: string) => `($4::date is null or ${col} >= ($4::date::timestamp at time zone 'America/Bogota'))
    and ($5::date is null or ${col} < (($5::date + 1)::timestamp at time zone 'America/Bogota'))`;
  const r = (await c.query(`
    with ev as (
      select 'a' || a.id clave, a.creado, a.usuario_id, a.soporte_id, a.accion, a.entidad, a.entidad_id, a.datos
      from auditoria a
      where a.empresa_id = $1 and a.accion = any ($2::text[]) and ($3::uuid is null or a.usuario_id = $3::uuid) and ${fechas("a.creado")}
        and (a.accion <> 'cerrar_turno' or coalesce((a.datos ->> 'diferencia')::numeric, 0) <> 0)
        -- Un ajuste de la pantalla de ajustes o del conteo deja dos registros (el ajuste y la entrada): se muestra el ajuste.
        and not (a.accion = 'entrada_ajuste' and exists (select 1 from auditoria b where b.empresa_id = a.empresa_id and b.accion = 'ajuste_inventario' and b.creado = a.creado))
      union all
      select 'd' || v.id, v.creado, v.usuario_id, null::uuid, 'descuento_sobre_tope', 'ventas', v.id::text,
             jsonb_build_object('pct', max(l.descuento_pct), 'descuento', sum(l.descuento), 'tope', e.descuento_max_cajero, 'total', v.total)
      from ventas v join empresas e on e.id = v.empresa_id join venta_lineas l on l.venta_id = v.id and l.descuento_pct > 0
      where $6::boolean and v.empresa_id = $1 and l.descuento_pct > e.descuento_max_cajero and ($3::uuid is null or v.usuario_id = $3::uuid) and ${fechas("v.creado")}
      group by v.id, e.descuento_max_cajero
    ), pagina as (
      select *, count(*) over () total from ev order by creado desc, clave desc limit $7 offset $8
    )
    select x.clave, x.total::int total, to_char(x.creado at time zone 'America/Bogota', 'DD/MM/YYYY HH24:MI') fecha,
           case when x.soporte_id is not null then coalesce(m.nombre, 'Dueño') || ' (soporte de Regenta)' else m.nombre end usuario, x.accion, x.entidad_id, x.datos,
           pr.nombre producto, coalesce(vt.prefijo || vt.numero, '') venta, cl.nombre cliente, cj.nombre caja, mb.nombre miembro, lo.lote || ' de ' || plo.nombre lote
    from pagina x
    left join miembros m on m.empresa_id = $1 and m.user_id = x.usuario_id
    left join productos pr on x.entidad = 'productos' and pr.empresa_id = $1 and pr.id::text = x.entidad_id
    left join ventas vt on x.entidad = 'ventas' and vt.empresa_id = $1 and vt.id::text = x.entidad_id
    left join clientes cl on x.entidad = 'clientes' and cl.empresa_id = $1 and cl.id::text = x.entidad_id
    left join turnos tu on x.entidad = 'turnos' and tu.empresa_id = $1 and tu.id::text = x.entidad_id
    left join cajas cj on cj.id = tu.caja_id
    left join miembros mb on x.entidad = 'miembros' and mb.empresa_id = $1 and mb.user_id::text = x.entidad_id
    left join lotes lo on x.entidad = 'lotes' and lo.empresa_id = $1 and lo.id::text = x.entidad_id
    left join productos plo on plo.id = lo.producto_id
    order by x.creado desc, x.clave desc`, p)).rows as (Cruda & { total: number })[];
  const total = r[0]?.total ?? 0; // una página más allá del final llega vacía: la pantalla ofrece volver a la primera
  return { filas: r.map(describir), total, paginas: Math.max(1, Math.ceil(total / POR_PAGINA)) };
}

const nombre = (s: string | null) => String(s ?? "").split(" (")[0];
const $ = (v: unknown) => pesosExactos(Number(v ?? 0));
const motivo = (d: Record<string, unknown>) => (d.motivo ? ` Motivo: «${String(d.motivo)}».` : "");
const MEDIOS: Record<string, string> = { efectivo: "efectivo", transferencia: "transferencia", nequi: "Nequi", daviplata: "Daviplata", tarjeta: "tarjeta", bre_b: "Bre-B", qr: "QR", consignacion: "consignación", cheque: "cheque" };
const ROLES: Record<string, string> = { dueno: "dueño", admin: "administrador", cajero: "cajera", bodeguero: "bodega", vendedor: "vendedor" };
const MOTIVOS_AJUSTE: Record<string, string> = { vencido: "vencido", averia: "avería o rotura", perdida: "pérdida o robo", conteo: "diferencia de conteo", devolucion_proveedor: "devolución a proveedor", otro: "otro" };
const AREAS: Record<string, string> = { general: "área general", frio: "cadena de frío" };
const cambio = (a: unknown, b: unknown, f: (v: unknown) => string) => (a === b || JSON.stringify(a) === JSON.stringify(b) ? null : `${f(a)} → ${f(b)}`);
const precio = (v: unknown) => (v === null || v === undefined ? "sin precio" : $(v));
const sino = (v: unknown) => (v ? "sí" : "no");
const num = (v: unknown) => String(v ?? "—").replace(".", ",");

function describir(x: Cruda): FilaBitacora {
  const d = (x.datos ?? {}) as Record<string, unknown>;
  const a = (d.antes ?? {}) as Record<string, unknown>, z = (d.despues ?? {}) as Record<string, unknown>;
  let titulo = x.accion, detalle = "";
  switch (x.accion) {
    case "cambio_precio": {
      titulo = "Cambio de precio";
      const partes = [cambio(a.caja, z.caja, precio) && `caja ${cambio(a.caja, z.caja, precio)}`, cambio(a.unidad, z.unidad, precio) && `unidad ${cambio(a.unidad, z.unidad, precio)}`].filter(Boolean);
      detalle = `${x.producto ?? "Producto"}: ${partes.join(" · ") || "sin cambio de valor"}.`; break;
    }
    case "completar_costo": titulo = "Costo de un lote"; detalle = `Lote ${x.lote ?? ""}: costo por unidad ${$(d.costo_unidad)} (sin IVA).`; break;
    case "corregir_costo": titulo = "Costo de un lote corregido"; detalle = `Lote ${x.lote ?? ""}: costo por unidad de ${$(d.antes)} a ${$(d.despues)} (sin IVA). Motivo: ${d.motivo ?? ""}.`; break;
    case "anular_venta": titulo = "Anulación de venta"; detalle = `Venta ${x.venta || ""} por ${$(d.total)}.${motivo(d)}`; break;
    case "anular_compra": titulo = "Anulación de compra"; detalle = `Compra N.º ${d.numero} (factura ${d.factura}) por ${$(d.total)}.${motivo(d)}`; break;
    case "anular_pago_proveedor": titulo = "Anulación de pago a proveedor"; detalle = `Pago de ${$(d.valor)} a ${d.proveedor}.${motivo(d)}`; break;
    case "anular_recibo": titulo = "Anulación de recibo de caja"; detalle = `Recibo ${d.numero} de ${x.cliente ?? "un cliente"} por ${$(d.valor)}.${motivo(d)}`; break;
    case "anular_abono": titulo = "Anulación de abono"; detalle = `Abono de ${$(d.valor)} a la venta ${x.venta || ""}.${motivo(d)}`; break;
    case "anular_gasto": titulo = "Anulación de gasto"; detalle = `Gasto G-${d.numero} (${nombreCategoria(String(d.categoria))}: ${d.descripcion}) por ${$(d.valor)}${d.caja ? ", el efectivo volvió a la caja" : ""}.${motivo(d)}`; break;
    case "anular_conteo": titulo = "Anulación de conteo físico"; detalle = `Conteo N.º ${d.numero}.${motivo(d)}`; break;
    case "pedido_cancelado": titulo = "Pedido cancelado"; detalle = `${d.tipo === "cotizacion" ? "Cotización" : d.tipo === "domicilio" ? "Domicilio" : "Venta en espera"} N.º ${d.numero}.${motivo(d)}`; break;
    case "devolucion": titulo = "Devolución de un cliente"; detalle = `Venta ${x.venta || ""}: devolvió ${$(d.total)}${Number(d.reembolso) > 0 ? `, se le reembolsaron ${$(d.reembolso)} en ${MEDIOS[String(d.medio)] ?? d.medio}` : ""}.${motivo(d)}`; break;
    case "devolucion_proveedor": titulo = "Devolución al proveedor"; detalle = `Devolución N.º ${d.numero} a ${d.proveedor} (compra N.º ${d.compra}) por ${$(d.valor)}.${motivo(d)}`; break;
    case "nc_proveedor": titulo = "Nota crédito de proveedor"; detalle = `Nota ${d.nc} por ${$(d.valor)} a la compra N.º ${d.compra}.`; break;
    case "descuento_sobre_tope": titulo = "Descuento sobre el tope de la cajera"; detalle = `Venta ${x.venta || ""} por ${$(d.total)}: descuento de hasta ${num(d.pct)} % (${$(d.descuento)}); el tope de la cajera es ${num(d.tope)} %.`; break;
    case "ajuste_inventario": titulo = d.motivo === "conteo" ? "Ajuste por conteo" : "Ajuste o baja de inventario";
      detalle = `N.º ${d.numero}, motivo ${MOTIVOS_AJUSTE[String(d.motivo)] ?? d.motivo}${d.detalle ? ` (${d.detalle})` : ""}: ${d.lineas} lote${Number(d.lineas) === 1 ? "" : "s"}.`; break;
    case "entrada_ajuste": titulo = "Ajuste de inventario"; detalle = `${d.lineas} lote${Number(d.lineas) === 1 ? "" : "s"}${d.motivo ? `. Motivo: «${d.motivo}»` : ""}.`; break;
    case "venta_sin_turno":
      titulo = "Venta sin turno abierto";
      detalle = `${String(d.caja ?? "Caja")}: venta ${x.venta ?? ""} por ${$(d.total)} hecha sin internet y sincronizada cuando no había turno abierto. Ese dinero no entra en ningún arqueo: revísalo con quien la hizo.`; break;
    case "cerrar_turno": {
      const dif = Number(d.diferencia ?? 0);
      titulo = dif < 0 ? "Turno con faltante" : "Turno con sobrante";
      detalle = `${x.caja ?? "Caja"}: se esperaban ${$(d.esperado)} y se contaron ${$(d.contado)} (${dif < 0 ? "faltan" : "sobran"} ${$(Math.abs(dif))}).`; break;
    }
    case "credito_cliente": {
      titulo = "Cambio de crédito de un cliente";
      const partes = [cambio(a.cupo, z.cupo, (v) => (v === null || v === undefined ? "sin cupo" : $(v))) && `cupo ${cambio(a.cupo, z.cupo, (v) => (v === null || v === undefined ? "sin cupo" : $(v)))}`,
        cambio(a.plazo, z.plazo, (v) => (v ? `${v} días` : "sin plazo")) && `plazo ${cambio(a.plazo, z.plazo, (v) => (v ? `${v} días` : "sin plazo"))}`,
        cambio(!!a.bloqueado, !!z.bloqueado, (v) => (v ? "bloqueado" : "activo")) && `crédito ${cambio(!!a.bloqueado, !!z.bloqueado, (v) => (v ? "bloqueado" : "activo"))}`,
        cambio(a.notas ?? null, z.notas ?? null, () => "") !== null ? "notas cambiadas" : null].filter(Boolean);
      detalle = `${x.cliente ?? "Cliente"}: ${partes.join(" · ") || "sin cambios"}.`; break;
    }
    case "mora_bloqueo": titulo = "Bloqueo por mora"; detalle = `${d.despues === null || d.despues === undefined ? "Ya no se bloquea el fiado por mora" : `Se bloquea el fiado con más de ${d.despues} días de mora`}${d.antes !== null && d.antes !== undefined ? ` (antes: ${d.antes} días)` : ""}.`; break;
    case "credito_autorizado": titulo = "Crédito autorizado por encima de la regla"; detalle = `Venta ${d.numero ?? x.venta ?? ""} por ${$(d.total)}${d.razon ? ` (${d.razon})` : ""}.${motivo(d)}`; break;
    case "rango_temperatura": {
      titulo = "Cambio de rangos de temperatura";
      const f = (v: unknown) => { const r = Array.isArray(v) ? v : []; return `${num(r[0])}–${num(r[1])} °C${r[2] !== null && r[2] !== undefined ? `, humedad ${num(r[2])}–${num(r[3])} %` : ""}`; };
      detalle = `${AREAS[String(x.entidad_id)] ?? x.entidad_id}: ${Array.isArray(d.antes) && d.antes[0] !== null && d.antes[0] !== undefined ? f(d.antes) : "los de fábrica"} → ${f(d.despues)}.`; break;
    }
    case "configurar_empresa": titulo = "Datos de la droguería"; detalle = `Tope de descuento de la cajera ${num(d.descuento_max_cajero)} %, salidas de caja de la cajera hasta ${$(d.egreso_max_cajero)} por turno.`; break;
    case "configurar_formulas": titulo = "Configuración de fórmulas"; detalle = `Vigencia de la fórmula ${d.vigencia_dias} días; exigir datos del paciente: ${sino(d.exige_datos)}.`; break;
    case "cambio_formula": titulo = "Marca de fórmula o control especial";
      detalle = `${x.producto ?? "Producto"}: venta con fórmula ${sino(a.formula)} → ${sino(z.formula)}, control especial ${sino(a.control)} → ${sino(z.control)}.`; break;
    case "cambiar_usuario": titulo = "Cambio en el equipo"; detalle = `${nombre(x.miembro) || "Usuario"}: ${[d.rol ? `rol ${ROLES[String(d.rol)] ?? d.rol}` : null, d.activo === false ? "desactivado" : d.activo === true ? "activo" : null, d.enlace ? "se le envió un enlace de acceso" : null].filter(Boolean).join(", ") || "datos actualizados"}.`; break;
    case "invitar_usuario": titulo = "Invitación al equipo"; detalle = `${d.email} como ${ROLES[String(d.rol)] ?? d.rol}.`; break;
    case "crear_caja": titulo = "Caja nueva"; detalle = `${d.nombre}.`; break;
    case "nota_debito": titulo = "Nota débito"; detalle = `${d.numero} sobre la factura ${d.factura} por ${$(d.total)}.${motivo(d)}`; break;
    case "documento_soporte": titulo = "Documento soporte"; detalle = `${d.numero} a ${d.proveedor} por ${$(d.total)}${Array.isArray(d.compras) && d.compras.length ? ` (compras N.º ${(d.compras as unknown[]).join(", ")})` : ""}.`; break;
    case "ajuste_soporte": titulo = "Nota de ajuste del documento soporte"; detalle = `${d.numero ?? ""}${d.total !== undefined ? ` por ${$(d.total)}` : ""}.${motivo(d)}`; break;
    case "reenviar_dian": titulo = "Reenvío a la DIAN"; detalle = x.venta ? `Venta ${x.venta}: se volvió a enviar el documento.` : "Se volvió a enviar un documento electrónico."; break;
    case "registrar_gasto": titulo = "Gasto registrado"; detalle = `G-${d.numero} (${nombreCategoria(String(d.categoria))}: ${d.descripcion}) por ${$(d.valor)}${d.caja ? ", pagado con el efectivo de la caja" : ""}.`; break;
    case "cargos_compra": titulo = "Flete y otros cargos de una compra"; detalle = `Compra N.º ${d.numero}: ${Array.isArray(d.cargos) ? (d.cargos as { descripcion: string; base: number; iva: number }[]).map((c) => `${c.descripcion} ${$(Number(c.base) + Number(c.iva))}`).join(", ") : ""}.`; break;
    case "venta_sin_conexion": titulo = "Venta hecha sin internet"; detalle = `Se vendió el ${String(d.vendida ?? "").slice(0, 16).replace("T", " ")} y se registró al volver la conexión, por ${$(d.total)}.`; break;
    case "cambiar_caja": titulo = "Cambio de caja"; detalle = `${[d.nombre ? `nombre «${d.nombre}»` : null, d.activa === false ? "desactivada" : d.activa === true ? "activada" : null].filter(Boolean).join(", ") || "datos actualizados"}.`; break;
  }
  const tipo = TIPO_DE[x.accion] ?? "";
  return { clave: x.clave, fecha: x.fecha, usuario: x.usuario ? nombre(x.usuario) : "Sistema", tipo, tipo_nombre: TIPOS_BITACORA[tipo]?.nombre ?? "", titulo, detalle };
}
