import "server-only";
import "./zod-es";
import { z } from "zod";
import type { Tx } from "./db";
import type { Sesion } from "./sesion";
import { puestoDeTrabajo } from "./db";
import { errorFormula, exigencia, pideFormula } from "./control-especial";
import type { EstadoPedido, TipoPedido } from "./pedidos";

// ───────────── Venta de la caja ─────────────
// Mismo contrato que POST /api/ventas: mismos validadores, mismas reglas (turno, fórmula, topes de descuento en la base,
// idempotencia por idem_key). Si cambia uno, cambia el otro.
const Pago = z.object({ medio: z.enum(["efectivo", "transferencia", "nequi", "daviplata", "tarjeta", "bre_b", "qr"]), valor: z.number().positive().max(1_000_000_000, "Revisa el valor recibido"), referencia: z.string().max(60).nullish() });
const Formula = z.object({
  verificada: z.boolean().default(false),
  paciente_tipo_doc: z.string().max(5).default(""), paciente_doc: z.string().max(30).default(""), paciente_nombre: z.string().max(160).default(""),
  medico_nombre: z.string().max(160).default(""), medico_registro: z.string().max(60).default(""),
  formula_numero: z.string().max(60).default(""), formula_fecha: z.string().max(10).default(""),
});
export const VentaCaja = z.object({
  idem_key: z.string().uuid(),
  tipo_doc: z.enum(["pos", "factura"]),
  cliente_id: z.string().uuid().nullish(),
  condicion: z.enum(["contado", "credito"]).default("contado"),
  plazo_dias: z.number().int().min(1).max(180).nullish(),
  lineas: z.array(z.object({ producto_id: z.string().uuid(), presentacion: z.enum(["caja", "unidad"]), cantidad: z.number().int().positive().max(10000), descuento_pct: z.number().min(0).max(99).optional() })).min(1).max(200),
  descuento_pct: z.number().min(0).max(99).optional(),
  pagos: z.array(Pago).max(6),
  sin_conexion: z.boolean().optional(),
  formula: Formula.nullish(),
}).refine((v) => v.condicion === "credito" ? v.pagos.length === 0 : v.pagos.length > 0, { message: "Datos de pago incompletos" })
  .refine((v) => v.tipo_doc === "pos" || v.cliente_id, { message: "La factura electrónica necesita el cliente" });
export type VentaCaja = z.infer<typeof VentaCaja>;
export const errorVenta = (e: z.ZodError) => e.issues.find((i) => i.code === "custom")?.message ?? e.issues.find((i) => i.path.includes("pagos"))?.message ?? "Datos de la venta incompletos";

/** Registra la venta dentro de la transacción `c` (como POST /api/ventas). Devuelve la venta o el dato de fórmula que falta. */
export async function registrarVentaCaja(c: Tx, s: Sesion, d: VentaCaja, cajaElegida: string | null):
  Promise<{ venta: { venta_id: string; repetida: boolean } & Record<string, unknown> } | { invalida: string }> {
  const puesto = await puestoDeTrabajo(c, s.empresa, cajaElegida);
  if (!puesto.caja_id) throw Object.assign(new Error("Esta empresa no tiene cajas activas"), { code: "P0001" });
  const sinTurno = (await c.query(`select e.exige_turno and not exists (select 1 from turnos t where t.caja_id = $2 and t.estado = 'abierto') falta
    from empresas e where e.id = $1`, [s.empresa, puesto.caja_id])).rows[0]?.falta;
  if (sinTurno && !d.sin_conexion) throw Object.assign(new Error("Abre el turno de caja antes de vender (Caja → Turno)"), { code: "P0001" });
  const { rows: marcas } = await c.query(`select p.nombre, p.requiere_formula, p.control_especial, e.formula_vigencia_dias vigencia_dias, e.formula_exige_datos exige_datos
    from productos p join empresas e on e.id = p.empresa_id where p.empresa_id = $1 and p.id = any($2::uuid[]) and (p.requiere_formula or p.control_especial)`,
    [s.empresa, [...new Set(d.lineas.map((l) => l.producto_id))]]);
  const ex = marcas.length ? exigencia(marcas, marcas[0]) : null;
  if (ex && pideFormula(ex)) {
    const falta = errorFormula(d.formula, ex, marcas[0]);
    if (falta) return { invalida: ex.control.length ? `${falta} (${ex.control[0]} es de control especial)` : falta };
  }
  const venta = (await c.query(`select registrar_venta($1) r`, [{ ...d, formula: undefined, empresa_id: s.empresa, sede_id: puesto.sede_id, caja_id: puesto.caja_id }])).rows[0].r;
  if (ex && pideFormula(ex) && !venta.repetida) await c.query(`select registrar_formulas_venta($1, $2)`, [venta.venta_id, d.formula]);
  return { venta };
}

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
