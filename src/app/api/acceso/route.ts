import { NextResponse } from "next/server";
import { z } from "zod";
import { sinRLS } from "@/lib/db";
import { ipCliente, mismoOrigen } from "@/lib/api";
import { claveCorrecta } from "@/lib/claves";
import { crearSesion, type Rol } from "@/lib/sesion";
import { crearSesionAdmin } from "@/lib/admin";
import { descifrar, dosPasosActivos, verificarTotp } from "@/lib/totp";

const Acceso = z.object({ email: z.string().trim().toLowerCase().email().max(160), clave: z.string().min(1).max(200), consola: z.boolean().optional(),
  empresa: z.string().uuid().optional(), codigo: z.string().trim().max(12).optional() });
// Límites de intentos FALLIDOS en 15 minutos, guardados en la base (valen para todas las instancias):
// por IP, por correo desde esa IP y por correo en total (ataque repartido). Un acierto limpia los de esa IP y correo.
const LIMITES = { ip: 30, correo_ip: 8, correo: 40 };

/** Entrar con correo y contraseña. El superadministrador puede pedir la consola; los demás van a su droguería. */
export async function POST(req: Request) {
  if (!mismoOrigen(req)) return NextResponse.json({ error: "Origen no permitido" }, { status: 403 });
  const p = Acceso.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Escribe tu correo y tu contraseña" }, { status: 400 });
  const { email, clave, consola, empresa } = p.data;
  const ip = ipCliente(req);
  const claves = { ip: `ip:${ip}`, correo_ip: `ci:${email}|${ip}`, correo: `c:${email}` };
  const n = (await sinRLS((x) => x.query(`select count(*) filter (where clave = $1)::int ip, count(*) filter (where clave = $2)::int correo_ip, count(*) filter (where clave = $3)::int correo
    from intentos_acceso where clave = any(array[$1, $2, $3]) and creado > now() - interval '15 minutes'`, [claves.ip, claves.correo_ip, claves.correo]))).rows[0];
  // Un ataque repartido contra un correo no deja fuera a su dueño: pasado el límite total, se frena (3 s) y solo se
  // bloquean las IP que ya fallaron con ese correo; desde su equipo de siempre la persona sigue entrando.
  if (n.correo >= LIMITES.correo) await new Promise((r) => setTimeout(r, 3000));
  if (n.ip >= LIMITES.ip || n.correo_ip >= LIMITES.correo_ip || (n.correo >= LIMITES.correo && n.correo_ip >= 2)) return NextResponse.json({ error: "Demasiados intentos fallidos. Espera 15 minutos o pide un enlace nuevo por WhatsApp." }, { status: 429 });
  const c = (await sinRLS((x) => x.query(`select c.id, c.nombre, c.clave_hash, c.activa, c.totp_secreto, c.totp_ultimo, exists (select 1 from superadmins s where s.user_id = c.id) super from cuentas c where lower(c.email) = $1`, [email]))).rows[0];
  const ok = await claveCorrecta(clave, c?.activa ? c.clave_hash : null);
  if (!ok) {
    await sinRLS((x) => x.query(`insert into intentos_acceso (clave) select unnest(array[$1, $2, $3]::text[])`, [claves.ip, claves.correo_ip, claves.correo]));
    return NextResponse.json({ error: "Correo o contraseña incorrectos" }, { status: 401 });
  }
  const fallo = async () => { await sinRLS((x) => x.query(`insert into intentos_acceso (clave) select unnest(array[$1, $2, $3]::text[])`, [claves.ip, claves.correo_ip, claves.correo])); };
  // Consola: además de la contraseña, el código de 6 cifras de la app de autenticación (verificación en dos pasos).
  const aConsola = c.super && (consola || !(await sinRLS(async (x) => (await x.query(`select 1 from miembros where user_id = $1 and activo`, [c.id])).rowCount)));
  if (dosPasosActivos() && aConsola && c.totp_secreto) {
    if (!p.data.codigo) return NextResponse.json({ codigo: true });
    const paso = verificarTotp(descifrar(c.totp_secreto), p.data.codigo, c.totp_ultimo === null ? null : Number(c.totp_ultimo));
    if (paso === null) { await fallo(); return NextResponse.json({ codigo: true, error: "Código incorrecto o vencido: escribe el que muestra ahora tu app" }, { status: 401 }); }
    await sinRLS((x) => x.query(`update cuentas set totp_ultimo = $2 where id = $1`, [c.id, paso]));
  }
  await sinRLS(async (x) => {
    await x.query(`update cuentas set ultimo_ingreso = now() where id = $1`, [c.id]);
    await x.query(`delete from intentos_acceso where clave = any(array[$1, $2])`, [claves.correo_ip, claves.correo]);
  });
  // Quien pertenece a varias droguerías elige a cuál entra (el formulario vuelve a enviar la contraseña con la elegida).
  const todas = (await sinRLS((x) => x.query(`select m.empresa_id, m.rol, e.estado, e.suspension, e.plan, coalesce(e.nombre_comercial, e.razon_social) nombre from miembros m join empresas e on e.id = m.empresa_id
    where m.user_id = $1 and m.activo order by (e.estado = 'activa') desc, m.creado`, [c.id]))).rows as { empresa_id: string; rol: string; estado: string; suspension: string | null; plan: string; nombre: string }[];
  const activas = todas.filter((x) => x.estado === "activa");
  if (!empresa && activas.length > 1 && !(c.super && consola))
    return NextResponse.json({ elegir: activas.map((x) => ({ id: x.empresa_id, nombre: x.nombre, rol: x.rol })) });
  const m = empresa ? todas.find((x) => x.empresa_id === empresa) : todas[0];
  if (empresa && !m) return NextResponse.json({ error: "No perteneces a esa droguería" }, { status: 403 });
  if (c.super && (consola || !m)) {
    // Sin verificación en dos pasos todavía: la consola solo deja activarla (/admin/dos-pasos) antes de cualquier otra cosa.
    const inscribir = dosPasosActivos() && !c.totp_secreto;
    await crearSesionAdmin({ uid: c.id, nombre: c.nombre }, inscribir);
    return NextResponse.json({ destino: inscribir ? "/admin/dos-pasos" : "/admin" });
  }
  if (!m) return NextResponse.json({ error: "Tu usuario no tiene una droguería asignada. Escríbenos por WhatsApp." }, { status: 403 });
  if (m.estado !== "activa") {
    // Suspendida por falta de pago: el dueño renueva en línea y la cuenta se reactiva sola al aprobarse el pago.
    if (m.suspension === "impago" && m.rol === "dueno") return NextResponse.json({ error: "El plan de tu droguería venció y la cuenta está suspendida. Renueva con este mismo correo y el NIT de la droguería: se reactiva sola al aprobarse el pago.",
      renovar: `/contratar?plan=${m.plan === "pro" ? "pro" : "esencial"}` }, { status: 403 });
    return NextResponse.json({ error: m.suspension === "impago" ? "El plan de la droguería venció y la cuenta está suspendida: avísale al dueño para que lo renueve." : "La cuenta de tu droguería está suspendida. Escríbenos por WhatsApp para reactivarla." }, { status: 403 });
  }
  await crearSesion({ uid: c.id, empresa: m.empresa_id, nombre: c.nombre, rol: m.rol as Rol });
  return NextResponse.json({ destino: m.rol === "cajero" ? "/caja" : "/inicio" });
}
