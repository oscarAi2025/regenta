import { NextResponse } from "next/server";
import { z } from "zod";
import { sinRLS } from "@/lib/db";
import { ipCliente, limitador, mismoOrigen } from "@/lib/api";
import { cifrarClave, hashToken, problemaClave } from "@/lib/claves";

const Activar = z.object({ token: z.string().min(20).max(100), clave: z.string().max(200), repetir: z.string().max(200) });
const permitido = limitador(10, 600000);

/** Poner la contraseña con el enlace de invitación (un solo uso, vence en 7 días). */
export async function POST(req: Request) {
  if (!mismoOrigen(req)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  if (!permitido(ipCliente(req))) return NextResponse.json({ error: "Demasiados intentos. Espera unos minutos." }, { status: 429 });
  const p = Activar.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Datos incompletos" }, { status: 400 });
  if (p.data.clave !== p.data.repetir) return NextResponse.json({ error: "Las dos contraseñas no coinciden" }, { status: 400 });
  const mal = problemaClave(p.data.clave);
  if (mal) return NextResponse.json({ error: mal }, { status: 400 });
  const hash = await cifrarClave(p.data.clave);
  const r = await sinRLS(async (c) => {
    const inv = (await c.query(`update invitaciones set usada = now() where token_hash = $1 and usada is null and expira > now() returning cuenta_id`, [hashToken(p.data.token)])).rows[0];
    if (!inv) return null;
    return (await c.query(`update cuentas set clave_hash = $2, activa = true where id = $1 returning email`, [inv.cuenta_id, hash])).rows[0];
  });
  if (!r) return NextResponse.json({ error: "El enlace no es válido o ya venció. Pide uno nuevo." }, { status: 400 });
  return NextResponse.json({ ok: true, email: r.email });
}
