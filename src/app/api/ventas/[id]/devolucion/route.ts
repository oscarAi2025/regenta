import { puede } from "@/lib/sesion";
import { z } from "zod";
import { comoUsuario, puestoDeTrabajo } from "@/lib/db";
import { conSesion, esUuid, json } from "@/lib/api";
import { procesarCola } from "@/lib/dian";

const Devolucion = z.object({
  motivo: z.string().trim().min(4, "Escribe el motivo de la devolución").max(200),
  medio: z.enum(["efectivo", "transferencia", "nequi", "daviplata", "tarjeta", "bre_b"]).default("efectivo"),
  lineas: z.array(z.object({
    producto_id: z.string().uuid(), presentacion: z.enum(["caja", "unidad"]), cantidad: z.number().positive().max(100000),
  })).min(1, "Elige qué productos devuelve el cliente").max(200),
});

/** Devolución parcial (solo dueño o administrador; la base de datos reparte por lotes, devuelve inventario y crea la nota crédito). */
export const POST = conSesion(async (s, req, ctx) => {
  if (!puede.anular(s.rol)) return json({ error: "Solo el dueño o el administrador hacen devoluciones" }, 403); // el permiso se mira antes que los datos
  const { id } = await ctx.params;
  if (!esUuid(id)) return json({ error: "No encontrado" }, 404);
  const p = Devolucion.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Datos de la devolución incompletos" }, 400);
  const r = await comoUsuario(s, async (c) => {
    if (!(await c.query(`select 1 from ventas where id = $1 and empresa_id = $2`, [id, s.empresa])).rowCount) return null;
    // La nota crédito referencia la factura: si la DIAN la rechazó, primero se corrige y se reenvía.
    if ((await c.query(`select 1 from documentos_dian where venta_id = $1 and devolucion_id is null and tipo <> 'nota_credito' and estado = 'rechazado'`, [id])).rowCount)
      return { rechazada: true };
    const puesto = await puestoDeTrabajo(c, s.empresa).catch(() => null);
    return (await c.query(`select devolver_venta($1) r`, [{ ...p.data, venta_id: id, caja_id: puesto?.caja_id ?? null }])).rows[0].r;
  });
  if (!r) return json({ error: "Ese registro no existe en tu droguería" }, 404);
  if (r.rechazada) return json({ error: "La DIAN rechazó el documento de esta venta: corrígelo y reenvíalo antes de hacer la devolución." }, 409);
  await procesarCola(3, id).catch((e) => console.error("cola DIAN", e));
  return json({ devolucion: r });
});
