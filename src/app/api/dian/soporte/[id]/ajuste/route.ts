import { comoUsuario } from "@/lib/db";
import { conSesion, esUuid, json } from "@/lib/api";
import { procesarCola } from "@/lib/dian";
import { AjusteNuevo, bloqueoEnvio, estadoSoporte, puedeDian } from "@/lib/dian/soporte";

/** Nota de ajuste de un documento soporte: lo anula (libera sus compras) o corrige su valor, con motivo. */
export const POST = conSesion(async (s, req, ctx) => {
  if (!puedeDian.emitir(s.rol)) return json({ error: "Solo el dueño o el administrador hacen notas de ajuste" }, 403);
  const { id } = await ctx.params;
  if (!esUuid(id)) return json({ error: "Documento no válido" }, 400);
  const p = AjusteNuevo.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Revisa la nota de ajuste" }, 400);
  const r = await comoUsuario(s, async (c) => {
    const compra = (await c.query(`select (select s.compra_id from soporte_compras s where s.documento_id = d.id order by s.id limit 1) compra
      from documentos_dian d where d.id = $1 and d.empresa_id = $2 and d.tipo = 'soporte'`, [id, s.empresa])).rows[0];
    if (!compra) return null;
    const bloqueo = await bloqueoEnvio(c, s.empresa, "ajuste_soporte");
    if (bloqueo) return { bloqueo };
    const doc = (await c.query(`select ajustar_soporte($1) r`, [{ documento_id: id, ...p.data }])).rows[0].r as { id: string; numero: string; repetido: boolean };
    return { doc, compra: compra.compra as string };
  });
  if (!r) return json({ error: "Ese documento soporte no existe en tu droguería" }, 404);
  if ("bloqueo" in r) return json({ error: r.bloqueo }, 409);
  await procesarCola(2, undefined, r.doc.id).catch((e) => console.error("cola DIAN", e));
  const estado = await comoUsuario(s, (c) => estadoSoporte(c, s.empresa, r.compra));
  return json({ ...r.doc, estado }, r.doc.repetido ? 200 : 201);
});
