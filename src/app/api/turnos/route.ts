import { puede } from "@/lib/sesion";
import { z } from "zod";
import { cajaElegida } from "@/lib/caja-elegida";
import { comoUsuario, puestoDeTrabajo } from "@/lib/db";
import { estadoTurno } from "@/lib/turnos";
import { conSesion, json } from "@/lib/api";

// Turnos de caja: abrir con base, ingresos/egresos de efectivo y cierre con el dinero contado. Las reglas (permisos,
// un solo turno abierto por caja, cifras del cierre) las hace la base de datos.
const Accion = z.discriminatedUnion("accion", [
  z.object({ accion: z.literal("abrir"), base: z.number().int().min(0).max(100_000_000) }),
  z.object({ accion: z.literal("movimiento"), turno: z.string().uuid(), tipo: z.enum(["ingreso", "egreso"]), valor: z.number().int().positive().max(100_000_000), concepto: z.string().trim().min(3, "Escribe el concepto").max(120) }),
  z.object({ accion: z.literal("cerrar"), turno: z.string().uuid(), contado: z.number().int().min(0).max(1_000_000_000), observaciones: z.string().trim().max(500).nullish() }),
  z.object({ accion: z.literal("exigir"), valor: z.boolean() }),
]);

export const GET = conSesion(async (s) => { const caja = await cajaElegida(); return json(await comoUsuario(s, (c) => estadoTurno(c, s.empresa, caja))); });

export const POST = conSesion(async (s, req) => {
  if (!puede.vender(s.rol)) return json({ error: "Solo quien vende maneja el turno de caja" }, 403); // el permiso se mira antes que los datos
  const p = Accion.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Datos incompletos" }, 400);
  const a = p.data;
  const caja = await cajaElegida();
  const r = await comoUsuario(s, async (c) => {
    if (a.accion === "abrir") {
      const { caja_id } = await puestoDeTrabajo(c, s.empresa, caja);
      if (!caja_id) throw Object.assign(new Error("Esta empresa no tiene cajas activas"), { code: "P0001" });
      return { turno: (await c.query(`select abrir_turno($1, $2) id`, [caja_id, a.base])).rows[0].id };
    }
    if (a.accion === "movimiento") return { id: (await c.query(`select movimiento_caja($1, $2, $3, $4) id`, [a.turno, a.tipo, a.valor, a.concepto])).rows[0].id };
    if (a.accion === "cerrar") return { cierre: (await c.query(`select cerrar_turno($1, $2, $3) r`, [a.turno, a.contado, a.observaciones ?? null])).rows[0].r, turno: a.turno };
    await c.query(`select exigir_turno($1, $2)`, [s.empresa, a.valor]);
    return { ok: true };
  });
  return json(r);
});
