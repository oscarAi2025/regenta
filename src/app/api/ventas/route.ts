import { z } from "zod";
import { comoUsuario, puestoDeTrabajo } from "@/lib/db";
import { conSesion, json } from "@/lib/api";
import { procesarCola } from "@/lib/dian";

const Pago = z.object({ medio: z.enum(["efectivo", "transferencia", "nequi", "daviplata", "tarjeta", "bre_b", "qr"]), valor: z.number().positive().max(1_000_000_000, "Revisa el valor recibido"), referencia: z.string().max(60).nullish() });
const Venta = z.object({
  idem_key: z.string().uuid(),
  tipo_doc: z.enum(["pos", "factura"]),
  cliente_id: z.string().uuid().nullish(),
  condicion: z.enum(["contado", "credito"]).default("contado"),
  plazo_dias: z.number().int().min(1).max(180).nullish(),
  lineas: z.array(z.object({ producto_id: z.string().uuid(), presentacion: z.enum(["caja", "unidad"]), cantidad: z.number().int().positive().max(10000), descuento_pct: z.number().min(0).max(99).optional() })).min(1).max(200),
  descuento_pct: z.number().min(0).max(99).optional(),
  pagos: z.array(Pago).max(6),
}).refine((v) => v.condicion === "credito" ? v.pagos.length === 0 : v.pagos.length > 0, { message: "Datos de pago incompletos" })
  .refine((v) => v.tipo_doc === "pos" || v.cliente_id, { message: "La factura electrónica necesita el cliente" });

/** Registra la venta (la base de datos fija precios, lotes, numeración y reglas de crédito) y emite su documento DIAN. */
export const POST = conSesion(async (s, req) => {
  const p = Venta.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues.find((i) => i.code === "custom")?.message ?? p.error.issues.find((i) => i.path.includes("pagos"))?.message ?? "Datos de la venta incompletos" }, 400);
  const r = await comoUsuario(s, async (c) => {
    const puesto = await puestoDeTrabajo(c, s.empresa);
    if (!puesto.caja_id) throw Object.assign(new Error("Esta empresa no tiene cajas activas"), { code: "P0001" });
    // Con «exigir turno» activo no se vende sin turno abierto en la caja (como en Alegra POS).
    const sinTurno = (await c.query(`select e.exige_turno and not exists (select 1 from turnos t where t.caja_id = $2 and t.estado = 'abierto') falta
      from empresas e where e.id = $1`, [s.empresa, puesto.caja_id])).rows[0]?.falta;
    if (sinTurno) throw Object.assign(new Error("Abre el turno de caja antes de vender (Caja → Turno)"), { code: "P0001" });
    return (await c.query(`select registrar_venta($1) r`, [{ ...p.data, empresa_id: s.empresa, sede_id: puesto.sede_id, caja_id: puesto.caja_id }])).rows[0].r;
  });
  // Emite solo el documento de esta venta: si la DIAN tarda o falla, la venta ya está guardada y la cola reintenta.
  await procesarCola(1, r.venta_id).catch((e) => console.error("cola DIAN", e));
  const doc = await comoUsuario(s, async (c) => (await c.query(`select tipo, estado, cufe, qr, simulado, ultimo_error from documentos_dian where venta_id = $1 and tipo <> 'nota_credito'`, [r.venta_id])).rows[0]);
  return json({ venta: r, documento: doc });
});
