import { z } from "zod";
import { comoUsuario } from "@/lib/db";
import { conSesion, json } from "@/lib/api";
import { puede } from "@/lib/sesion";

const Abono = z.object({
  venta_id: z.string().uuid(),
  medio: z.enum(["efectivo", "transferencia", "nequi", "daviplata", "tarjeta", "bre_b", "qr"]),
  valor: z.number().int("El abono va en pesos, sin centavos").positive("Escribe el valor del abono").max(1_000_000_000, "Revisa el valor del abono"),
  referencia: z.string().trim().max(60).nullish(),
});

/** Registrar un abono a una factura a crédito (la base de datos comprueba rol y saldo). */
export const POST = conSesion(async (s, req) => {
  if (!puede.cartera(s.rol)) return json({ error: "Solo el dueño o el administrador registran abonos" }, 403);
  const p = Abono.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Datos del abono incompletos" }, 400);
  const r = await comoUsuario(s, async (c) => {
    if (!(await c.query(`select 1 from ventas where id = $1 and empresa_id = $2`, [p.data.venta_id, s.empresa])).rowCount) return null;
    return (await c.query(`select registrar_abono($1, $2, $3, $4) r`, [p.data.venta_id, p.data.medio, p.data.valor, p.data.referencia ?? null])).rows[0].r;
  });
  if (!r) return json({ error: "Esa venta no existe en tu droguería" }, 404);
  return json(r, 201);
});
