import { z } from "zod";
import { sinRLS } from "@/lib/db";
import { conSesion, json } from "@/lib/api";

const opc = (max: number) => z.string().trim().max(max).transform((x) => x || null).nullish();
const Datos = z.object({
  nombre_comercial: z.string().trim().min(2, "Escribe el nombre comercial").max(120),
  direccion: opc(160), ciudad: opc(80), telefono: z.string().trim().regex(/^[\d\s+()-]{0,20}$/, "Teléfono no válido").transform((x) => x || null).nullish(),
  email: z.union([z.literal(""), z.string().trim().toLowerCase().email("Correo no válido").max(160)]).transform((x) => x || null).nullish(),
  descuento_max_cajero: z.number().min(0).max(99),
  egreso_max_cajero: z.number().int().min(0).max(100_000_000),
});

/** Datos de la droguería que el dueño mantiene (los fiscales —NIT, razón social, responsable de IVA— los cambia soporte,
 *  porque van en la factura electrónica y en la habilitación ante la DIAN). */
export const PATCH = conSesion(async (s, req) => {
  if (s.rol !== "dueno") return json({ error: "Solo el dueño cambia los datos de la droguería" }, 403);
  const p = Datos.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Revisa los datos" }, 400);
  const d = p.data;
  const ok = await sinRLS(async (c) => {
    if ((await c.query(`select demo from empresas where id = $1`, [s.empresa])).rows[0]?.demo) return false;
    await c.query(`update empresas set nombre_comercial = $2, direccion = $3, ciudad = $4, telefono = $5, email = $6, descuento_max_cajero = $7, egreso_max_cajero = $8 where id = $1`,
      [s.empresa, d.nombre_comercial, d.direccion ?? null, d.ciudad ?? null, d.telefono ?? null, d.email ?? null, d.descuento_max_cajero, d.egreso_max_cajero]);
    await c.query(`insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos) values ($1, $2, 'configurar_empresa', 'empresas', $1, $3)`, [s.empresa, s.uid, JSON.stringify(d)]);
    return true;
  });
  if (!ok) return json({ error: "En la demostración no se cambian los datos de la droguería" }, 409);
  return json({ ok: true });
});
