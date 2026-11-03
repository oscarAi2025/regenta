import { z } from "zod";
import { sinRLS } from "@/lib/db";
import { conSesion, json } from "@/lib/api";
import { enlaceInvitacion, invitar } from "@/lib/admin-datos";
import { encolar, enviarAhora } from "@/lib/correo";
import { limite } from "@/lib/planes";

// El dueño administra su equipo: invita, desactiva y reenvía enlaces. No crea otros dueños (eso pasa por soporte).
const Nuevo = z.object({ nombre: z.string().trim().min(3, "Escribe el nombre").max(120), email: z.string().trim().toLowerCase().email("Correo no válido").max(160),
  rol: z.enum(["admin", "cajero", "bodeguero"]) });
const Cambio = z.object({ cuenta_id: z.string().uuid(), activo: z.boolean().optional(), enlace: z.literal(true).optional(), rol: z.enum(["admin", "cajero", "bodeguero"]).optional() });
const negar = (m: string, status = 400) => Object.assign(new Error(m), { status });

async function base(c: Parameters<Parameters<typeof sinRLS>[0]>[0], empresa: string) {
  const e = (await c.query(`select demo, plan, coalesce(nombre_comercial, razon_social) nombre from empresas where id = $1`, [empresa])).rows[0];
  if (e.demo) throw negar("En la demostración no se cambian los usuarios. Al contratar creas a tu equipo aquí mismo.");
  return e as { demo: boolean; plan: string; nombre: string };
}
/** Una cuenta que ya existe solo se puede vincular desde aquí si no pertenece a otra droguería ni tiene contraseña propia
 *  (si no, el dueño de una droguería podría «invitar» al dueño de otra y quedarse con su cuenta). Esos casos van por soporte. */
async function cuentaAjena(c: Parameters<Parameters<typeof sinRLS>[0]>[0], empresa: string, where: string, valor: string) {
  const r = (await c.query(`select cu.id, cu.clave_hash is not null tiene_clave,
      exists (select 1 from miembros m where m.user_id = cu.id and m.empresa_id <> $1) otra,
      exists (select 1 from miembros m where m.user_id = cu.id and m.empresa_id = $1) aqui
    from cuentas cu where ${where} = $2`, [empresa, valor])).rows[0] as { id: string; tiene_clave: boolean; otra: boolean; aqui: boolean } | undefined;
  return r;
}
async function cupo(c: Parameters<Parameters<typeof sinRLS>[0]>[0], empresa: string, plan: string) {
  const tope = limite(plan).usuarios;
  if (tope === null) return;
  const n = Number((await c.query(`select count(*) n from miembros where empresa_id = $1 and activo`, [empresa])).rows[0].n);
  if (n >= tope) throw negar(`Tu plan Esencial incluye hasta ${tope} usuarios activos. Desactiva uno o pásate a Pro (usuarios ilimitados).`, 409);
}
const responder = (e: unknown) => {
  const x = e as { status?: number; code?: string; message: string };
  if (x.status || x.code === "P0001") return json({ error: x.message }, x.status ?? 400);
  throw e;
};

export const POST = conSesion(async (s, req) => {
  if (s.rol !== "dueno") return json({ error: "Solo el dueño administra el equipo" }, 403);
  const p = Nuevo.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: p.error.issues[0]?.message ?? "Revisa los datos" }, 400);
  try {
    const r = await sinRLS(async (c) => {
      const e = await base(c, s.empresa);
      const previa = await cuentaAjena(c, s.empresa, "lower(cu.email)", p.data.email);
      if (previa && (previa.otra || (previa.tiene_clave && !previa.aqui)))
        throw negar("Ese correo ya tiene una cuenta en Regenta. Usa otro correo para esta persona o escríbenos por WhatsApp y lo vinculamos.", 409);
      const ya = (await c.query(`select m.activo, m.rol from miembros m join cuentas cu on cu.id = m.user_id where m.empresa_id = $1 and lower(cu.email) = $2`, [s.empresa, p.data.email])).rows[0];
      if (ya?.rol === "dueno") throw negar("Ese correo es del dueño");
      if (!ya?.activo) await cupo(c, s.empresa, e.plan);
      const inv = await invitar(c, s.empresa, p.data);
      const clave = inv.enlace ? `invitacion:${inv.cuenta_id}:${Date.now()}` : null;
      if (clave) await encolar(c, { clave, para: p.data.email, plantilla: "invitacion", empresa: s.empresa, datos: { nombre: p.data.nombre, empresa: e.nombre, enlace: inv.enlace } });
      await c.query(`insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos) values ($1, $2, 'invitar_usuario', 'miembros', $3, $4)`,
        [s.empresa, s.uid, inv.cuenta_id, JSON.stringify({ email: p.data.email, rol: p.data.rol })]);
      return { ...inv, clave };
    });
    if (r.clave) await enviarAhora(r.clave);
    return json({ enlace: r.enlace, mensaje: r.enlace ? "Listo: le enviamos el enlace por correo. También puedes mandárselo por WhatsApp." : "Listo: ya tenía contraseña, entra con la suya." }, 201);
  } catch (e) { return responder(e); }
});

export const PATCH = conSesion(async (s, req) => {
  if (s.rol !== "dueno") return json({ error: "Solo el dueño administra el equipo" }, 403);
  const p = Cambio.safeParse(await req.json().catch(() => null));
  if (!p.success) return json({ error: "Datos no válidos" }, 400);
  try {
    const r = await sinRLS(async (c) => {
      const e = await base(c, s.empresa);
      const m = (await c.query(`select m.rol, m.activo, cu.email, cu.nombre, cu.clave_hash is not null tenia from miembros m join cuentas cu on cu.id = m.user_id
        where m.empresa_id = $1 and m.user_id = $2`, [s.empresa, p.data.cuenta_id])).rows[0];
      if (!m) throw negar("Ese usuario no es de tu droguería", 404);
      if (m.rol === "dueno") throw negar("El usuario del dueño no se cambia desde aquí: escríbenos por WhatsApp");
      if (p.data.activo === true && !m.activo) await cupo(c, s.empresa, e.plan);
      if (p.data.activo !== undefined) await c.query(`update miembros set activo = $3 where empresa_id = $1 and user_id = $2`, [s.empresa, p.data.cuenta_id, p.data.activo]);
      if (p.data.rol) await c.query(`update miembros set rol = $3 where empresa_id = $1 and user_id = $2`, [s.empresa, p.data.cuenta_id, p.data.rol]);
      let clave: string | null = null, enlace: string | null = null;
      if (p.data.enlace) {
        const cu = await cuentaAjena(c, s.empresa, "cu.id", p.data.cuenta_id);
        if (cu?.otra) throw negar("Ese usuario también pertenece a otra droguería: el enlace se lo enviamos desde soporte. Escríbenos por WhatsApp.", 409);
        enlace = await enlaceInvitacion(c, p.data.cuenta_id);
        clave = `${m.tenia ? "restablecer" : "invitacion"}:${p.data.cuenta_id}:${Date.now()}`;
        await encolar(c, { clave, para: m.email, plantilla: m.tenia ? "restablecer" : "invitacion", empresa: s.empresa, datos: { nombre: m.nombre, empresa: e.nombre, enlace } });
      }
      await c.query(`insert into auditoria (empresa_id, usuario_id, accion, entidad, entidad_id, datos) values ($1, $2, 'cambiar_usuario', 'miembros', $3, $4)`,
        [s.empresa, s.uid, p.data.cuenta_id, JSON.stringify({ activo: p.data.activo, rol: p.data.rol, enlace: !!p.data.enlace })]);
      // El enlace solo vuelve a la pantalla si es una invitación (la cuenta aún no tiene contraseña), para mandarlo por
      // WhatsApp. Un enlace para cambiar la contraseña de alguien que ya la tiene va SOLO a su correo.
      return { clave, enlace: m.tenia ? null : enlace, enviado: !!enlace };
    });
    if (r.clave) await enviarAhora(r.clave);
    return json({ ok: true, enlace: r.enlace, mensaje: r.enviado ? "Enlace enviado por correo" : "Guardado" });
  } catch (e) { return responder(e); }
});
