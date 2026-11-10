import { claveIdem, idempotente } from "@/lib/idem";
import { puede } from "@/lib/sesion";
import { z } from "zod";
import { cajaElegida } from "@/lib/caja-elegida";
import { comoUsuario, puestoDeTrabajo } from "@/lib/db";
import { conSesion, esUuid, json } from "@/lib/api";
import { procesarCola } from "@/lib/dian";

const Devolucion = z.object({
  motivo: z.string().trim().min(4, "Escribe el motivo de la devolución").max(200),
  medio: z.enum(["efectivo", "transferencia", "nequi", "daviplata", "tarjeta", "bre_b"]).default("efectivo"),
  // A dónde vuelve lo devuelto: a la venta o a cuarentena (sin enviar: lo que configuró la droguería).
  destino: z.enum(["vendible", "cuarentena"]).optional(),
  lineas: z.array(z.object({
    producto_id: z.string().uuid(), presentacion: z.enum(["caja", "unidad"]), cantidad: z.number().positive().max(100000),
  })).min(1, "Elige qué productos devuelve el cliente").max(200),
});

/** Devolución parcial (solo dueño o administrador; la base de datos reparte por lotes, devuelve inventario y crea la nota crédito). */
export const POST = conSesion(async (s, req, ctx) => {
  if (!puede.anular(s.rol)) return json({ error: "Solo el dueño o el administrador hacen devoluciones" }, 403); // el permiso se mira antes que los datos
  const { id } = await ctx.params;
  if (!esUuid(id)) return json({ error: "No encontrado" }, 404);
  const cuerpo = await req.json().catch(() => null);
  const p = Devolucion.safeParse(cuerpo);
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Datos de la devolución incompletos" }, 400);
  const r = await comoUsuario(s, async (c) => {
    const v = (await c.query(`select origen from ventas where id = $1 and empresa_id = $2`, [id, s.empresa])).rows[0];
    if (!v) return null;
    if (v.origen) return { deAlegra: true }; // las ventas traídas de Alegra se devuelven en Alegra
    // La nota crédito referencia la factura: si la DIAN la rechazó, primero se corrige y se reenvía.
    if ((await c.query(`select 1 from documentos_dian where venta_id = $1 and devolucion_id is null and tipo <> 'nota_credito' and estado = 'rechazado'`, [id])).rowCount)
      return { rechazada: true };
    const puesto = await puestoDeTrabajo(c, s.empresa, await cajaElegida()).catch(() => null);
    return idempotente(c, s.empresa, claveIdem(cuerpo?.idem_key), async () =>
      (await c.query(`select devolver_venta($1) r`, [{ ...p.data, venta_id: id, caja_id: puesto?.caja_id ?? null }])).rows[0].r);
  });
  if (!r) return json({ error: "Ese registro no existe en tu droguería" }, 404);
  if ("deAlegra" in r) return json({ error: "Esta venta viene de Alegra: la devolución se hace en Alegra" }, 422);
  if ("rechazada" in r && r.rechazada) return json({ error: "La DIAN rechazó el documento de esta venta: corrígelo y reenvíalo antes de hacer la devolución." }, 409);
  await procesarCola(3, id).catch((e) => console.error("cola DIAN", e));
  return json({ devolucion: r });
});

/** Destino por defecto de las devoluciones de esta droguería (para preseleccionarlo en la pantalla). */
export const GET = conSesion(async (s) => {
  if (!puede.anular(s.rol)) return json({ error: "Solo el dueño o el administrador hacen devoluciones" }, 403);
  const destino = await comoUsuario(s, async (c) => (await c.query(`select devolucion_destino d from empresas where id = $1`, [s.empresa])).rows[0]?.d ?? "vendible");
  return json({ destino });
});
