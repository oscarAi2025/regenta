import { z } from "zod";
import { comoUsuario } from "@/lib/db";
import { conSesion, json } from "@/lib/api";

const Entrada = z.object({
  tipo: z.enum(["compra", "ajuste", "inicial"]),
  motivo: z.string().trim().max(200).nullish(),
  lineas: z.array(z.object({
    producto_id: z.string().uuid(),
    lote: z.string().trim().min(1, "Falta el lote").max(40),
    vence: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullish(),
    unidades: z.number().int().refine((n) => n !== 0, "La cantidad no puede ser cero"),
    costo_unidad: z.number().min(0).nullish(),
  })).min(1).max(500),
});

/** Recibir mercancía o ajustar inventario (la función de la base de datos valida rol, motivo y negativos). */
export const POST = conSesion(async (s, req) => {
  const p = Entrada.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Datos no válidos" }, 400);
  const r = await comoUsuario(s, async (c) => {
    const sede = (await c.query(`select id from sedes where empresa_id = $1 order by creado limit 1`, [s.empresa])).rows[0];
    return (await c.query(`select registrar_entrada($1) r`, [{ ...p.data, empresa_id: s.empresa, sede_id: sede.id }])).rows[0].r;
  });
  return json(r, 201);
});
