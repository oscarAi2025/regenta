import { z } from "zod";
import { cancelarSuscripcionStripe, suscripcionStripe } from "@/lib/pagos";
import { NextResponse } from "next/server";
import { sinRLS } from "@/lib/db";
import { esUuid } from "@/lib/api";
import { conAdmin, evento } from "@/lib/admin";
import { encolar, enviarAhora } from "@/lib/correo";

const Cambio = z.object({ estado: z.enum(["activa", "suspendida"]).optional(), plan: z.enum(["esencial", "pro", "cadena", "socio"]).optional(), nota: z.string().trim().max(2000).nullish(),
  // Facturación electrónica: UUID del cliente en la cuenta de casa de software de MATIAS ("" = la propia cuenta) y el número
  // de resolución DIAN de cada numeración (con «pruebas» falso la numeración pasa a producción).
  matias: z.object({ cliente: z.string().trim().uuid("El UUID de MATIAS no es válido").or(z.literal("")),
    resoluciones: z.array(z.object({ tipo: z.enum(["pos", "factura", "nota_credito"]), prefijo: z.string().max(10), numero: z.string().trim().regex(/^\d{6,20}$/, "El número de resolución son solo dígitos").or(z.literal("")), pruebas: z.boolean() })).max(10) }).optional() });

/** Activar o suspender, cambiar el plan o la nota interna de un cliente. */
export const PATCH = conAdmin(async (a, req, ctx) => {
  const { id } = await ctx.params;
  if (!esUuid(id)) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const p = Cambio.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message ?? "Datos no válidos" }, { status: 400 });
  const d = p.data;
  if (d.matias) {
    const m = d.matias;
    if (!m.cliente && m.resoluciones.some((x) => !x.pruebas))
      return NextResponse.json({ error: "Para pasar a producción la droguería necesita su UUID de cliente en MATIAS (si no, facturaría con el NIT de Regenta)" }, { status: 400 });
    if (m.resoluciones.some((x) => !x.pruebas && !x.numero))
      return NextResponse.json({ error: "Una numeración en producción necesita su número de resolución DIAN" }, { status: 400 });
    const ok = await sinRLS<boolean | "nc">(async (c) => {
      const r = await c.query(`update empresas set matias_cliente = nullif($2, '') where id = $1 and not demo`, [id, m.cliente]);
      if (!r.rowCount) return false;
      for (const x of m.resoluciones)
        await c.query(`update resoluciones_dian set numero_resolucion = nullif($4, ''), pruebas = $5 where empresa_id = $1 and tipo = $2 and prefijo = $3`, [id, x.tipo, x.prefijo, x.numero, x.pruebas]);
      // Ventas en producción sin notas crédito en producción = anulaciones y devoluciones que no podrían salir a la DIAN.
      const q = (await c.query(`select bool_or(tipo in ('pos', 'factura') and not pruebas) ventas_reales, bool_or(tipo = 'nota_credito' and not pruebas) nc_real
        from resoluciones_dian where empresa_id = $1 and activa`, [id])).rows[0];
      if (q.ventas_reales && !q.nc_real) throw Object.assign(new Error("nc"), { nc: true });
      return true;
    }).catch((e) => { if ((e as { nc?: boolean }).nc) return "nc" as const; throw e; });
    if (ok === "nc") return NextResponse.json({ error: "Para pasar las ventas a producción, la numeración de notas crédito también debe estar en producción (con su resolución): si no, las anulaciones y devoluciones no podrían enviarse a la DIAN" }, { status: 400 });
    if (!ok) return NextResponse.json({ error: "Cliente no encontrado (la demo no se modifica desde aquí)" }, { status: 404 });
    await evento(a, "facturacion_electronica", id, m);
    return NextResponse.json({ ok: true, mensaje: "Facturación electrónica guardada" });
  }
  const claves: string[] = [];
  const n = await sinRLS(async (c) => {
    const antes = (await c.query(`select estado, coalesce(nombre_comercial, razon_social) nombre from empresas where id = $1 for update`, [id])).rows[0];
    const r = await c.query(`update empresas set estado = coalesce($2, estado),
        suspension = case when $2 = 'suspendida' then 'manual' when $2 = 'activa' then null else suspension end, plan = coalesce($3, plan), nota_admin = case when $4::boolean then $5 else nota_admin end where id = $1 and not demo`,
      [id, d.estado ?? null, d.plan ?? null, d.nota !== undefined, d.nota ?? null]);
    if (r.rowCount && d.estado === "suspendida" && antes?.estado !== "suspendida") {
      const duenos = (await c.query(`select cu.email, cu.nombre from miembros m join cuentas cu on cu.id = m.user_id where m.empresa_id = $1 and m.activo and m.rol = 'dueno'`, [id])).rows;
      for (const u of duenos) { const k = `suspendida:${id}:${u.email}:${Date.now()}`; if (await encolar(c, { clave: k, para: u.email, plantilla: "cuenta_suspendida", empresa: id, datos: { nombre: u.nombre, empresa: antes.nombre } })) claves.push(k); }
    }
    return r;
  });
  for (const k of claves) await enviarAhora(k);
  if (!n.rowCount) return NextResponse.json({ error: "Cliente no encontrado (la demo no se modifica desde aquí)" }, { status: 404 });
  // Suspender desde la consola también corta la renovación automática con tarjeta (si no, Stripe seguiría cobrando).
  let aviso = "";
  if (d.estado === "suspendida") {
    const sub = await sinRLS((c) => suscripcionStripe(c, id));
    if (sub) aviso = (await cancelarSuscripcionStripe(sub.suscripcion, false)) ? " y su renovación con tarjeta cancelada" : ". OJO: no se pudo cancelar la suscripción en Stripe; cancélala en el panel de Stripe";
  }
  await evento(a, d.estado ? (d.estado === "activa" ? "activar_cliente" : "suspender_cliente") : d.plan ? "cambiar_plan" : "nota_cliente", id, d);
  return NextResponse.json({ ok: true, mensaje: d.estado === "suspendida" ? "Cliente suspendido" + aviso : d.estado === "activa" ? "Cliente activado" : "Guardado" });
});

/** Eliminar una droguería de PRUEBA (la base exige: no demo, suspendida y sin numeración DIAN en producción). Se confirma
 *  con su NIT. Antes se corta cualquier renovación con tarjeta que aún tenga en Stripe. */
export const DELETE = conAdmin(async (a, req, ctx) => {
  const { id } = await ctx.params;
  if (!esUuid(id)) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const b = z.object({ nit: z.string().max(30) }).safeParse(await req.json().catch(() => null));
  const e = await sinRLS(async (c) => (await c.query(`select nit, dv, coalesce(nombre_comercial, razon_social) nombre from empresas where id = $1`, [id])).rows[0]);
  if (!e) return NextResponse.json({ error: "Cliente no encontrado" }, { status: 404 });
  const digitos = b.success ? b.data.nit.replace(/\D/g, "") : "";
  if (digitos !== String(e.nit) && digitos !== `${e.nit}${e.dv ?? ""}`) return NextResponse.json({ error: "Escribe el NIT de la droguería para confirmar" }, { status: 400 });
  const sub = await sinRLS((c) => suscripcionStripe(c, id));
  if (sub && !(await cancelarSuscripcionStripe(sub.suscripcion, false)))
    return NextResponse.json({ error: "No se pudo cancelar su suscripción en Stripe: cancélala en el panel de Stripe y vuelve a intentar" }, { status: 502 });
  const cuentas = await sinRLS(async (c) => {
    const n = (await c.query(`select eliminar_empresa_prueba($1) n`, [id])).rows[0].n as number;
    await evento(a, "eliminar_cliente_prueba", null, { empresa_id: id, nombre: e.nombre, nit: e.nit, cuentas_borradas: n }, c);
    return n;
  }).catch((err) => { if ((err as { code?: string }).code === "P0001") return err as Error; throw err; });
  if (cuentas instanceof Error) return NextResponse.json({ error: cuentas.message }, { status: 409 });
  return NextResponse.json({ ok: true, mensaje: `Eliminada ${e.nombre} (${cuentas} cuenta${cuentas === 1 ? "" : "s"} borrada${cuentas === 1 ? "" : "s"})` });
});
