import { z } from "zod";
import { NextResponse } from "next/server";
import { sinRLS } from "@/lib/db";
import { esUuid } from "@/lib/api";
import { conAdmin, evento } from "@/lib/admin";

const fecha = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha AAAA-MM-DD").nullish().or(z.literal(""));
const Numeracion = z.object({
  tipo: z.enum(["pos", "factura", "nota_credito"]),
  prefijo: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{0,4}$/, "El prefijo DIAN tiene hasta 4 letras o números"),
  desde: z.number().int().positive().max(1e12), hasta: z.number().int().positive().max(1e12),
  numero_resolucion: z.string().trim().regex(/^\d{6,20}$/, "El número de resolución son solo dígitos").or(z.literal("")),
  vigente_desde: fecha, vigente_hasta: fecha,
  pruebas: z.boolean(),
}).refine((n) => n.hasta >= n.desde, { message: "«Hasta» debe ser mayor o igual que «desde»" })
  .refine((n) => n.pruebas || (n.numero_resolucion && n.vigente_hasta), { message: "En producción la numeración necesita número de resolución y fecha de vencimiento" });

/** Nueva numeración DIAN de un cliente (la que autoriza la resolución): desactiva la vigente del mismo tipo y la reemplaza.
 *  No deja reutilizar números ya emitidos con el mismo prefijo. */
export const POST = conAdmin(async (a, req, ctx) => {
  const { id } = await ctx.params;
  if (!esUuid(id)) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const p = Numeracion.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message ?? "Revisa los datos" }, { status: 400 });
  const n = p.data;
  const r = await sinRLS(async (c) => {
    const e = (await c.query(`select demo, matias_cliente from empresas where id = $1 for update`, [id])).rows[0];
    if (!e) return { status: 404, error: "Cliente no encontrado" };
    if (e.demo) return { status: 400, error: "La demo no se modifica desde aquí" };
    if (!n.pruebas && !e.matias_cliente) return { status: 400, error: "Primero conecta la droguería en MATIAS (UUID del cliente): sin él facturaría con el NIT de Regenta" };
    const usado = (await c.query(`select max(numero) m from documentos_dian where empresa_id = $1 and tipo = $2 and prefijo = $3`, [id, n.tipo, n.prefijo])).rows[0]?.m;
    if (usado && Number(usado) >= n.desde) return { status: 409, error: `Con el prefijo «${n.prefijo}» ya se emitió hasta el ${usado}: la numeración debe empezar después` };
    await c.query(`update resoluciones_dian set activa = false where empresa_id = $1 and tipo = $2 and activa`, [id, n.tipo]);
    await c.query(`insert into resoluciones_dian (empresa_id, tipo, numero_resolucion, prefijo, desde, hasta, actual, vigente_desde, vigente_hasta, pruebas)
      values ($1, $2, nullif($3, ''), $4, $5, $6, $5 - 1, nullif($7, '')::date, nullif($8, '')::date, $9)`,
      [id, n.tipo, n.numero_resolucion, n.prefijo, n.desde, n.hasta, n.vigente_desde ?? "", n.vigente_hasta ?? "", n.pruebas]);
    await evento(a, "nueva_numeracion", id, n, c);
    return { status: 201, ok: true };
  });
  if (r.error) return NextResponse.json({ error: r.error }, { status: r.status });
  return NextResponse.json({ ok: true, mensaje: "Numeración guardada: la siguiente venta usa la nueva" }, { status: 201 });
});
