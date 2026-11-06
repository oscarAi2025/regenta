import { z } from "zod";
import { NextResponse } from "next/server";
import { conAdmin, evento } from "@/lib/admin";
import { procesarCola } from "@/lib/dian";
import { sincronizarInvima } from "@/lib/invima";
import { encolar, enviarAhora, enviarPendientes, programarRecordatorios } from "@/lib/correo";
import { sinRLS } from "@/lib/db";
import { probarIA } from "@/lib/ia/claude";

/** Acciones de sistema con un clic: procesar la cola DIAN o traer las alertas nuevas del INVIMA. */
export const POST = conAdmin(async (a, req) => {
  const p = z.object({ accion: z.enum(["dian", "invima", "correos", "matias", "probar_correo", "ia"]) }).safeParse(await req.json().catch(() => null));
  if (!p.success) return NextResponse.json({ error: "Acción no válida" }, { status: 400 });
  if (p.data.accion === "dian") {
    const r = await procesarCola(50);
    await evento(a, "procesar_dian", null, r);
    return NextResponse.json({ ok: true, mensaje: `Enviados ${r.enviados}: ${r.aceptados} aceptados, ${r.rechazados} rechazados, ${r.reintentos} para reintentar` });
  }
  if (p.data.accion === "matias") {
    // Comprueba el token de producción sin mostrarlo: datos de la cuenta y cuántos clientes tiene la casa de software.
    const base = (process.env.MATIAS_URL ?? "https://sandbox-api.matias-api.com").replace(/\/$/, "");
    const token = process.env.MATIAS_TOKEN;
    if (!token) return NextResponse.json({ error: "Falta MATIAS_TOKEN en el servidor" }, { status: 400 });
    const pedir = async (ruta: string) => {
      const r = await fetch(`${base}/api/ubl2.1${ruta}`, { headers: { Authorization: `Bearer ${token}`, Accept: "application/json" }, signal: AbortSignal.timeout(20000) });
      return { status: r.status, j: (await r.json().catch(() => ({}))) as Record<string, any> };
    };
    try {
      const emp = await pedir("/company");
      if (emp.status === 401 || emp.status === 403) return NextResponse.json({ error: `MATIAS rechazó el token (${emp.status}): créalo de nuevo y pégalo en MATIAS_TOKEN` }, { status: 502 });
      if (emp.status !== 200) return NextResponse.json({ error: `MATIAS respondió ${emp.status}: ${emp.j.message ?? "sin detalle"}` }, { status: 502 });
      const datos = emp.j.data ?? emp.j.dataRecords?.data ?? emp.j;
      const nombre = datos?.company_name ?? datos?.name ?? datos?.business_name ?? "cuenta sin nombre";
      const cli = await pedir("/company/customers");
      const lista = cli.j.data ?? cli.j.dataRecords?.data ?? [];
      await evento(a, "probar_matias", null, { estado: emp.status, clientes: Array.isArray(lista) ? lista.length : null });
      return NextResponse.json({ ok: true, mensaje: `Conexión con MATIAS correcta (${base.includes("sandbox") ? "pruebas" : "producción"}): ${nombre}${Array.isArray(lista) ? ` · ${lista.length} cliente${lista.length === 1 ? "" : "s"} en la casa de software` : ""}` });
    } catch (e) {
      return NextResponse.json({ error: `MATIAS no respondió: ${(e as Error).message}` }, { status: 502 });
    }
  }
  if (p.data.accion === "ia") {
    const r = await probarIA();
    await evento(a, "probar_ia", null, { ok: r.ok });
    return r.ok ? NextResponse.json({ ok: true, mensaje: r.mensaje }) : NextResponse.json({ error: r.mensaje }, { status: 502 });
  }
  if (p.data.accion === "probar_correo") {
    // Envía la bienvenida al correo del propio superadministrador y dice cómo salió (enviado, simulado o el error).
    const clave = `prueba:${a.uid}:${Date.now()}`;
    const para = await sinRLS(async (c) => {
      const email = (await c.query(`select email from cuentas where id = $1`, [a.uid])).rows[0]?.email as string | undefined;
      if (email) await encolar(c, { clave, para: email, plantilla: "bienvenida", datos: { nombre: a.nombre, empresa: "Regenta" } });
      return email;
    });
    if (!para) return NextResponse.json({ error: "Tu cuenta no tiene correo" }, { status: 400 });
    await enviarAhora(clave);
    const r = (await sinRLS((c) => c.query(`select estado, error from correos where clave = $1`, [clave]))).rows[0];
    await evento(a, "probar_correo", null, { estado: r?.estado });
    if (r?.estado === "enviado") return NextResponse.json({ ok: true, mensaje: `Correo de prueba enviado a ${para}` });
    if (r?.estado === "simulado") return NextResponse.json({ error: "Correo simulado: falta configurar el envío (RESEND_API_KEY y CORREO_REMITENTE, o SMTP)" }, { status: 400 });
    return NextResponse.json({ error: `No salió (${r?.estado ?? "sin estado"}): ${r?.error ?? "sin detalle"}` }, { status: 502 });
  }
  if (p.data.accion === "correos") {
    const rec = await programarRecordatorios();
    const r = await enviarPendientes(100);
    await evento(a, "enviar_correos", null, { ...r, ...rec });
    return NextResponse.json({ ok: true, mensaje: `Correos: ${r.enviados} enviados, ${r.simulados} simulados, ${r.errores} con error · ${rec.encolados} recordatorios nuevos` });
  }
  try {
    const r = await sincronizarInvima();
    await evento(a, "sincronizar_invima", null, r);
    return NextResponse.json({ ok: true, mensaje: `Alertas nuevas: ${r.nuevas}${r.errores ? ` · errores: ${r.errores}` : ""}` });
  } catch (e) {
    return NextResponse.json({ error: `El INVIMA no respondió: ${(e as Error).message}` }, { status: 502 });
  }
});
