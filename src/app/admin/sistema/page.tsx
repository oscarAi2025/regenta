import { sinRLS } from "@/lib/db";
import { Cabecera, Dato } from "@/components/ui/Cabecera";
import { Accion } from "@/components/admin/Accion";
import { exigirAdmin, fechaHora } from "@/lib/admin-pagina";

export const metadata = { title: "Sistema" };
export const dynamic = "force-dynamic";

/** Variables de entorno que hacen falta en producción (solo se muestra si están puestas, nunca su valor). */
const VARIABLES: [string, string][] = [
  ["REGENTA_URL", "URL pública del sitio (SEO, enlaces de activación y pagos)"],
  ["REGENTA_SESSION_SECRET", "Firma de las sesiones"],
  ["DATABASE_URL", "Base de datos"],
  ["REGENTA_CRON_KEY", "Tareas programadas (cola DIAN, correos, INVIMA)"],
  ["ANTHROPIC_API_KEY", "Regenta IA"],
  ["WOMPI_PUBLIC_KEY", "Pagos en Colombia (Wompi)"], ["WOMPI_INTEGRITY_SECRET", "Firma de pagos Wompi"], ["WOMPI_EVENTS_SECRET", "Eventos de Wompi"],
  ["STRIPE_SECRET_KEY", "Pagos con tarjeta internacional (Stripe)"], ["STRIPE_WEBHOOK_SECRET", "Eventos de Stripe"],
  ["REGENTA_DIAN", "Proveedor de emisión DIAN: «matias» en producción (la demo siempre simulada)"], ["MATIAS_URL", "API de MATIAS (producción: https://api-v2.matias-api.com)"], ["MATIAS_TOKEN", "Token de acceso de la cuenta de casa de software en MATIAS"],
  ["SMTP_USER", "Buzón de Google Workspace que envía los correos (p. ej. hola@regenta.pro)"], ["SMTP_PASS", "Contraseña de aplicación de ese buzón"], ["RESEND_API_KEY", "Alternativa: envío con Resend"], ["CORREO_REMITENTE", "Remitente, p. ej. Regenta <hola@regenta.pro> (el buzón o un alias suyo)"], ["CORREO_RESPUESTA", "A dónde llegan las respuestas (opcional)"],
];

export default async function Sistema() {
  await exigirAdmin();
  const d = await sinRLS(async (c) => ({
    dian: (await c.query(`select d.estado, count(*)::int n from documentos_dian d join empresas e on e.id = d.empresa_id where not e.demo group by 1`)).rows as { estado: string; n: number }[],
    rechazados: (await c.query(`select d.prefijo || d.numero doc, d.ultimo_error, d.actualizado, coalesce(e.nombre_comercial, e.razon_social) cliente from documentos_dian d join empresas e on e.id = d.empresa_id where d.estado = 'rechazado' and not e.demo order by d.actualizado desc limit 20`)).rows,
    invima: (await c.query(`select numero, titulo, fecha::text, creado from alertas_invima order by creado desc limit 5`)).rows,
    tablas: (await c.query(`select (select count(*) from empresas)::int empresas, (select count(*) from cuentas)::int cuentas, (select count(*) from ventas)::int ventas, (select count(*) from productos)::int productos`)).rows[0],
  }));
  const n = (e: string) => d.dian.find((x) => x.estado === e)?.n ?? 0;
  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo="Sistema" sub="Cola de la DIAN, alertas del INVIMA y configuración del servidor." />
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Dato titulo="DIAN pendientes" valor={n("pendiente") + n("enviando")} />
        <Dato titulo="DIAN aceptados" valor={n("aceptado")} tono="cruz" />
        <Dato titulo="DIAN rechazados" valor={n("rechazado")} tono={n("rechazado") ? "alerta" : undefined} />
        <Dato titulo="Registros" valor={d.tablas.ventas.toLocaleString("es-CO")} nota={`ventas · ${d.tablas.empresas} empresas · ${d.tablas.cuentas} cuentas · ${d.tablas.productos.toLocaleString("es-CO")} productos`} />
      </section>
      <section className="tarjeta p-5 grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="titulo text-xl">Cola DIAN</h2><Accion url="/api/admin/sistema" cuerpo={{ accion: "dian" }} texto="Procesar cola ahora" clase="btn-oscuro h-10 text-sm" /></div>
        {d.rechazados.length ? <ul className="divide-y divide-line text-sm">{d.rechazados.map((r) => <li key={r.doc} className="py-2"><span className="font-semibold">{r.doc}</span> · {r.cliente} · {fechaHora(r.actualizado)}<p className="text-alerta">{r.ultimo_error}</p></li>)}</ul> : <p className="text-muted">Sin documentos rechazados.</p>}
      </section>
      <section className="tarjeta p-5 grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="titulo text-xl">Facturación electrónica (MATIAS)</h2><Accion url="/api/admin/sistema" cuerpo={{ accion: "matias" }} texto="Probar conexión" clase="btn-oscuro h-10 text-sm" /></div>
        <p className="text-sm text-muted">Emisor del servidor: <b>{process.env.REGENTA_DIAN ?? "simulado"}</b> · API: {process.env.MATIAS_URL ?? "sandbox"} · token {process.env.MATIAS_TOKEN ? "configurado" : "sin configurar"}. La droguería de demostración emite siempre en simulado.</p>
      </section>
      <section className="tarjeta p-5 grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="titulo text-xl">Correos</h2><Accion url="/api/admin/sistema" cuerpo={{ accion: "probar_correo" }} texto="Enviarme un correo de prueba" clase="btn-oscuro h-10 text-sm" /></div>
        <p className="text-sm text-muted">Envío: {process.env.RESEND_API_KEY ? "Resend" : process.env.SMTP_USER ? "Google Workspace (SMTP)" : "sin configurar (simulado)"} · remitente {process.env.CORREO_REMITENTE ?? "—"}.</p>
      </section>
      <section className="tarjeta p-5 grid gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3"><h2 className="titulo text-xl">Alertas del INVIMA</h2><Accion url="/api/admin/sistema" cuerpo={{ accion: "invima" }} texto="Sincronizar ahora" clase="btn-oscuro h-10 text-sm" /></div>
        <ul className="divide-y divide-line text-sm">{d.invima.map((a) => <li key={a.numero} className="py-2"><span className="font-semibold">{a.numero}</span> · {a.fecha} · {a.titulo}</li>)}</ul>
      </section>
      <section className="tarjeta p-5">
        <h2 className="titulo text-xl">Configuración del servidor</h2>
        <ul className="mt-3 grid sm:grid-cols-2 gap-2 text-sm">{VARIABLES.map(([k, t]) => {
          const ok = !!process.env[k];
          return <li key={k} className="flex items-start gap-2"><span className={`mt-0.5 size-5 shrink-0 rounded-full grid place-items-center text-[11px] font-bold text-white ${ok ? "bg-cruz" : "bg-alerta"}`} aria-hidden="true">{ok ? "✓" : "!"}</span><span><span className="font-mono text-xs">{k}</span> {ok ? "" : <b className="text-alerta">falta</b>}<span className="block text-muted">{t}</span></span></li>;
        })}</ul>
      </section>
    </main>
  );
}
