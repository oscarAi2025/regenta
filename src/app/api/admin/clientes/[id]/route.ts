import { z } from "zod";
import { cancelarSuscripcionStripe, suscripcionStripe } from "@/lib/pagos";
import { NextResponse } from "next/server";
import { sinRLS } from "@/lib/db";
import { esUuid } from "@/lib/api";
import { dvNit, nitSinDv } from "@/lib/validar";
import { conAdmin, evento } from "@/lib/admin";
import { encolar, enviarAhora } from "@/lib/correo";
import { avisarHabilitacion } from "@/lib/operacion";
import { limite } from "@/lib/planes";
import { cuentaPrincipal, matiasConfigurado } from "@/lib/dian/matias-cuenta";

const Fiscal = z.object({ razon_social: z.string().trim().min(3, "Escribe la razón social").max(200), nombre_comercial: z.string().trim().max(160),
  nit: z.string().trim().regex(/^[\d.\s-]{6,15}$/, "El NIT son solo dígitos"), responsable_iva: z.boolean(), direccion: z.string().trim().max(200),
  ciudad: z.string().trim().max(100), telefono: z.string().trim().max(30), email: z.string().trim().email("Correo no válido").max(160).or(z.literal("")) });

const Cambio = z.object({ fiscal: Fiscal.optional(), estado: z.enum(["activa", "suspendida"]).optional(), plan: z.enum(["esencial", "pro", "cadena", "socio"]).optional(), nota: z.string().trim().max(2000).nullish(),
  // Facturación electrónica: UUID del cliente en la cuenta de casa de software de MATIAS ("" = la propia cuenta) y el número
  // de resolución DIAN de cada numeración (con «pruebas» falso la numeración pasa a producción).
  matias: z.object({ cliente: z.string().trim().uuid("El UUID de MATIAS no es válido").or(z.literal("")),
    resoluciones: z.array(z.object({ tipo: z.enum(["pos", "factura", "nota_credito", "soporte", "ajuste_soporte", "nota_debito"]), prefijo: z.string().max(10), numero: z.string().trim().regex(/^\d{6,20}$/, "El número de resolución son solo dígitos").or(z.literal("")), pruebas: z.boolean() })).max(10) }).optional(),
  // Envío real a MATIAS de documento soporte, nota de ajuste y nota débito (apagado por defecto).
  complementario: z.boolean().optional() });

/** Activar o suspender, cambiar el plan o la nota interna de un cliente. */
export const PATCH = conAdmin(async (a, req, ctx) => {
  const { id } = await ctx.params;
  if (!esUuid(id)) return NextResponse.json({ error: "No encontrado" }, { status: 404 });
  const p = Cambio.safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: p.error.issues[0]?.message ?? "Datos no válidos" }, { status: 400 });
  const d = p.data;
  if (d.fiscal) {
    // Datos fiscales: el DV se calcula del NIT; el NIT no cambia si ya factura en producción (sus documentos lo llevan).
    const f = d.fiscal, nit = nitSinDv(f.nit);
    if (nit.length < 6 || nit.length > 10) return NextResponse.json({ error: "Revisa el NIT" }, { status: 400 });
    const r = await sinRLS(async (c) => {
      const e = (await c.query(`select nit, demo, exists (select 1 from resoluciones_dian r where r.empresa_id = e.id and not r.pruebas) produccion from empresas e where id = $1 for update`, [id])).rows[0];
      if (!e || e.demo) return "no";
      if (e.produccion && e.nit !== nit) return "nit";
      await c.query(`update empresas set razon_social = $2, nombre_comercial = nullif($3, ''), nit = $4, dv = $5, responsable_iva = $6, direccion = nullif($7, ''), ciudad = nullif($8, ''),
        telefono = nullif($9, ''), email = nullif($10, '') where id = $1`, [id, f.razon_social, f.nombre_comercial, nit, dvNit(nit), f.responsable_iva, f.direccion, f.ciudad, f.telefono, f.email]);
      await evento(a, "datos_fiscales", id, { ...f, nit_antes: e.nit }, c);
      return "ok";
    }).catch((e) => { if ((e as { code?: string }).code === "23505") return "duplicado"; throw e; });
    if (r === "no") return NextResponse.json({ error: "Cliente no encontrado (la demo no se modifica desde aquí)" }, { status: 404 });
    if (r === "nit") return NextResponse.json({ error: "Ya factura en producción con ese NIT: no se cambia" }, { status: 409 });
    if (r === "duplicado") return NextResponse.json({ error: "Ese NIT ya es de otro cliente" }, { status: 409 });
    return NextResponse.json({ ok: true, mensaje: "Datos fiscales guardados" });
  }
  if (d.matias) {
    const m = d.matias;
    let habilitado: string[] = [];
    if (!m.cliente && m.resoluciones.some((x) => !x.pruebas))
      return NextResponse.json({ error: "Para pasar a producción la droguería necesita su UUID de cliente en MATIAS (si no, facturaría con el NIT de Regenta)" }, { status: 400 });
    // El UUID de la cuenta principal de MATIAS solo vale para el cliente con su mismo NIT (si no, facturaría con otro NIT).
    if (m.cliente && matiasConfigurado()) {
      const pr = await cuentaPrincipal().catch(() => null);
      if (!pr) return NextResponse.json({ error: "No se pudo comprobar la cuenta principal en MATIAS: intenta de nuevo" }, { status: 502 });
      const nit = (await sinRLS((c) => c.query(`select nit from empresas where id = $1`, [id]))).rows[0]?.nit;
      if (m.cliente === pr.uuid && String(nit) !== pr.nit) return NextResponse.json({ error: `Ese UUID es el de la cuenta principal de MATIAS (NIT ${pr.nit}), no el de este cliente` }, { status: 409 });
    }
    if (m.resoluciones.some((x) => !x.pruebas && !x.numero))
      return NextResponse.json({ error: "Una numeración en producción necesita su número de resolución DIAN" }, { status: 400 });
    const ok = await sinRLS<boolean | "nc" | "ajuste">(async (c) => {
      const r = await c.query(`update empresas set matias_cliente = nullif($2, '') where id = $1 and not demo`, [id, m.cliente]);
      if (!r.rowCount) return false;
      for (const x of m.resoluciones)
        await c.query(`update resoluciones_dian set numero_resolucion = nullif($4, ''), pruebas = $5 where empresa_id = $1 and tipo = $2 and prefijo = $3`, [id, x.tipo, x.prefijo, x.numero, x.pruebas]);
      // Ventas en producción sin notas crédito en producción = anulaciones y devoluciones que no podrían salir a la DIAN.
      const q = (await c.query(`select bool_or(tipo in ('pos', 'factura') and not pruebas) ventas_reales, bool_or(tipo = 'nota_credito' and not pruebas) nc_real
        from resoluciones_dian where empresa_id = $1 and activa`, [id])).rows[0];
      if (q.ventas_reales && !q.nc_real) throw Object.assign(new Error("nc"), { nc: true });
      const sp = (await c.query(`select bool_or(tipo = 'soporte' and not pruebas) soporte_real, bool_or(tipo = 'ajuste_soporte' and not pruebas) ajuste_real
        from resoluciones_dian where empresa_id = $1 and activa`, [id])).rows[0];
      if (sp.soporte_real && !sp.ajuste_real) throw Object.assign(new Error("ajuste"), { ajuste: true });
      habilitado = await avisarHabilitacion(c, id);
      return true;
    }).catch((e) => { if ((e as { nc?: boolean }).nc) return "nc" as const; if ((e as { ajuste?: boolean }).ajuste) return "ajuste" as const; throw e; });
    for (const k of habilitado) await enviarAhora(k);
    if (ok === "ajuste") return NextResponse.json({ error: "Para pasar el documento soporte a producción, la numeración de notas de ajuste del documento soporte también debe estar en producción (con su resolución)" }, { status: 400 });
    if (ok === "nc") return NextResponse.json({ error: "Para pasar las ventas a producción, la numeración de notas crédito también debe estar en producción (con su resolución): si no, las anulaciones y devoluciones no podrían enviarse a la DIAN" }, { status: 400 });
    if (!ok) return NextResponse.json({ error: "Cliente no encontrado (la demo no se modifica desde aquí)" }, { status: 404 });
    await evento(a, "facturacion_electronica", id, m);
    return NextResponse.json({ ok: true, mensaje: "Facturación electrónica guardada" });
  }
  if (d.complementario !== undefined) {
    // Solo se activa con numeración de documento soporte de producción y la droguería conectada en MATIAS.
    const r = await sinRLS(async (c) => {
      const e = (await c.query(`select demo, matias_cliente, exists (select 1 from resoluciones_dian r where r.empresa_id = e.id and r.tipo = 'soporte' and r.activa and not r.pruebas) soporte
        from empresas e where id = $1 for update`, [id])).rows[0];
      if (!e || e.demo) return "no";
      if (d.complementario && (!e.soporte || !e.matias_cliente)) return "falta";
      await c.query(`update empresas set dian_complementario = $2 where id = $1`, [id, d.complementario]);
      await evento(a, d.complementario ? "activar_envio_soporte" : "apagar_envio_soporte", id, { complementario: d.complementario }, c);
      return "ok";
    });
    if (r === "no") return NextResponse.json({ error: "Cliente no encontrado (la demo no se modifica desde aquí)" }, { status: 404 });
    if (r === "falta") return NextResponse.json({ error: "Para activar el envío real primero carga la numeración de documento soporte de producción y conecta la droguería en MATIAS" }, { status: 400 });
    return NextResponse.json({ ok: true, mensaje: d.complementario ? "Envío real de documento soporte, nota de ajuste y nota débito activado" : "Envío real de documento soporte, nota de ajuste y nota débito apagado" });
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
  if (d.plan) {
    // Cambio de plan desde la consola (inmediato): avisa si ya tiene más cajas o usuarios de los que permite el nuevo plan.
    const x = (await sinRLS((c) => c.query(`select (select count(*) from cajas where empresa_id = $1 and activa)::int cajas, (select count(*) from miembros where empresa_id = $1 and activo)::int usuarios`, [id]))).rows[0];
    const l = limite(d.plan);
    if ((l.cajas !== null && x.cajas > l.cajas) || (l.usuarios !== null && x.usuarios > l.usuarios))
      aviso = `. Ojo: tiene ${x.cajas} caja(s) y ${x.usuarios} usuario(s) activos y el plan permite ${l.cajas ?? "∞"} y ${l.usuarios ?? "∞"}; desactiva lo que sobra`;
  }
  if (d.estado === "suspendida") {
    const sub = await sinRLS((c) => suscripcionStripe(c, id));
    if (sub) aviso = (await cancelarSuscripcionStripe(sub.suscripcion, false)) ? " y su renovación con tarjeta cancelada" : ". OJO: no se pudo cancelar la suscripción en Stripe; cancélala en el panel de Stripe";
  }
  if (d.estado === "activa") {
    const cortada = (await sinRLS((c) => c.query(`select 1 from pagos_suscripcion where empresa_id = $1 and proveedor = 'stripe' and estado = 'aprobado' and coalesce((detalle ->> 'cancelada')::boolean, false)
      and not exists (select 1 from pagos_suscripcion q where q.empresa_id = $1 and q.proveedor = 'stripe' and q.estado = 'aprobado' and not coalesce((q.detalle ->> 'cancelada')::boolean, false))`, [id]))).rowCount;
    if (cortada) aviso = ". Su renovación con tarjeta quedó cancelada: al vencer deberá pagar de nuevo (le llegan los recordatorios)";
  }
  await evento(a, d.estado ? (d.estado === "activa" ? "activar_cliente" : "suspender_cliente") : d.plan ? "cambiar_plan" : "nota_cliente", id, d);
  return NextResponse.json({ ok: true, mensaje: (d.estado === "suspendida" ? "Cliente suspendido" : d.estado === "activa" ? "Cliente activado" : d.plan ? "Plan cambiado" : "Guardado") + aviso });
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
