import { z } from "zod";
import { comoUsuario } from "@/lib/db";
import { conSesion, json } from "@/lib/api";

const Revision = z.object({ alerta_id: z.coerce.number().int().positive(), producto_id: z.string().uuid().nullish(), resultado: z.enum(["no_aplica", "sin_lote", "separado"]), nota: z.string().trim().max(300).nullish() });

/** Deja constancia de qué hizo la droguería con una alerta (quién y cuándo lo guarda la base de datos). */
export const POST = conSesion(async (s, req) => {
  const p = Revision.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: "Datos no válidos" }, 400);
  await comoUsuario(s, (c) => c.query(`insert into alertas_revision (empresa_id, alerta_id, producto_id, resultado, nota) values ($1, $2, $3, $4, $5)`,
    [s.empresa, p.data.alerta_id, p.data.producto_id ?? null, p.data.resultado, p.data.nota ?? null]));
  return json({ ok: true }, 201);
});
