import { z } from "zod";
import { NextResponse } from "next/server";
import { sinRLS } from "@/lib/db";
import { conAdmin, crearSesionAdmin, evento } from "@/lib/admin";
import { limiteBD } from "@/lib/api";
import { descifrar, verificarTotp } from "@/lib/totp";

/** Activa la verificación en dos pasos de la consola con el primer código de la app (confirma que quedó bien escaneada). */
export const POST = conAdmin(async (a, req) => {
  const p = z.object({ codigo: z.string().trim().max(12) }).safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Escribe el código de 6 cifras" }, { status: 400 });
  if (!(await limiteBD(`dos-pasos:${a.uid}`, 10, "15 minutes", false))) return NextResponse.json({ error: "Demasiados intentos. Espera 15 minutos." }, { status: 429 });
  const ok = await sinRLS(async (c) => {
    const cu = (await c.query(`select totp_secreto, totp_pendiente from cuentas where id = $1 for update`, [a.uid])).rows[0];
    if (cu?.totp_secreto) return "ya";
    if (!cu?.totp_pendiente) return null;
    const paso = verificarTotp(descifrar(cu.totp_pendiente), p.data.codigo, null);
    if (paso === null) return null;
    await c.query(`update cuentas set totp_secreto = totp_pendiente, totp_pendiente = null, totp_ultimo = $2 where id = $1`, [a.uid, paso]);
    await evento(a, "activar_dos_pasos", null, null, c);
    return "ok";
  });
  if (!ok) return NextResponse.json({ error: "Ese código no coincide. Revisa que sea el de «Regenta» en tu app y escríbelo antes de que cambie." }, { status: 400 });
  await crearSesionAdmin({ uid: a.uid, nombre: a.nombre }); // la sesión ya no queda limitada a esta página
  return NextResponse.json({ ok: true });
}, { inscribir: true });
