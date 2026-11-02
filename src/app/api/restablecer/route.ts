import { NextResponse } from "next/server";
import { z } from "zod";
import { sinRLS } from "@/lib/db";
import { ipCliente, limitador, limiteBD, mismoOrigen } from "@/lib/api";
import { enlaceInvitacion } from "@/lib/admin-datos";
import { encolar, enviarAhora } from "@/lib/correo";

const Pedido = z.object({ email: z.string().trim().toLowerCase().email().max(160) });
const permitido = limitador(5, 600000);
const RESPUESTA = "Si ese correo tiene cuenta en Regenta, te llegó un enlace para crear una contraseña nueva. Revisa también la carpeta de spam.";

/** «Olvidé mi contraseña»: envía un enlace de un solo uso (7 días). La contraseña actual sigue sirviendo hasta que se
 *  cree la nueva, así nadie bloquea una cuenta ajena pidiendo enlaces. La respuesta es la misma exista o no la cuenta. */
export async function POST(req: Request) {
  if (!mismoOrigen(req)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  if (!permitido(ipCliente(req))) return NextResponse.json({ error: "Demasiados intentos. Espera unos minutos." }, { status: 429 });
  const p = Pedido.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Escribe un correo válido" }, { status: 400 });
  const email = p.data.email;
  if (!(await limiteBD(`restablecer:ip:${ipCliente(req)}`, 20, "1 day")) || !(await limiteBD(`restablecer:correo:${email}`, 3, "1 hour")))
    return NextResponse.json({ ok: true, mensaje: RESPUESTA });
  const clave = await sinRLS(async (c) => {
    const cu = (await c.query(`select cu.id, cu.nombre, coalesce(e.nombre_comercial, e.razon_social) empresa, e.id empresa_id
      from cuentas cu join miembros m on m.user_id = cu.id and m.activo join empresas e on e.id = m.empresa_id and not e.demo
      where lower(cu.email) = $1 and cu.activa and not exists (select 1 from superadmins s where s.user_id = cu.id)
      order by m.creado limit 1`, [email])).rows[0];
    if (!cu) return null;
    const enlace = await enlaceInvitacion(c, cu.id);
    const k = `restablecer:${cu.id}:${Date.now()}`;
    await encolar(c, { clave: k, para: email, plantilla: "restablecer", empresa: cu.empresa_id, datos: { nombre: cu.nombre, empresa: cu.empresa, enlace } });
    return k;
  }).catch((e) => { console.error("restablecer", (e as Error).message); return null; });
  if (clave) await enviarAhora(clave);
  return NextResponse.json({ ok: true, mensaje: RESPUESTA });
}
