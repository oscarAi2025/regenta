import { z } from "zod";
import { NextResponse } from "next/server";
import { sinRLS } from "@/lib/db";
import { conAdmin, evento } from "@/lib/admin";
import { invitar } from "@/lib/admin-datos";
import { dvNit } from "@/lib/validar";
import { encolar, enviarAhora } from "@/lib/correo";

const fechaReal = (s: string) => { const d = new Date(s + "T00:00:00Z"); return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; };
const Num = z.object({ prefijo: z.string().trim().regex(/^[A-Z0-9]{0,10}$/i, "Prefijo: solo letras y números"), desde: z.number().int().positive().max(1e12), hasta: z.number().int().positive().max(1e12),
  vigente_hasta: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine(fechaReal, "Fecha de vigencia no válida").nullish(), pruebas: z.boolean() }).nullish();
const Nuevo = z.object({
  razon_social: z.string().trim().min(3, "Escribe la razón social").max(200),
  nombre_comercial: z.string().trim().max(200).nullish(),
  nit: z.string().trim().regex(/^\d{6,10}$/, "El NIT va sin dígito de verificación ni puntos"),
  ciudad: z.string().trim().max(80).nullish(), direccion: z.string().trim().max(160).nullish(),
  telefono: z.string().trim().max(30).nullish(), email: z.string().trim().email().max(160).nullish().or(z.literal("")),
  plan: z.enum(["esencial", "pro", "cadena", "socio"]),
  responsable_iva: z.boolean().default(false),
  dueno: z.object({ nombre: z.string().trim().min(3, "Escribe el nombre del dueño").max(120), email: z.string().trim().email("Correo del dueño no válido").max(160) }),
  pos: Num, factura: Num,
  solicitud: z.number().int().positive().max(Number.MAX_SAFE_INTEGER).nullish(), pago: z.string().max(80).nullish(),
});

/** Alta de un cliente en un solo paso: empresa, sede, caja, numeraciones, dueño con invitación. */
export const POST = conAdmin(async (a, req) => {
  const p = Nuevo.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message ?? "Revisa los datos" }, { status: 400 });
  const d = p.data;
  const r = await sinRLS(async (c) => {
    const e = (await c.query(`insert into empresas (nit, dv, razon_social, nombre_comercial, plan, responsable_iva, ciudad, direccion, telefono, email) values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) returning id`,
      [d.nit, dvNit(d.nit), d.razon_social.toUpperCase(), d.nombre_comercial || null, d.plan, d.responsable_iva, d.ciudad || null, d.direccion || null, d.telefono || null, d.email || null])).rows[0].id as string;
    const sede = (await c.query(`insert into sedes (empresa_id, nombre, direccion, ciudad) values ($1, 'Principal', $2, $3) returning id`, [e, d.direccion || null, d.ciudad || null])).rows[0].id;
    await c.query(`insert into cajas (empresa_id, sede_id, nombre) values ($1, $2, 'Caja 1')`, [e, sede]);
    for (const [tipo, n] of [["pos", d.pos], ["factura", d.factura]] as const) if (n) {
      if (n.hasta < n.desde) throw Object.assign(new Error(`Numeración ${tipo}: «hasta» debe ser mayor que «desde»`), { code: "P0001" });
      await c.query(`insert into resoluciones_dian (empresa_id, tipo, prefijo, desde, hasta, actual, vigente_hasta, pruebas) values ($1, $2, $3, $4, $5, $6, $7, $8)`, [e, tipo, n.prefijo, n.desde, n.hasta, n.desde - 1, n.vigente_hasta ?? null, n.pruebas]);
    }
    const inv = await invitar(c, e, { ...d.dueno, rol: "dueno" });
    const correo = inv.enlace ? `invitacion:${inv.cuenta_id}:${Date.now()}` : null;
    if (correo) await encolar(c, { clave: correo, para: d.dueno.email, plantilla: "invitacion", empresa: e, datos: { nombre: d.dueno.nombre, empresa: d.nombre_comercial || d.razon_social, enlace: inv.enlace } });
    const falla = (m: string) => Object.assign(new Error(m), { code: "P0001" });
    if (d.solicitud && !(await c.query(`update solicitudes_demo set estado = 'cliente' where id = $1`, [d.solicitud])).rowCount) throw falla("La solicitud de demo no existe");
    if (d.pago && !(await c.query(`update pagos_suscripcion set empresa_id = $2, atendido = true where referencia = $1 and estado = 'aprobado' and empresa_id is null`, [d.pago, e])).rowCount)
      throw falla("Ese pago no existe, no está aprobado o ya está ligado a otro cliente");
    await evento(a, "crear_cliente", e, { nit: d.nit, plan: d.plan, dueno: d.dueno.email }, c);
    return { empresa: e, enlace: inv.enlace, correo };
  });
  if (r.correo) await enviarAhora(r.correo);
  return NextResponse.json(r, { status: 201 });
});
