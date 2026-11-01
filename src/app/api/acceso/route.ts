import { NextResponse } from "next/server";
import { z } from "zod";
import { sinRLS } from "@/lib/db";
import { ipCliente, limitador, mismoOrigen } from "@/lib/api";
import { claveCorrecta } from "@/lib/claves";
import { crearSesion, type Rol } from "@/lib/sesion";
import { crearSesionAdmin } from "@/lib/admin";

const Acceso = z.object({ email: z.string().trim().toLowerCase().email().max(160), clave: z.string().min(1).max(200), consola: z.boolean().optional() });
const porIp = limitador(20, 600000), porCorreo = limitador(8, 600000);

/** Entrar con correo y contraseña. El superadministrador puede pedir la consola; los demás van a su droguería. */
export async function POST(req: Request) {
  if (!mismoOrigen(req)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  const p = Acceso.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Escribe tu correo y tu contraseña" }, { status: 400 });
  const { email, clave, consola } = p.data;
  if (!porIp(ipCliente(req)) || !porCorreo(email)) return NextResponse.json({ error: "Demasiados intentos. Espera 10 minutos." }, { status: 429 });
  const c = (await sinRLS((x) => x.query(`select c.id, c.nombre, c.clave_hash, c.activa, exists (select 1 from superadmins s where s.user_id = c.id) super from cuentas c where lower(c.email) = $1`, [email]))).rows[0];
  const ok = await claveCorrecta(clave, c?.activa ? c.clave_hash : null);
  if (!ok) return NextResponse.json({ error: "Correo o contraseña incorrectos" }, { status: 401 });
  await sinRLS((x) => x.query(`update cuentas set ultimo_ingreso = now() where id = $1`, [c.id]));
  const m = (await sinRLS((x) => x.query(`select m.empresa_id, m.rol, e.estado from miembros m join empresas e on e.id = m.empresa_id
    where m.user_id = $1 and m.activo order by (e.estado = 'activa') desc, m.creado limit 1`, [c.id]))).rows[0];
  if (c.super && (consola || !m)) { await crearSesionAdmin({ uid: c.id, nombre: c.nombre }); return NextResponse.json({ destino: "/admin" }); }
  if (!m) return NextResponse.json({ error: "Tu usuario no tiene una droguería asignada. Escríbenos por WhatsApp." }, { status: 403 });
  if (m.estado !== "activa") return NextResponse.json({ error: "La cuenta de tu droguería está suspendida. Escríbenos por WhatsApp para reactivarla." }, { status: 403 });
  await crearSesion({ uid: c.id, empresa: m.empresa_id, nombre: c.nombre, rol: m.rol as Rol });
  return NextResponse.json({ destino: m.rol === "cajero" ? "/caja" : "/inicio" });
}
