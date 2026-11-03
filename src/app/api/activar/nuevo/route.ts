import { NextResponse } from "next/server";
import { z } from "zod";
import { sinRLS } from "@/lib/db";
import { ipCliente, limitador, limiteBD, mismoOrigen } from "@/lib/api";
import { hashToken } from "@/lib/claves";
import { enlaceInvitacion } from "@/lib/admin-datos";
import { encolar, enviarAhora } from "@/lib/correo";

const Pedido = z.object({ token: z.string().regex(/^[\w-]{20,100}$/) });
const permitido = limitador(5, 600000);
const RESPUESTA = "Listo: si el enlace era tuyo, te llegó uno nuevo al correo de tu cuenta. Revisa también la carpeta de spam.";

/** Enlace de contraseña vencido o ya usado: se manda uno nuevo AL CORREO DE LA CUENTA (nunca se muestra aquí), igual que
 *  «olvidé mi contraseña». La respuesta es la misma siempre. No sirve para cuentas de superadministrador. */
export async function POST(req: Request) {
  if (!mismoOrigen(req)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  if (!permitido(ipCliente(req))) return NextResponse.json({ error: "Demasiados intentos. Espera unos minutos." }, { status: 429 });
  const p = Pedido.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Enlace incompleto" }, { status: 400 });
  const clave = await sinRLS(async (c) => {
    const cu = (await c.query(`select cu.id, cu.email, cu.nombre, cu.clave_hash is not null tiene, coalesce(e.nombre_comercial, e.razon_social) empresa, e.id empresa_id
      from invitaciones i join cuentas cu on cu.id = i.cuenta_id and cu.activa
      join miembros m on m.user_id = cu.id and m.activo join empresas e on e.id = m.empresa_id and not e.demo
      where i.token_hash = $1 and not exists (select 1 from superadmins s where s.user_id = cu.id) order by m.creado limit 1`, [hashToken(p.data.token)])).rows[0];
    if (!cu || !(await limiteBD(`enlace-nuevo:${cu.id}`, 3, "1 hour"))) return null;
    const enlace = await enlaceInvitacion(c, cu.id);
    const k = `enlace-nuevo:${cu.id}:${Date.now()}`;
    await encolar(c, { clave: k, para: cu.email, plantilla: cu.tiene ? "restablecer" : "invitacion", empresa: cu.empresa_id, datos: { nombre: cu.nombre, empresa: cu.empresa, enlace } });
    return k;
  }).catch((e) => { console.error("enlace nuevo", (e as Error).message); return null; });
  await Promise.all([clave ? enviarAhora(clave) : null, new Promise((r) => setTimeout(r, 1200))]);
  return NextResponse.json({ ok: true, mensaje: RESPUESTA });
}
