import { comoUsuario } from "@/lib/db";
import { conSesion, esUuid, json } from "@/lib/api";
import { procesarCola } from "@/lib/dian";
import { SoporteNuevo, bloqueoEnvio, estadoSoporte, puedeDian } from "@/lib/dian/soporte";

/** Estado del documento soporte de una compra: el vigente con sus notas de ajuste y las compras de la semana. */
export const GET = conSesion(async (s, req) => {
  if (!puedeDian.emitir(s.rol)) return json({ error: "El documento soporte lo maneja el dueño o el administrador" }, 403);
  const compra = new URL(req.url).searchParams.get("compra") ?? "";
  if (!esUuid(compra)) return json({ error: "Compra no válida" }, 400);
  const e = await comoUsuario(s, (c) => estadoSoporte(c, s.empresa, compra));
  return e ? json(e) : json({ error: "Esa compra no existe en tu droguería" }, 404);
});

/** Genera el documento soporte de una compra (por operación) o de varias compras de la semana (semanal). */
export const POST = conSesion(async (s, req) => {
  if (!puedeDian.emitir(s.rol)) return json({ error: "Solo el dueño o el administrador generan documentos soporte" }, 403);
  const p = SoporteNuevo.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Elige la compra" }, 400);
  const r = await comoUsuario(s, async (c) => {
    const n = (await c.query(`select count(*)::int n from compras where id = any ($1::uuid[]) and empresa_id = $2`, [p.data.compras, s.empresa])).rows[0].n;
    if (n !== new Set(p.data.compras).size) return null;
    const bloqueo = await bloqueoEnvio(c, s.empresa, "soporte");
    if (bloqueo) return { bloqueo };
    return { doc: (await c.query(`select generar_soporte($1) r`, [{ empresa_id: s.empresa, ...p.data }])).rows[0].r as { id: string; numero: string; repetido: boolean } };
  });
  if (!r) return json({ error: "Esa compra no existe en tu droguería" }, 404);
  if ("bloqueo" in r) return json({ error: r.bloqueo }, 409);
  await procesarCola(2, undefined, r.doc.id).catch((e) => console.error("cola DIAN", e));
  const estado = await comoUsuario(s, (c) => estadoSoporte(c, s.empresa, p.data.compras[0]));
  return json({ ...r.doc, estado }, r.doc.repetido ? 200 : 201);
});
