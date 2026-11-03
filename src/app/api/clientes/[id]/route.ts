import { comoUsuario, mensajeError } from "@/lib/db";
import { conSesion, esUuid, json } from "@/lib/api";
import { ClienteEntrada, dvNit, primerError } from "@/lib/validar";
import { puede } from "@/lib/sesion";
import { z } from "zod";

const Quitar = z.object({ quitar_contacto: z.literal(true) });

/** Corregir un cliente (documento, nombre, contacto) o, a su pedido, quitar sus datos de contacto (Ley 1581): el nombre y
 *  el documento se conservan porque van en sus facturas. Solo dueño y administrador. */
export const PATCH = conSesion(async (s, req, ctx) => {
  if (!puede.verCostos(s.rol)) return json({ error: "Solo el dueño o el administrador corrigen clientes" }, 403);
  const { id } = await ctx.params;
  if (!esUuid(id)) return json({ error: "No encontrado" }, 404);
  const cuerpo = await req.json().catch(() => null);
  const q = Quitar.safeParse(cuerpo);
  const p = q.success ? null : ClienteEntrada.safeParse(cuerpo);
  if (p && !p.success) return json({ error: primerError(p.error) }, 400);
  try {
    const cliente = await comoUsuario(s, async (c) => {
      if (q.success) return (await c.query(`update clientes set email = null, telefono = null, autoriza_datos = false where id = $1 and empresa_id = $2 returning id`, [id, s.empresa])).rows[0];
      const d = p!.data!;
      return (await c.query(`update clientes set tipo_doc = $3, numero_doc = $4, dv = $5, nombre = $6, email = $7, telefono = $8, autoriza_datos = $9
        where id = $1 and empresa_id = $2 returning id`, [id, s.empresa, d.tipo_doc, d.numero_doc, d.tipo_doc === "NIT" ? dvNit(d.numero_doc) : null, d.nombre, d.email || null, d.telefono || null, d.autoriza_datos])).rows[0];
    });
    if (!cliente) return json({ error: "Cliente no encontrado" }, 404);
    return json({ ok: true, mensaje: q.success ? "Datos de contacto quitados" : "Cliente guardado" });
  } catch (e) {
    if ((e as { code?: string }).code === "23505") return json({ error: "Ya hay otro cliente con ese documento" }, 409);
    const m = mensajeError(e); return json({ error: m.error }, m.status);
  }
});
