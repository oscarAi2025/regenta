import { NextResponse } from "next/server";
import { z } from "zod";
import { sinRLS } from "@/lib/db";
import { ipCliente, mismoOrigen } from "@/lib/api";
import { claveCorrecta } from "@/lib/claves";
import { crearSesion, type Rol } from "@/lib/sesion";
import { crearSesionAdmin } from "@/lib/admin";

const Acceso = z.object({ email: z.string().trim().toLowerCase().email().max(160), clave: z.string().min(1).max(200), consola: z.boolean().optional() });
// Límites de intentos FALLIDOS en 15 minutos, guardados en la base (valen para todas las instancias):
// por IP, por correo desde esa IP y por correo en total (ataque repartido). Un acierto limpia los de esa IP y correo.
const LIMITES = { ip: 30, correo_ip: 8, correo: 40 };

/** Entrar con correo y contraseña. El superadministrador puede pedir la consola; los demás van a su droguería. */
export async function POST(req: Request) {
  if (!mismoOrigen(req)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  const p = Acceso.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Escribe tu correo y tu contraseña" }, { status: 400 });
  const { email, clave, consola } = p.data;
  const ip = ipCliente(req);
  const claves = { ip: `ip:${ip}`, correo_ip: `ci:${email}|${ip}`, correo: `c:${email}` };
  const n = (await sinRLS((x) => x.query(`select count(*) filter (where clave = $1)::int ip, count(*) filter (where clave = $2)::int correo_ip, count(*) filter (where clave = $3)::int correo
    from intentos_acceso where clave = any(array[$1, $2, $3]) and creado > now() - interval '15 minutes'`, [claves.ip, claves.correo_ip, claves.correo]))).rows[0];
  if (n.ip >= LIMITES.ip || n.correo_ip >= LIMITES.correo_ip || n.correo >= LIMITES.correo) return NextResponse.json({ error: "Demasiados intentos fallidos. Espera 15 minutos o pide un enlace nuevo por WhatsApp." }, { status: 429 });
  const c = (await sinRLS((x) => x.query(`select c.id, c.nombre, c.clave_hash, c.activa, exists (select 1 from superadmins s where s.user_id = c.id) super from cuentas c where lower(c.email) = $1`, [email]))).rows[0];
  const ok = await claveCorrecta(clave, c?.activa ? c.clave_hash : null);
  if (!ok) {
    await sinRLS((x) => x.query(`insert into intentos_acceso (clave) select unnest(array[$1, $2, $3]::text[])`, [claves.ip, claves.correo_ip, claves.correo]));
    return NextResponse.json({ error: "Correo o contraseña incorrectos" }, { status: 401 });
  }
  await sinRLS(async (x) => {
    await x.query(`update cuentas set ultimo_ingreso = now() where id = $1`, [c.id]);
    await x.query(`delete from intentos_acceso where clave = any(array[$1, $2])`, [claves.correo_ip, claves.correo]);
  });
  const m = (await sinRLS((x) => x.query(`select m.empresa_id, m.rol, e.estado from miembros m join empresas e on e.id = m.empresa_id
    where m.user_id = $1 and m.activo order by (e.estado = 'activa') desc, m.creado limit 1`, [c.id]))).rows[0];
  if (c.super && (consola || !m)) { await crearSesionAdmin({ uid: c.id, nombre: c.nombre }); return NextResponse.json({ destino: "/admin" }); }
  if (!m) return NextResponse.json({ error: "Tu usuario no tiene una droguería asignada. Escríbenos por WhatsApp." }, { status: 403 });
  if (m.estado !== "activa") return NextResponse.json({ error: "La cuenta de tu droguería está suspendida. Escríbenos por WhatsApp para reactivarla." }, { status: 403 });
  await crearSesion({ uid: c.id, empresa: m.empresa_id, nombre: c.nombre, rol: m.rol as Rol });
  return NextResponse.json({ destino: m.rol === "cajero" ? "/caja" : "/inicio" });
}
