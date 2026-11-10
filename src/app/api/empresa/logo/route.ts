import { sinRLS } from "@/lib/db";
import { conSesion, json } from "@/lib/api";
import { LogoCuerpo } from "@/lib/logo";

/** El dueño sube o quita el logo que sale en sus facturas en tamaño carta. */
export const PUT = conSesion(async (s, req) => {
  if (s.rol !== "dueno") return json({ error: "Solo el dueño cambia el logo de la droguería" }, 403);
  const p = LogoCuerpo.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Imagen no válida" }, 400);
  const r = await sinRLS(async (c) => {
    // La demo pública es de todos: ahí no se sube ninguna imagen.
    if (!(await c.query(`update empresas set logo = $2 where id = $1 and not demo`, [s.empresa, p.data.logo])).rowCount) return false;
    await c.query(`insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos) values ($1, $2, $3, 'empresas', $4, $5)`,
      [s.empresa, s.uid, p.data.logo ? "logo_cambiado" : "logo_quitado", s.empresa, { tamano: p.data.logo?.length ?? 0 }]);
    return true;
  });
  if (!r) return json({ error: "En la demo no se cambia el logo: súbelo en tu propia droguería" }, 403);
  return json({ ok: true, mensaje: p.data.logo ? "Logo guardado: ya sale en tus facturas" : "Logo quitado" });
});
