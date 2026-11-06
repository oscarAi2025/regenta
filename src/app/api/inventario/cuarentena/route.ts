import { z } from "zod";
import { comoUsuario } from "@/lib/db";
import { conSesion, json } from "@/lib/api";
import { puedePrecios } from "@/lib/precios";
import { lotesSeparados } from "@/lib/cuarentena-datos";

const sinPermiso = () => json({ error: "Solo el dueño, el administrador o la bodega manejan la cuarentena" }, 403);

/** Lotes separados con existencias y el destino por defecto de las devoluciones. */
export const GET = conSesion(async (s) => {
  if (!puedePrecios.cuarentena(s.rol)) return sinPermiso();
  return json(await comoUsuario(s, async (c) => ({
    lotes: await lotesSeparados(c, s.empresa),
    destino: (await c.query(`select devolucion_destino from empresas where id = $1`, [s.empresa])).rows[0]?.devolucion_destino ?? "vendible",
  })));
});

/** Poner un lote en cuarentena con motivo (no se vende hasta liberarlo o darlo de baja). */
export const POST = conSesion(async (s, req) => {
  if (!puedePrecios.cuarentena(s.rol)) return sinPermiso();
  const p = z.object({ lote_id: z.string().uuid("Elige el lote"), motivo: z.string().trim().min(4, "Escribe por qué se separa el lote").max(200) }).safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Datos incompletos" }, 400);
  const r = await comoUsuario(s, async (c) => {
    if (!(await c.query(`select 1 from lotes where id = $1 and empresa_id = $2`, [p.data.lote_id, s.empresa])).rowCount) return null;
    await c.query(`select poner_cuarentena($1, $2)`, [p.data.lote_id, p.data.motivo]);
    return { lotes: await lotesSeparados(c, s.empresa) };
  });
  return r ? json(r, 201) : json({ error: "Ese lote no existe en tu droguería" }, 404);
});

/** Destino por defecto de lo que devuelve un cliente (dueño o administrador). */
export const PATCH = conSesion(async (s, req) => {
  if (s.rol !== "dueno" && s.rol !== "admin") return json({ error: "Solo el dueño o el administrador cambian esta configuración" }, 403);
  const p = z.object({ destino: z.enum(["vendible", "cuarentena"], { errorMap: () => ({ message: "Elige a dónde van las devoluciones" }) }) }).safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Datos incompletos" }, 400);
  await comoUsuario(s, (c) => c.query(`select configurar_devoluciones($1, $2)`, [s.empresa, p.data.destino]));
  return json({ destino: p.data.destino });
});
