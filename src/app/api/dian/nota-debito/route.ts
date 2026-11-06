import { comoUsuario } from "@/lib/db";
import { conSesion, esUuid, json } from "@/lib/api";
import { procesarCola } from "@/lib/dian";
import { NotaDebitoNueva, bloqueoEnvio, facturaParaNotaDebito, puedeDian } from "@/lib/dian/soporte";

/** Factura con sus líneas y notas débito (para la pantalla de nota débito). */
export const GET = conSesion(async (s, req) => {
  if (!puedeDian.emitir(s.rol)) return json({ error: "Las notas débito las hace el dueño o el administrador" }, 403);
  const id = new URL(req.url).searchParams.get("factura") ?? "";
  if (!esUuid(id)) return json({ error: "Factura no válida" }, 400);
  const f = await comoUsuario(s, (c) => facturaParaNotaDebito(c, s.empresa, id));
  return f ? json(f) : json({ error: "Esa factura no existe en tu droguería" }, 404);
});

/** Nota débito sobre una factura electrónica (mayor valor: conceptos con su valor). Solo dueño o administrador. */
export const POST = conSesion(async (s, req) => {
  if (!puedeDian.emitir(s.rol)) return json({ error: "Solo el dueño o el administrador hacen notas débito" }, 403);
  const p = NotaDebitoNueva.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Revisa la nota débito" }, 400);
  const r = await comoUsuario(s, async (c) => {
    if (!(await c.query(`select 1 from documentos_dian where id = $1 and empresa_id = $2 and tipo = 'factura'`, [p.data.documento_id, s.empresa])).rowCount) return null;
    const bloqueo = await bloqueoEnvio(c, s.empresa, "nota_debito");
    if (bloqueo) return { bloqueo };
    return { doc: (await c.query(`select nota_debito($1) r`, [p.data])).rows[0].r as { id: string; numero: string; repetido: boolean } };
  });
  if (!r) return json({ error: "Esa factura no existe en tu droguería" }, 404);
  if ("bloqueo" in r) return json({ error: r.bloqueo }, 409);
  await procesarCola(2, undefined, r.doc.id).catch((e) => console.error("cola DIAN", e));
  const f = await comoUsuario(s, (c) => facturaParaNotaDebito(c, s.empresa, p.data.documento_id));
  return json({ ...r.doc, ...f }, r.doc.repetido ? 200 : 201);
});
