import { z } from "zod";
import { sinRLS } from "@/lib/db";
import { conSesion, json, limiteBD } from "@/lib/api";
import { cifrarClave, claveCorrecta, problemaClave } from "@/lib/claves";
import { crearSesion } from "@/lib/sesion";

const Cambio = z.union([
  z.object({ accion: z.literal("clave"), actual: z.string().max(200), nueva: z.string().max(200), repetir: z.string().max(200) }),
  z.object({ accion: z.literal("cerrar_otras") }),
]);

/** Mi cuenta: cambiar la contraseña (pide la actual) o cerrar la sesión en los demás equipos. En ambos casos sube la
 *  versión de la cuenta (las otras sesiones mueren) y este equipo sigue dentro con una sesión nueva. */
export const POST = conSesion(async (s, req) => {
  if (s.soporte) return json({ error: "El soporte de Regenta no cambia la contraseña de un usuario" }, 403);
  const p = Cambio.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: "Datos no válidos" }, 400);
  const cu = await sinRLS(async (c) => (await c.query(`select cu.clave_hash, e.demo from cuentas cu join miembros m on m.user_id = cu.id join empresas e on e.id = m.empresa_id
    where cu.id = $1 and m.empresa_id = $2`, [s.uid, s.empresa])).rows[0]);
  if (!cu || cu.demo) return json({ error: "En la demostración no hay contraseñas que cambiar" }, 403);
  if (p.data.accion === "clave") {
    const d = p.data;
    if (!(await limiteBD(`cambiar-clave:${s.uid}`, 5, "15 minutes"))) return json({ error: "Demasiados intentos. Espera unos minutos." }, 429);
    if (!(await claveCorrecta(d.actual, cu.clave_hash))) return json({ error: "La contraseña actual no es correcta" }, 400);
    if (d.nueva !== d.repetir) return json({ error: "Las dos contraseñas nuevas no coinciden" }, 400);
    const mal = problemaClave(d.nueva);
    if (mal) return json({ error: mal }, 400);
    if (d.nueva === d.actual) return json({ error: "La contraseña nueva debe ser distinta de la actual" }, 400);
    const hash = await cifrarClave(d.nueva);
    await sinRLS((c) => c.query(`update cuentas set clave_hash = $2, version_sesion = version_sesion + 1 where id = $1`, [s.uid, hash]));
  } else {
    await sinRLS((c) => c.query(`update cuentas set version_sesion = version_sesion + 1 where id = $1`, [s.uid]));
  }
  await crearSesion({ uid: s.uid, empresa: s.empresa, nombre: s.nombre, rol: s.rol });
  return json({ ok: true, mensaje: p.data.accion === "clave" ? "Contraseña cambiada. Se cerró la sesión en tus otros equipos." : "Listo: se cerró la sesión en tus otros equipos." });
});
