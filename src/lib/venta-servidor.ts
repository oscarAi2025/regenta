import "server-only";
import "./zod-es";
import { z } from "zod";
import type { Tx } from "./db";
import type { Sesion } from "./sesion";
import { comoUsuario, puestoDeTrabajo } from "./db";
import { procesarCola } from "./dian";
import { errorFormula, exigencia, pideFormula } from "./control-especial";

// Una sola lógica de venta para la caja (POST /api/ventas) y para cobrar un pedido (POST /api/pedidos/[id]/cobrar):
// mismo validador, mismo turno, misma fórmula médica, mismo crédito (cupo y motivo) e idempotencia por idem_key. Las
// reglas de precios, lotes, numeración, topes de descuento y cupo las fija registrar_venta en la base.

const Pago = z.object({ medio: z.enum(["efectivo", "transferencia", "nequi", "daviplata", "tarjeta", "bre_b", "qr"]), valor: z.number().positive().max(1_000_000_000, "Revisa el valor recibido"), referencia: z.string().max(60).nullish() });
// Fórmula médica de la venta (productos marcados «venta con fórmula» o «control especial»). Se valida contra los productos
// reales en el servidor y, otra vez, en la base de datos.
const Formula = z.object({
  verificada: z.boolean().default(false),
  paciente_tipo_doc: z.string().max(5).default(""), paciente_doc: z.string().max(30).default(""), paciente_nombre: z.string().max(160).default(""),
  medico_nombre: z.string().max(160).default(""), medico_registro: z.string().max(60).default(""),
  formula_numero: z.string().max(60).default(""), formula_fecha: z.string().max(10).default(""),
});
export const Venta = z.object({
  idem_key: z.string().uuid(),
  tipo_doc: z.enum(["pos", "factura"]),
  cliente_id: z.string().uuid().nullish(),
  condicion: z.enum(["contado", "credito"]).default("contado"),
  plazo_dias: z.number().int().min(1).max(180).nullish(),
  motivo_credito: z.string().trim().max(200, "El motivo va hasta 200 caracteres").nullish(), // el dueño o el administrador autorizan pasarse del cupo
  lineas: z.array(z.object({ producto_id: z.string().uuid(), presentacion: z.enum(["caja", "unidad"]), cantidad: z.number().int().positive().max(10000), descuento_pct: z.number().min(0).max(99).optional() })).min(1).max(200),
  descuento_pct: z.number().min(0).max(99).optional(),
  pagos: z.array(Pago).max(6),
  sin_conexion: z.boolean().optional(), // venta que ya se hizo en el mostrador sin internet: no se le exige turno abierto
  creado: z.string().datetime({ offset: true }).nullish(), // hora real de la venta hecha sin internet
  formula: Formula.nullish(),
  total_mostrado: z.number().min(0).max(10_000_000_000).nullish(), // el total que la caja le mostró a la persona
}).refine((v) => v.condicion === "credito" ? v.pagos.length === 0 : v.pagos.length > 0, { message: "Datos de pago incompletos" })
  .refine((v) => v.tipo_doc === "pos" || v.cliente_id, { message: "La factura electrónica necesita el cliente" });
export type Venta = z.infer<typeof Venta>;

/** El mensaje en español que se devuelve con un 400 cuando la venta no pasa el validador. */
export const errorVenta = (e: z.ZodError) => e.issues.find((i) => i.code === "custom")?.message ?? e.issues.find((i) => i.path.includes("pagos"))?.message ?? "Datos de la venta incompletos";

export type VentaRegistrada = { venta_id: string; repetida: boolean } & Record<string, unknown>;

/** El total que calculó la base (con los precios de hoy) no es el que la caja le mostró a la persona: el precio de algún
 *  producto cambió con la venta abierta. La venta se deshace (rollback) y la caja recibe los precios de hoy. */
export class TotalCambio extends Error {
  constructor(public total: number, public mostrado: number, public precios: { id: string; precio_caja: number; precio_unidad: number | null }[]) {
    super(`El precio de un producto cambió mientras la venta estaba abierta: el total ahora es $${Math.round(total).toLocaleString("es-CO")} (antes $${Math.round(mostrado).toLocaleString("es-CO")}). Revisa la venta y cobra de nuevo.`);
  }
}
export const respuestaTotalCambio = (e: TotalCambio) => ({ error: e.message, total: e.total, precios: e.precios });

/** Registra la venta dentro de la transacción `c` (como usuario): puesto de trabajo, turno abierto, datos de la fórmula
 *  (antes de tocar la numeración: un dato que falta es un 400) y registrar_venta. Devuelve la venta o el dato que falta. */
export async function registrarVenta(c: Tx, s: Sesion, d: Venta, cajaElegida: string | null): Promise<{ venta: VentaRegistrada } | { invalida: string }> {
  const puesto = await puestoDeTrabajo(c, s.empresa, cajaElegida);
  if (!puesto.caja_id) throw Object.assign(new Error("Esta empresa no tiene cajas activas"), { code: "P0001" });
  // Con «exigir turno» activo no se vende sin turno abierto en la caja.
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
  // Una venta hecha sin internet ya se cobró en el mostrador (su diferencia la resuelve la cola); en línea, nunca se
  // cobra un total distinto del que vio la persona. Con punto de guardado: si el pago ya no cubre el total nuevo, el
  // error de la base tampoco llega crudo a la caja.
  const vigilar = d.total_mostrado != null && !d.sin_conexion;
  const precios = async () => (await c.query(`select id, precio_caja::float, precio_unidad::float from productos where empresa_id = $1 and id = any($2::uuid[])`,
    [s.empresa, [...new Set(d.lineas.map((l) => l.producto_id))]])).rows;
  if (vigilar) await c.query("savepoint venta_total");
  // Venta hecha sin internet: nace con su hora real (día, turno y arqueo en que se vendió), hasta 72 horas atrás (042).
  if (d.sin_conexion && d.creado) await c.query(`select set_config('regenta.venta_creado', $1, true)`, [d.creado]);
  let venta: VentaRegistrada;
  try {
    venta = (await c.query(`select registrar_venta($1) r`, [{ ...d, formula: undefined, total_mostrado: undefined, creado: undefined, empresa_id: s.empresa, sede_id: puesto.sede_id, caja_id: puesto.caja_id }])).rows[0].r as VentaRegistrada;
  } catch (e) {
    const m = /no cubre el total \(([\d.]+)\)/.exec((e as Error).message ?? "");
    if (!vigilar || !m || Math.abs(Number(m[1]) - d.total_mostrado!) <= 1) throw e;
    await c.query("rollback to savepoint venta_total");
    throw new TotalCambio(Number(m[1]), d.total_mostrado!, await precios());
  }
  if (vigilar && !venta.repetida && Math.abs(Number(venta.total) - d.total_mostrado!) > 1) throw new TotalCambio(Number(venta.total), d.total_mostrado!, await precios());
  if (d.sin_conexion && d.creado) await c.query(`select set_config('regenta.venta_creado', '', true)`);
  if (ex && pideFormula(ex) && !venta.repetida) await c.query(`select registrar_formulas_venta($1, $2)`, [venta.venta_id, d.formula]);
  // Una venta hecha sin internet entra aunque hoy no haya turno abierto (ya se hizo en el mostrador), pero queda en la
  // bitácora del dueño: es dinero que no entra en ningún arqueo.
  if (sinTurno && d.sin_conexion && !venta.repetida) await c.query(`select marcar_venta_sin_turno($1)`, [venta.venta_id]);
  return { venta };
}

/** Emite solo el documento DIAN de esta venta (si la DIAN tarda o falla, la venta ya está guardada y la cola reintenta)
 *  y lo devuelve para la tirilla. */
export async function emitirDocumento(s: Sesion, ventaId: string) {
  await procesarCola(1, ventaId).catch((e) => console.error("cola DIAN", e));
  return comoUsuario(s, async (c) => (await c.query(`select tipo, estado, cufe, qr, simulado, ultimo_error from documentos_dian where venta_id = $1 and tipo <> 'nota_credito'`, [ventaId])).rows[0]);
}
