import { z } from "zod";
import { sinRLS } from "@/lib/db";
import { conSesion, json } from "@/lib/api";

const Cuerpo = z.object({ formato: z.enum(["carta", "tirilla"], { errorMap: () => ({ message: "Elige carta o tirilla" }) }) });

/** Cómo sale la factura electrónica al cobrar en las cajas de la droguería (cada caja puede cambiarlo en su equipo). */
export const PUT = conSesion(async (s, req) => {
  if (s.rol !== "dueno" && s.rol !== "admin") return json({ error: "Solo el dueño o el administrador cambian esta configuración" }, 403);
  const p = Cuerpo.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Datos no válidos" }, 400);
  await sinRLS(async (c) => {
    await c.query(`update empresas set factura_formato = $2 where id = $1`, [s.empresa, p.data.formato]);
    await c.query(`insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos) values ($1, $2, 'formato_factura', 'empresas', $3, $4)`,
      [s.empresa, s.uid, s.empresa, { formato: p.data.formato }]);
  });
  return json({ ok: true, mensaje: p.data.formato === "carta" ? "Las facturas salen en tamaño carta" : "Las facturas salen en la tirilla de la térmica" });
});
