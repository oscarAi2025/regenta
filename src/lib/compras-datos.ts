import "server-only";
import type { Tx } from "./db";
import { sinComodines } from "./db";
import { z } from "zod";
import "./zod-es";
import { nitSinDv } from "./validar";

/** Alta rápida de proveedor (nombre y NIT opcional). */
export const ProveedorNuevo = z.object({
  nombre: z.string().trim().min(2, "Escribe el nombre del proveedor").max(160),
  nit: z.string().trim().max(20).nullish().transform((v) => (v ? nitSinDv(v) : null)).refine((v) => !v || /^\d{5,12}$/.test(v), "El NIT va con 5 a 12 números, sin dígito de verificación"),
});

// Consultas del frente de compras. Con `dinero = false` (la bodega) se leen las vistas sin dinero (v_recepciones,
// v_recepcion_lineas): ni costos ni totales salen de la base. Fechas como texto (sin corrimiento de zona horaria).

export type LineaCompra = {
  id: number; producto_id: string; nombre: string; laboratorio: string | null; registro_sanitario: string | null; ean: string | null;
  unidades_por_caja: number; iva_producto: number; precio_caja: number; precio_unidad: number | null;
  lote_id: string; lote: string; vence: string | null; unidades: number; bonificadas: number; devueltas: number; existencias: number;
  costo: number | null; costo_por: string | null; descuento_pct: number | null; iva_pct: number | null; bruto: number | null; base: number | null;
  iva: number | null; total: number | null; costo_lote: number | null; precio_anterior: number | null; precio_venta_nuevo: number | null; precio_unidad_nuevo: number | null;
};

export async function detalleCompra(c: Tx, empresa: string, id: string, dinero: boolean) {
  const k = (await c.query(
    dinero
      ? `select c.id, c.numero, c.estado, c.numero_factura, c.fecha_factura::text, c.condicion, c.vence_pago::text, c.subtotal::float, c.descuento::float, c.iva::float,
           c.total::float, c.total_papel::float, c.diferencia::float, c.cufe_proveedor, c.observaciones, c.motivo_anulacion,
           to_char(c.creado at time zone 'America/Bogota', 'DD/MM/YYYY HH24:MI') creado, to_char(c.anulada at time zone 'America/Bogota', 'DD/MM/YYYY HH24:MI') anulada,
           p.id proveedor_id, p.nombre proveedor, p.nit proveedor_nit, p.dv proveedor_dv, mi.nombre recibe, sd.nombre sede,
           coalesce(v.saldo, 0)::float saldo, coalesce(v.pagado, 0)::float pagado, coalesce(v.notas_credito, 0)::float notas_credito, v.dias
         from compras c join proveedores p on p.id = c.proveedor_id join sedes sd on sd.id = c.sede_id
         left join miembros mi on mi.empresa_id = c.empresa_id and mi.user_id = c.usuario_id
         left join v_cuentas_por_pagar v on v.compra_id = c.id
         where c.id = $1 and c.empresa_id = $2`
      : `select c.id, c.numero, c.estado, c.numero_factura, c.fecha_factura::text, c.motivo_anulacion, to_char(c.creado at time zone 'America/Bogota', 'DD/MM/YYYY HH24:MI') creado,
           c.proveedor_id, c.proveedor, c.proveedor_nit, null::text proveedor_dv, mi.nombre recibe, sd.nombre sede
         from v_recepciones c join sedes sd on sd.id = c.sede_id left join miembros mi on mi.empresa_id = c.empresa_id and mi.user_id = c.usuario_id
         where c.id = $1 and c.empresa_id = $2`, [id, empresa])).rows[0];
  if (!k) return null;
  const lineas: LineaCompra[] = (await c.query(
    `select l.id::int, l.producto_id, p.nombre, p.laboratorio, p.registro_sanitario, p.ean, p.unidades_por_caja, p.iva::float iva_producto, p.precio_caja::float,
            p.precio_unidad::float, l.lote_id, lo.lote, lo.vence::text, l.unidades, l.bonificadas,
            coalesce((select s.unidades from v_stock_lotes s where s.lote_id = l.lote_id), 0)::int existencias,
            ${dinero ? `coalesce((select sum(dl.unidades) from devolucion_proveedor_lineas dl where dl.compra_linea_id = l.id), 0)::int devueltas,
            l.costo::float, l.costo_por, l.descuento_pct::float, l.iva_pct::float, l.bruto::float, l.base::float, l.iva::float, l.total::float, l.costo_lote::float,
            l.precio_anterior::float, l.precio_venta_nuevo::float, l.precio_unidad_nuevo::float`
              : `0 devueltas, null::float costo, null costo_por, null::float descuento_pct, null::float iva_pct, null::float bruto, null::float base, null::float iva,
            null::float total, null::float costo_lote, null::float precio_anterior, null::float precio_venta_nuevo, null::float precio_unidad_nuevo`}
     from ${dinero ? "compra_lineas" : "v_recepcion_lineas"} l join productos p on p.id = l.producto_id join lotes lo on lo.id = l.lote_id
     where l.compra_id = $1 order by l.id`, [id])).rows;
  const pagos = dinero ? (await c.query(
    `select g.id, g.medio, g.valor::float, a.valor::float aplicado, g.referencia, g.anulado, g.motivo, g.caja_id is not null desde_caja,
            to_char(g.creado at time zone 'America/Bogota', 'DD/MM/YYYY HH24:MI') fecha, mi.nombre usuario
     from pago_aplicaciones a join pagos_proveedor g on g.id = a.pago_id left join miembros mi on mi.empresa_id = g.empresa_id and mi.user_id = g.usuario_id
     where a.compra_id = $1 order by g.creado`, [id])).rows : [];
  const devoluciones = dinero ? (await c.query(
    `select d.id, d.numero, d.motivo, d.valor::float, d.estado, d.nc_proveedor, d.valor_nc::float, to_char(d.creado at time zone 'America/Bogota', 'DD/MM/YYYY') fecha,
            (select json_agg(json_build_object('nombre', p.nombre, 'lote', lo.lote, 'unidades', dl.unidades, 'valor', dl.valor) order by dl.id)
             from devolucion_proveedor_lineas dl join productos p on p.id = dl.producto_id join lotes lo on lo.id = dl.lote_id where dl.devolucion_id = d.id) lineas
     from devoluciones_proveedor d where d.compra_id = $1 order by d.creado`, [id])).rows : [];
  return { compra: k, lineas, pagos, devoluciones };
}
export type DetalleCompra = NonNullable<Awaited<ReturnType<typeof detalleCompra>>>;

export type Filtros = { estado?: string; proveedor?: string; desde?: string; hasta?: string; q?: string };
export async function listaCompras(c: Tx, empresa: string, f: Filtros, dinero: boolean) {
  const q = (f.q ?? "").trim().slice(0, 60);
  const p = [empresa, f.estado || null, f.proveedor || null, f.desde || null, f.hasta || null, q ? `%${sinComodines(q.toLowerCase())}%` : null];
  const filtro = `c.empresa_id = $1 and ($2::text is null or c.estado = $2) and ($3::uuid is null or c.proveedor_id = $3)
    and ($4::date is null or c.fecha_factura >= $4) and ($5::date is null or c.fecha_factura <= $5)
    and ($6::text is null or lower(c.numero_factura) like $6 or lower(pr.nombre) like $6 or c.numero::text = trim(both '%' from $6))`;
  return (await c.query(dinero
    ? `select c.id, c.numero, c.estado, c.numero_factura, c.fecha_factura::text, c.condicion, c.vence_pago::text, pr.nombre proveedor, c.total::float,
         v.saldo::float saldo, v.dias, (select count(*) from compra_lineas l where l.compra_id = c.id)::int lineas
       from compras c join proveedores pr on pr.id = c.proveedor_id left join v_cuentas_por_pagar v on v.compra_id = c.id
       where ${filtro} order by c.creado desc limit 300`
    : `select c.id, c.numero, c.estado, c.numero_factura, c.fecha_factura::text, null::text condicion, null::text vence_pago, pr.nombre proveedor, null::float total,
         null::float saldo, null::int dias, c.lineas
       from v_recepciones c join proveedores pr on pr.id = c.proveedor_id
       where ${filtro} order by c.creado desc limit 300`, p)).rows as {
    id: string; numero: number; estado: string; numero_factura: string; fecha_factura: string; condicion: string | null; vence_pago: string | null;
    proveedor: string; total: number | null; saldo: number | null; dias: number | null; lineas: number }[];
}

export type FilaCxP = { compra_id: string; numero: number; proveedor_id: string; proveedor: string; nit: string | null; dv: string | null; numero_factura: string;
  fecha_factura: string; vence_pago: string; condicion: string; total: number; pagado: number; notas_credito: number; saldo: number; dias: number; dias_vencida: number };
export async function cuentasPorPagar(c: Tx, empresa: string, proveedor?: string | null): Promise<FilaCxP[]> {
  return (await c.query(`select compra_id, numero, proveedor_id, proveedor, nit, dv, numero_factura, fecha_factura::text, vence_pago::text, condicion,
      total::float, pagado::float, notas_credito::float, saldo::float, dias, dias_vencida
    from v_cuentas_por_pagar where empresa_id = $1 and saldo > 0 and ($2::uuid is null or proveedor_id = $2) order by vence_pago, fecha_factura, numero`, [empresa, proveedor ?? null])).rows;
}

/** Grupo de una cuenta por pagar según sus días para vencer. */
export const grupoCxP = (dias: number) => (dias < 0 ? "vencidas" : dias <= 7 ? "semana" : "al_dia");

/** Los errores de factura repetida vienen de la base con su mensaje (proveedor, número y compra): se respetan. */
export function errorConMensaje(e: unknown): { status: number; error: string } | null {
  const x = e as { code?: string; message?: string };
  if (x?.code === "23505" && /^La factura /.test(x.message ?? "")) return { status: 409, error: x.message! };
  return null;
}

/** Proveedor por id o alta rápida por nombre (sin duplicar por mayúsculas). Devuelve su id. */
export async function proveedorId(c: Tx, empresa: string, id: string | null | undefined, nuevo: { nombre: string; nit?: string | null; dv?: string | null } | null | undefined) {
  if (id) return id;
  if (!nuevo) throw Object.assign(new Error("Elige el proveedor"), { code: "P0001" });
  return (await c.query(`insert into proveedores (empresa_id, nombre, nit, dv) values ($1, $2, $3, $4)
    on conflict (empresa_id, lower(trim(nombre))) do update set nombre = proveedores.nombre returning id`, [empresa, nuevo.nombre, nuevo.nit ?? null, nuevo.dv ?? null])).rows[0].id as string;
}

export type Proveedor = { id: string; nombre: string; nit: string | null; dv: string | null; telefono: string | null; email: string | null; contacto: string | null;
  direccion: string | null; ciudad: string | null; plazo_dias: number | null; responsable_iva: boolean; obligado_facturar: boolean; activo: boolean;
  compras: number; ultima: string | null; saldo: number | null; vencido: number | null };
/** Proveedores con cuántas compras y la última; el saldo y lo vencido solo con dinero (gerencia). */
export async function listaProveedores(c: Tx, empresa: string, dinero: boolean, id?: string): Promise<Proveedor[]> {
  return (await c.query(`select p.id, p.nombre, p.nit, p.dv, p.telefono, p.email, p.contacto, p.direccion, p.ciudad, p.plazo_dias, p.responsable_iva, p.obligado_facturar, p.activo,
      (select count(*) from v_recepciones r where r.proveedor_id = p.id and r.estado <> 'anulada')::int compras,
      (select max(r.fecha_factura)::text from v_recepciones r where r.proveedor_id = p.id and r.estado <> 'anulada') ultima,
      ${dinero ? `(select coalesce(sum(v.saldo), 0) from v_cuentas_por_pagar v where v.proveedor_id = p.id)::float saldo,
      (select coalesce(sum(v.saldo), 0) from v_cuentas_por_pagar v where v.proveedor_id = p.id and v.dias < 0)::float vencido` : "null::float saldo, null::float vencido"}
    from proveedores p where p.empresa_id = $1 and ($2::uuid is null or p.id = $2) order by p.activo desc, lower(p.nombre) limit 500`, [empresa, id ?? null])).rows;
}
