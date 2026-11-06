import { z } from "zod";
import { comoUsuario } from "@/lib/db";
import { conSesion, esUuid, json } from "@/lib/api";
import { normalizarCredito, permisoCartera } from "@/lib/cartera";

/** Contrato para la caja: ¿se le puede fiar a este cliente una venta de `valor`? → { puede_fiar, cupo_disponible, motivo, … }.
 *  Quien vende (dueño, administrador, cajera). `requiere_motivo`: la gerencia puede autorizarlo con un motivo. */
export const GET = conSesion(async (s, req, ctx) => {
  if (!permisoCartera.verCredito(s.rol)) return json({ error: "No tienes permiso para ver el crédito de los clientes" }, 403);
  const { id } = await ctx.params;
  if (!esUuid(id)) return json({ error: "Cliente no encontrado" }, 404);
  const v = new URL(req.url).searchParams.get("valor") ?? "0";
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(v)) return json({ error: "El valor debe ser un número en pesos" }, 400);
  const r = await comoUsuario(s, async (c) => {
    if (!(await c.query(`select 1 from clientes where id = $1 and empresa_id = $2`, [id, s.empresa])).rowCount) return null;
    return (await c.query(`select estado_credito($1, $2) e`, [id, Number(v)])).rows[0].e;
  });
  if (!r) return json({ error: "Cliente no encontrado" }, 404);
  return json(normalizarCredito(r));
});

const Datos = z.object({
  cupo_credito: z.number().int("El cupo va en pesos, sin centavos").min(0, "El cupo no puede ser negativo").max(10_000_000_000, "Revisa el cupo").nullable(),
  plazo_dias_defecto: z.number().int().min(1, "El plazo va de 1 a 180 días").max(180, "El plazo va de 1 a 180 días").nullable(),
  credito_bloqueado: z.boolean(),
  notas: z.string().trim().max(500, "Las notas van hasta 500 caracteres").nullish(),
});

/** Cupo, plazo por defecto, bloqueo y notas del cliente (dueño o administrador; queda en la auditoría). */
export const PATCH = conSesion(async (s, req, ctx) => {
  if (!permisoCartera.gestionar(s.rol)) return json({ error: "Solo el dueño o el administrador cambian el crédito de un cliente" }, 403);
  const { id } = await ctx.params;
  if (!esUuid(id)) return json({ error: "Cliente no encontrado" }, 404);
  const p = Datos.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Revisa los datos de crédito" }, 400);
  const d = p.data;
  const r = await comoUsuario(s, async (c) => {
    if (!(await c.query(`select 1 from clientes where id = $1 and empresa_id = $2`, [id, s.empresa])).rowCount) return null;
    return (await c.query(`select configurar_credito_cliente($1, $2, $3, $4, $5) e`, [id, d.cupo_credito, d.plazo_dias_defecto, d.credito_bloqueado, d.notas ?? null])).rows[0].e;
  });
  if (!r) return json({ error: "Cliente no encontrado" }, 404);
  return json({ credito: normalizarCredito(r), mensaje: "Crédito del cliente guardado" });
});
