import "server-only";
import "./zod-es";
import { z } from "zod";
import type { Tx } from "./db";
import type { Sesion } from "./sesion";
import { puestoDeTrabajo } from "./db";
import type { EstadoPedido, TipoPedido } from "./pedidos";

// La venta al cobrar un pedido usa la misma lógica que la caja: src/lib/venta-servidor.ts.

// ───────────── Pedidos ─────────────
const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha no válida");
const texto = (max: number, msj: string) => z.string().trim().max(max, msj).nullish().transform((v) => v || null);
export const LineaPedido = z.object({
  producto_id: z.string().uuid("Producto no válido"),
  presentacion: z.enum(["caja", "unidad"]),
  cantidad: z.coerce.number().int("La cantidad es un número entero").min(1, "La cantidad debe ser mayor que cero").max(10000, "Cantidad demasiado alta"),
  descuento_pct: z.coerce.number().min(0).max(99, "El descuento debe estar entre 0 y 99 %").default(0),
});
export const PedidoEntrada = z.object({
  tipo: z.enum(["espera", "domicilio", "cotizacion"], { message: "Elige si es espera, domicilio o cotización" }),
  cliente_id: z.string().uuid().nullish(),
  contacto: texto(80, "El nombre es demasiado largo (máximo 80 caracteres)"),
  telefono: z.string().trim().max(20, "Teléfono demasiado largo").nullish().transform((v) => v || null)
    .refine((v) => v === null || /^[0-9 +()-]{7,20}$/.test(v), "Escribe un teléfono válido (solo números)"),
  direccion: texto(200, "La dirección es demasiado larga"),
  nota: texto(300, "La nota es demasiado larga (máximo 300 caracteres)"),
  vence: fecha.nullish(),
  descuento_pct: z.coerce.number().min(0).max(99, "El descuento debe estar entre 0 y 99 %").default(0),
  lineas: z.array(LineaPedido).min(1, "El pedido no tiene productos").max(200, "El pedido tiene demasiados productos"),
});
export type PedidoEntrada = z.infer<typeof PedidoEntrada>;
export const CambioEstado = z.object({ estado: z.enum(["en_camino", "abierto", "cancelado"]), motivo: z.string().trim().max(200, "El motivo es demasiado largo (máximo 200 caracteres)").nullish() });

export type ProductoCaja = {
  id: string; nombre: string; laboratorio: string | null; ean: string | null; iva: number; unidades_por_caja: number;
  precio_caja: number; precio_unidad: number | null; stock_minimo: number; unidades: number; proximo_vence: string | null; exacto: boolean;
  requiere_formula?: boolean; control_especial?: boolean; activo?: boolean;
};
export type LineaDetalle = { id: number; presentacion: "caja" | "unidad"; cantidad: number; descuento_pct: number; precio_mostrado: number; producto: ProductoCaja };
export type Pedido = {
  id: string; tipo: TipoPedido; estado: EstadoPedido; numero: number; contacto: string | null; telefono: string | null; direccion: string | null;
  nota: string | null; vence: string | null; motivo: string | null; descuento_pct: number; creado: string; actualizado: string; cliente_id: string | null; cliente: string | null;
  creado_por: string | null; caja: string | null; venta_id: string | null; venta: string | null; n_lineas: number; total_mostrado: number; total_actual: number;
};
export type PedidoDetalle = Pedido & {
  lineas: LineaDetalle[];
  cliente_datos: { id: string; tipo_doc: string; numero_doc: string; dv: string | null; nombre: string; email: string | null; telefono: string | null } | null;
};

// Total con el precio que se le dijo al cliente y con el precio de hoy (mismo cálculo que la venta).
const COLUMNAS = `pm.id, pm.tipo, pm.estado, pm.numero, pm.contacto, pm.telefono, pm.direccion, pm.nota, pm.vence::text vence, pm.motivo,
  pm.descuento_pct::float descuento_pct, to_char(pm.creado at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI') creado,
  to_char(pm.actualizado at time zone 'America/Bogota', 'YYYY-MM-DD HH24:MI') actualizado, pm.cliente_id, cl.nombre cliente,
  split_part(mi.nombre, ' (', 1) creado_por, cj.nombre caja, pm.venta_id, v.prefijo || v.numero venta,
  t.n_lineas, t.total_mostrado, t.total_actual`;
const DESDE = `from pedidos_mostrador pm
  left join clientes cl on cl.id = pm.cliente_id
  left join miembros mi on mi.empresa_id = pm.empresa_id and mi.user_id = pm.creado_por
  left join cajas cj on cj.id = pm.caja_id
  left join ventas v on v.id = pm.venta_id
  left join lateral (
    select count(*)::int n_lineas,
      coalesce(sum(case when x.pct > 0 then round(x.mostrado * (100 - x.pct) / 100) else x.mostrado end), 0)::float total_mostrado,
      coalesce(sum(case when x.pct > 0 then round(x.actual * (100 - x.pct) / 100) else x.actual end), 0)::float total_actual
    from (select pl.precio_mostrado * pl.cantidad mostrado,
                 coalesce(case pl.presentacion when 'caja' then p.precio_caja else p.precio_unidad end, pl.precio_mostrado) * pl.cantidad actual,
                 100 - (100 - pl.descuento_pct) * (100 - pm.descuento_pct) / 100 pct
          from pedido_lineas pl join productos p on p.id = pl.producto_id where pl.pedido_id = pm.id) x
  ) t on true`;

export type FiltroPedidos = { tipo: TipoPedido | null; estado: "pendientes" | EstadoPedido | "todos"; q: string };
export function leerFiltroPedidos(sp: Record<string, string | undefined>): FiltroPedidos {
  const tipo = (["espera", "domicilio", "cotizacion"] as const).find((t) => t === sp.tipo) ?? null;
  const estado = (["pendientes", "abierto", "en_camino", "cobrado", "cancelado", "vencido", "todos"] as const).find((e) => e === sp.estado) ?? "pendientes";
  return { tipo, estado, q: (sp.q ?? "").replace(/\0/g, "").trim().slice(0, 60) };
}

export async function listarPedidos(c: Tx, empresa: string, f: FiltroPedidos, limite = 100): Promise<Pedido[]> {
  await c.query(`select vencer_cotizaciones($1)`, [empresa]);
  const estados = f.estado === "pendientes" ? ["abierto", "en_camino", "vencido"] : f.estado === "todos" ? null : [f.estado];
  const q = f.q.replace(/[\\%_]/g, (m) => "\\" + m);
  const num = /^\d{1,9}$/.test(f.q) ? Number(f.q) : null;
  return (await c.query(`select ${COLUMNAS} ${DESDE}
    where pm.empresa_id = $1 and ($2::text is null or pm.tipo = $2) and ($3::text[] is null or pm.estado = any($3))
      and ($4 = '' or pm.numero = $5::int or pm.contacto ilike '%' || $4 || '%' or pm.telefono like '%' || $4 || '%' or cl.nombre ilike '%' || $4 || '%')
    order by (pm.estado in ('abierto', 'en_camino')) desc, pm.creado desc limit $6`,
    [empresa, f.tipo, estados, q, num, limite])).rows;
}

/** Cuántos pedidos hay por tipo en cada estado pendiente (para los contadores de /pedidos). */
export async function contarPedidos(c: Tx, empresa: string) {
  const rows = (await c.query(`select tipo, estado, count(*)::int n from pedidos_mostrador where empresa_id = $1 and estado in ('abierto', 'en_camino', 'vencido') group by 1, 2`, [empresa])).rows as { tipo: TipoPedido; estado: EstadoPedido; n: number }[];
  const n = (t: TipoPedido, e?: EstadoPedido[]) => rows.filter((r) => r.tipo === t && (!e || e.includes(r.estado))).reduce((a, r) => a + r.n, 0);
  return { espera: n("espera", ["abierto"]), domicilio: n("domicilio", ["abierto"]), en_camino: n("domicilio", ["en_camino"]), cotizacion: n("cotizacion", ["abierto"]), vencida: n("cotizacion", ["vencido"]) };
}

export async function detallePedido(c: Tx, empresa: string, id: string): Promise<PedidoDetalle | null> {
  const p = (await c.query(`select ${COLUMNAS},
      case when cl.id is null then null else json_build_object('id', cl.id, 'tipo_doc', cl.tipo_doc, 'numero_doc', cl.numero_doc, 'dv', cl.dv, 'nombre', cl.nombre, 'email', cl.email, 'telefono', cl.telefono) end cliente_datos
    ${DESDE} where pm.id = $1 and pm.empresa_id = $2`, [id, empresa])).rows[0];
  if (!p) return null;
  const lineas = (await c.query(`select pl.id::int, pl.presentacion, pl.cantidad, pl.descuento_pct::float descuento_pct, pl.precio_mostrado::float precio_mostrado,
      json_build_object('id', p.id, 'nombre', p.nombre, 'laboratorio', p.laboratorio, 'ean', p.ean, 'iva', p.iva::float, 'unidades_por_caja', p.unidades_por_caja,
        'precio_caja', p.precio_caja::float, 'precio_unidad', p.precio_unidad::float, 'stock_minimo', p.stock_minimo, 'unidades', coalesce(st.unidades, 0)::int,
        'proximo_vence', st.proximo_vence::text, 'exacto', false, 'requiere_formula', p.requiere_formula, 'control_especial', p.control_especial, 'activo', p.activo) producto
    from pedido_lineas pl join productos p on p.id = pl.producto_id
    left join lateral (select sum(unidades) unidades, min(vence) filter (where unidades > 0) proximo_vence from v_stock_vigente where producto_id = p.id) st on true
    where pl.pedido_id = $1 order by pl.id`, [id])).rows as LineaDetalle[];
  return { ...p, lineas };
}

/** Unidades de cada producto que van en domicilios abiertos o en camino (nada reserva: es solo un aviso). */
export async function enDomicilios(c: Tx, empresa: string, productos: string[], excluir: string | null) {
  if (!productos.length) return {};
  const rows = (await c.query(`select pl.producto_id, sum(pl.cantidad * case when pl.presentacion = 'caja' then p.unidades_por_caja else 1 end)::int unidades, count(distinct pm.id)::int pedidos
    from pedido_lineas pl join pedidos_mostrador pm on pm.id = pl.pedido_id join productos p on p.id = pl.producto_id
    where pm.empresa_id = $1 and pm.tipo = 'domicilio' and pm.estado in ('abierto', 'en_camino') and pl.producto_id = any($2::uuid[]) and ($3::uuid is null or pm.id <> $3::uuid)
    group by 1`, [empresa, productos, excluir])).rows as { producto_id: string; unidades: number; pedidos: number }[];
  return Object.fromEntries(rows.map((r) => [r.producto_id, { unidades: r.unidades, pedidos: r.pedidos }]));
}

export async function guardarPedido(c: Tx, s: Sesion, d: PedidoEntrada, cajaElegida: string | null, id?: string) {
  const puesto = await puestoDeTrabajo(c, s.empresa, cajaElegida);
  const r = (await c.query(`select guardar_pedido($1) r`, [{ ...d, id: id ?? null, empresa_id: s.empresa, sede_id: puesto.sede_id, caja_id: puesto.caja_id }])).rows[0].r as { id: string };
  return detallePedido(c, s.empresa, r.id);
}
