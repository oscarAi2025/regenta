import { puede } from "@/lib/sesion";
import { z } from "zod";
import { cajaElegida } from "@/lib/caja-elegida";
import { comoUsuario, puestoDeTrabajo } from "@/lib/db";
import { conSesion, json } from "@/lib/api";
import { procesarCola } from "@/lib/dian";
import { errorFormula, exigencia, pideFormula } from "@/lib/control-especial";

const Pago = z.object({ medio: z.enum(["efectivo", "transferencia", "nequi", "daviplata", "tarjeta", "bre_b", "qr"]), valor: z.number().positive().max(1_000_000_000, "Revisa el valor recibido"), referencia: z.string().max(60).nullish() });
// Fórmula médica de la venta (productos marcados «venta con fórmula» o «control especial»). Se valida contra los productos
// reales en el servidor y, otra vez, en la base de datos.
const Formula = z.object({
  verificada: z.boolean().default(false),
  paciente_tipo_doc: z.string().max(5).default(""), paciente_doc: z.string().max(30).default(""), paciente_nombre: z.string().max(160).default(""),
  medico_nombre: z.string().max(160).default(""), medico_registro: z.string().max(60).default(""),
  formula_numero: z.string().max(60).default(""), formula_fecha: z.string().max(10).default(""),
});
const Venta = z.object({
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
  formula: Formula.nullish(),
}).refine((v) => v.condicion === "credito" ? v.pagos.length === 0 : v.pagos.length > 0, { message: "Datos de pago incompletos" })
  .refine((v) => v.tipo_doc === "pos" || v.cliente_id, { message: "La factura electrónica necesita el cliente" });

/** Registra la venta (la base de datos fija precios, lotes, numeración y reglas de crédito) y emite su documento DIAN. */
export const POST = conSesion(async (s, req) => {
  if (!puede.vender(s.rol)) return json({ error: "Tu usuario no puede vender" }, 403); // el permiso se mira antes que los datos
  const p = Venta.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues.find((i) => i.code === "custom")?.message ?? p.error.issues.find((i) => i.path.includes("pagos"))?.message ?? "Datos de la venta incompletos" }, 400);
  const caja = await cajaElegida();
  const r = await comoUsuario(s, async (c) => {
    const puesto = await puestoDeTrabajo(c, s.empresa, caja);
    if (!puesto.caja_id) throw Object.assign(new Error("Esta empresa no tiene cajas activas"), { code: "P0001" });
    // Con «exigir turno» activo no se vende sin turno abierto en la caja (como en Alegra POS).
    const sinTurno = (await c.query(`select e.exige_turno and not exists (select 1 from turnos t where t.caja_id = $2 and t.estado = 'abierto') falta
      from empresas e where e.id = $1`, [s.empresa, puesto.caja_id])).rows[0]?.falta;
    if (sinTurno && !p.data.sin_conexion) throw Object.assign(new Error("Abre el turno de caja antes de vender (Caja → Turno)"), { code: "P0001" });
    // Productos con fórmula médica: los datos se exigen antes de tocar la numeración (un dato que falta es un 400).
    const { rows: marcas } = await c.query(`select p.nombre, p.requiere_formula, p.control_especial, e.formula_vigencia_dias vigencia_dias, e.formula_exige_datos exige_datos
      from productos p join empresas e on e.id = p.empresa_id where p.empresa_id = $1 and p.id = any($2::uuid[]) and (p.requiere_formula or p.control_especial)`,
      [s.empresa, [...new Set(p.data.lineas.map((l) => l.producto_id))]]);
    const ex = marcas.length ? exigencia(marcas, marcas[0]) : null;
    if (ex && pideFormula(ex)) {
      const falta = errorFormula(p.data.formula, ex, marcas[0]);
      if (falta) return { invalida: ex.control.length ? `${falta} (${ex.control[0]} es de control especial)` : falta };
    }
    const venta = (await c.query(`select registrar_venta($1) r`, [{ ...p.data, formula: undefined, empresa_id: s.empresa, sede_id: puesto.sede_id, caja_id: puesto.caja_id }])).rows[0].r;
    if (ex && pideFormula(ex) && !venta.repetida) await c.query(`select registrar_formulas_venta($1, $2)`, [venta.venta_id, p.data.formula]);
    return venta;
  });
  if ("invalida" in r) return json({ error: r.invalida }, 400);
  // Emite solo el documento de esta venta: si la DIAN tarda o falla, la venta ya está guardada y la cola reintenta.
  await procesarCola(1, r.venta_id).catch((e) => console.error("cola DIAN", e));
  const doc = await comoUsuario(s, async (c) => (await c.query(`select tipo, estado, cufe, qr, simulado, ultimo_error from documentos_dian where venta_id = $1 and tipo <> 'nota_credito'`, [r.venta_id])).rows[0]);
  return json({ venta: r, documento: doc });
});
