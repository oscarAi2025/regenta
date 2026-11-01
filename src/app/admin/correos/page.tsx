import Link from "next/link";
import { sinRLS } from "@/lib/db";
import { Cabecera } from "@/components/ui/Cabecera";
import { Accion } from "@/components/admin/Accion";
import { exigirAdmin, fechaHora } from "@/lib/admin-pagina";

export const metadata = { title: "Correos" };
export const dynamic = "force-dynamic";

const VISTAS = [["todos", "Todos"], ["pendiente", "Programados"], ["enviado", "Enviados"], ["simulado", "Simulados"], ["error", "Con error"], ["cancelado", "Cancelados"]] as const;
const NOMBRE: Record<string, string> = {
  invitacion: "Invitación", restablecer: "Restablecer contraseña", bienvenida: "Bienvenida", solicitud_recibida: "Solicitud recibida",
  pago_aprobado: "Pago aprobado", pago_rechazado: "Pago rechazado", pago_abandonado: "Pago sin terminar", renovacion_proxima: "Renovación próxima",
  renovacion_vencida: "Plan vencido", cuenta_suspendida: "Cuenta suspendida", embudo_1: "Embudo 1 · día 1", embudo_2: "Embudo 2 · día 3",
  embudo_3: "Embudo 3 · día 6", embudo_4: "Embudo 4 · día 10", embudo_5: "Embudo 5 · día 15",
};
const COLOR: Record<string, string> = { enviado: "text-cruz", simulado: "text-aviso", pendiente: "text-muted", enviando: "text-muted", error: "text-alerta", cancelado: "text-muted" };

export default async function Correos({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  await exigirAdmin();
  const { ver = "todos" } = await searchParams;
  const v = VISTAS.some(([k]) => k === ver) ? ver : "todos";
  const d = await sinRLS(async (c) => ({
    filas: (await c.query(`select id, para, plantilla, tipo, estado, intentos, error, programado, enviado, creado from correos where ($1 = 'todos' or estado = $1) order by coalesce(enviado, programado) desc limit 300`, [v])).rows,
    cuentas: (await c.query(`select estado, count(*)::int n from correos group by 1`)).rows as { estado: string; n: number }[],
    bajas: (await c.query(`select count(*)::int n from correos_bajas`)).rows[0].n as number,
  }));
  const n = (e: string) => d.cuentas.find((x) => x.estado === e)?.n ?? 0;
  const proveedor = !!process.env.RESEND_API_KEY && !!process.env.CORREO_REMITENTE;
  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo="Correos" sub="Activación, bienvenida, pagos, recordatorios de renovación y el embudo de venta. Cada correo sale una sola vez." />
      {!proveedor && <p role="status" className="tarjeta p-4 border-l-4 border-aviso">Falta configurar <span className="font-mono text-sm">RESEND_API_KEY</span> y <span className="font-mono text-sm">CORREO_REMITENTE</span>: los correos quedan como «simulados» y no le llegan a nadie.</p>}
      <section className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[["Programados", n("pendiente") + n("enviando")], ["Enviados", n("enviado")], ["Simulados", n("simulado")], ["Con error", n("error")], ["Se dieron de baja", d.bajas]].map(([t, x]) => (
          <div key={t as string} className="tarjeta p-4"><p className="text-sm text-muted">{t}</p><p className="font-cond text-3xl" style={{ fontWeight: 700 }}>{x}</p></div>
        ))}
      </section>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <nav className="flex flex-wrap gap-1 tarjeta p-1 w-fit" aria-label="Estado">
          {VISTAS.map(([k, t]) => <Link key={k} href={`?ver=${k}`} aria-current={v === k ? "page" : undefined} className={`px-3.5 py-2 rounded-xl text-sm font-semibold ${v === k ? "bg-ink text-white" : "text-muted"}`}>{t}</Link>)}
        </nav>
        <Accion url="/api/admin/sistema" cuerpo={{ accion: "correos" }} texto="Enviar los que tocan ahora" clase="btn-oscuro h-10 text-sm" />
      </div>
      <div className="tarjeta overflow-x-auto">
        <table className="w-full text-[15px] min-w-[860px]">
          <thead className="text-left text-sm text-muted border-b border-line"><tr><th className="px-4 py-3 font-semibold">Cuándo</th><th className="px-4 py-3 font-semibold">Para</th><th className="px-4 py-3 font-semibold">Correo</th><th className="px-4 py-3 font-semibold">Estado</th><th className="px-4 py-3 font-semibold">Acciones</th></tr></thead>
          <tbody className="divide-y divide-line">
            {d.filas.map((m) => (
              <tr key={m.id} className="align-top">
                <td className="px-4 py-3 text-sm">{fechaHora(m.enviado ?? m.programado)}</td>
                <td className="px-4 py-3 break-all">{m.para}</td>
                <td className="px-4 py-3">{NOMBRE[m.plantilla] ?? m.plantilla}<p className="text-xs text-muted">{m.tipo === "comercial" ? "Comercial" : "De servicio"}</p></td>
                <td className={`px-4 py-3 font-semibold ${COLOR[m.estado] ?? ""}`}>{m.estado === "pendiente" ? "Programado" : m.estado[0].toUpperCase() + m.estado.slice(1)}{m.intentos > 1 ? <span className="block text-xs text-muted font-normal">{m.intentos} intentos</span> : null}{m.error && <span className="block text-xs text-alerta font-normal max-w-[28em]">{m.error}</span>}</td>
                <td className="px-4 py-3">
                  {(m.estado === "error" || m.estado === "cancelado") && <Accion url="/api/admin/correos" metodo="PATCH" cuerpo={{ id: Number(m.id), accion: "reintentar" }} texto="Reintentar" />}
                  {m.estado === "pendiente" && <Accion url="/api/admin/correos" metodo="PATCH" cuerpo={{ id: Number(m.id), accion: "cancelar" }} texto="Cancelar" confirmar="¿Cancelar? Sí" />}
                </td>
              </tr>
            ))}
            {d.filas.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-muted">No hay correos en esta vista.</td></tr>}
          </tbody>
        </table>
      </div>
    </main>
  );
}
