import { comoUsuario } from "@/lib/db";
import { conSesion, esUuid, json } from "@/lib/api";
import { puedeDian } from "@/lib/dian/soporte";

/** XML de un documento electrónico (el que devolvió el proveedor o, en simulado, el de prueba marcado). Dueño o administrador. */
export const GET = conSesion(async (s, _req, ctx) => {
  if (!puedeDian.emitir(s.rol)) return json({ error: "Los documentos electrónicos son del dueño o el administrador" }, 403);
  const { id } = await ctx.params;
  if (!esUuid(id)) return json({ error: "Documento no válido" }, 400);
  const d = await comoUsuario(s, async (c) => (await c.query(`select prefijo || numero numero, xml from documentos_dian where id = $1 and empresa_id = $2`, [id, s.empresa])).rows[0]);
  if (!d) return json({ error: "Ese documento no existe en tu droguería" }, 404);
  if (!d.xml) return json({ error: "Este documento aún no tiene XML: aparece cuando el proveedor lo entrega" }, 404);
  const nombre = String(d.numero).replace(/[^A-Za-z0-9_-]/g, "");
  return new Response(d.xml, { headers: { "content-type": "application/xml; charset=utf-8", "content-disposition": `attachment; filename="${nombre}.xml"`, "cache-control": "no-store", "x-content-type-options": "nosniff" } });
});
