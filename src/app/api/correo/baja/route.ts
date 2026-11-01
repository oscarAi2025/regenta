import { NextResponse } from "next/server";
import { sinRLS } from "@/lib/db";
import { leerTokenBaja } from "@/lib/correo";

export const dynamic = "force-dynamic";

/** Baja de los correos comerciales con un clic (RFC 8058: los clientes de correo hacen POST a esta URL). No toca los
 *  correos de servicio (activación, pagos, renovación). */
export async function POST(req: Request) {
  const url = new URL(req.url);
  let t = url.searchParams.get("t");
  if (!t) { const f = await req.formData().catch(() => null); t = (f?.get("t") as string | null) ?? null; }
  const email = t ? leerTokenBaja(t) : null;
  if (!email) return NextResponse.json({ error: "Enlace no válido" }, { status: 400 });
  await sinRLS(async (c) => {
    await c.query(`insert into correos_bajas (email) values ($1) on conflict do nothing`, [email]);
    await c.query(`update correos set estado = 'cancelado', error = 'Se dio de baja' where para = $1 and tipo = 'comercial' and estado = 'pendiente'`, [email]);
    await c.query(`update solicitudes_demo set acepta_correos = false where lower(email) = $1`, [email]);
  });
  return NextResponse.json({ ok: true });
}
