import Link from "next/link";
import { sinRLS } from "@/lib/db";
import { Cabecera, pesos } from "@/components/ui/Cabecera";
import { Accion } from "@/components/admin/Accion";
import { exigirAdmin, fechaHora, NOMBRE_PLAN } from "@/lib/admin-pagina";

export const metadata = { title: "Pagos" };
export const dynamic = "force-dynamic";
const ESTADO: Record<string, string> = { aprobado: "text-cruz", pendiente: "text-aviso", rechazado: "text-alerta", anulado: "text-muted", error: "text-alerta" };

const REVISAR: Record<string, string> = {
  nit_existente: "El NIT ya es cliente y paga otra persona: revisa antes de ligar",
  pago_anulado: "Pago anulado después de aprobado: la droguería quedó suspendida si no tenía otro pago",
  segundo_pago: "El cliente pagó dos veces: devuelve el segundo cobro",
  renovacion_monto_distinto: "Renovación de Stripe con otro monto: revisa y acredita a mano",
};

export default async function Pagos({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  await exigirAdmin();
  const { ver = "todos" } = await searchParams;
  const filas = await sinRLS(async (c) => (await c.query(`select p.*, coalesce(e.nombre_comercial, e.razon_social) cliente from pagos_suscripcion p left join empresas e on e.id = p.empresa_id
    where ($1 = 'todos' or ($1 = 'atender' and (p.estado = 'aprobado' or p.detalle ? 'revisar') and not p.atendido) or ($1 = 'qr' and p.proveedor = 'qr' and p.estado = 'pendiente')) order by p.creado desc limit 300`, [["atender", "qr"].includes(ver) ? ver : "todos"])).rows);
  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo="Pagos" sub="Pagos de planes desde la web (QR Bancolombia, Stripe y Wompi). Los pagos por QR se confirman aquí al ver el dinero en la cuenta. Un pago aprobado sin atender es un cliente esperando su cuenta." />
      <nav className="flex gap-1 tarjeta p-1 w-fit" aria-label="Vista">
        {([["todos", "Todos"], ["qr", "QR por confirmar"], ["atender", "Por atender"]] as const).map(([k, t]) => <Link key={k} href={`?ver=${k}`} aria-current={ver === k ? "page" : undefined} className={`px-3.5 py-2 rounded-xl text-sm font-semibold ${ver === k ? "bg-ink text-white" : "text-muted"}`}>{t}</Link>)}
      </nav>
      <div className="tarjeta overflow-x-auto">
        <table className="w-full text-[15px] min-w-[1000px]">
          <thead className="text-left text-sm text-muted border-b border-line"><tr><th className="px-4 py-3 font-semibold">Fecha</th><th className="px-4 py-3 font-semibold">Quién</th><th className="px-4 py-3 font-semibold">Plan</th><th className="px-4 py-3 font-semibold text-right">Monto</th><th className="px-4 py-3 font-semibold">Estado</th><th className="px-4 py-3 font-semibold">Acciones</th></tr></thead>
          <tbody className="divide-y divide-line">
            {filas.map((p) => (
              <tr key={p.referencia} className="align-top">
                <td className="px-4 py-3 text-sm">{fechaHora(p.creado)}<p className="text-xs text-muted font-mono">{p.referencia}</p></td>
                <td className="px-4 py-3"><p className="font-semibold">{p.empresa}</p><p className="text-sm text-muted">{p.nombre} · {p.telefono} · {p.email}{p.nit ? ` · NIT ${p.nit}` : ""}</p>{p.cliente && <Link href={`/admin/clientes/${p.empresa_id}`} className="text-sm text-cruz underline">Cliente: {p.cliente}</Link>}</td>
                <td className="px-4 py-3">{NOMBRE_PLAN[p.plan]} {p.periodo === "anio" ? "anual" : "mensual"}<p className="text-sm text-muted">{p.proveedor === "qr" ? "QR Bancolombia" : p.proveedor === "wompi" ? "Wompi" : "Stripe"}{p.metodo ? ` · ${p.metodo}` : ""}</p></td>
                <td className="px-4 py-3 num text-right font-semibold">{pesos(p.monto)}</td>
                <td className="px-4 py-3"><span className={`font-semibold ${ESTADO[p.estado] ?? ""}`}>{p.estado}</span>{p.detalle?.descartado ? <p className="text-sm text-muted">descartada sin pagar</p> : p.atendido && <p className="text-sm text-muted">atendido</p>}
                  {p.detalle?.revisar && <p className="text-sm text-alerta font-semibold">{REVISAR[p.detalle.revisar] ?? p.detalle.revisar}</p>}</td>
                <td className="px-4 py-3"><div className="flex flex-wrap gap-2">
                  {p.proveedor === "qr" && p.estado === "pendiente" && <>
                    <Accion url="/api/admin/pagos" metodo="PATCH" cuerpo={{ referencia: p.referencia, confirmar: "aprobado" }} texto="Confirmar: el dinero llegó" confirmar={`¿Llegaron ${pesos(p.monto)}? Sí`} clase="btn-primario h-9 text-sm" />
                    <Accion url="/api/admin/pagos" metodo="PATCH" cuerpo={{ referencia: p.referencia, confirmar: "rechazado" }} texto="No llegó" confirmar="¿Marcar como no recibido? Sí" clase="btn-borde h-9 text-sm text-muted" />
                  </>}
                  {p.proveedor !== "qr" && ["pendiente", "error"].includes(p.estado) && <Accion url="/api/admin/pagos" metodo="PATCH" cuerpo={{ referencia: p.referencia, descartar: true }} texto="Descartar orden sin pagar" confirmar="¿Descartar? Se cierra su enlace de pago. Sí" clase="btn-borde h-9 text-sm text-muted" />}
                  {p.estado === "aprobado" && !p.empresa_id && <Link href={`/admin/clientes/nuevo?pago=${encodeURIComponent(p.referencia)}`} className="btn-primario h-9 text-sm">Crear su cuenta</Link>}
                  {!p.atendido && <Accion url="/api/admin/pagos" metodo="PATCH" cuerpo={{ referencia: p.referencia, atendido: true }} texto="Marcar atendido" clase="btn-borde h-9 text-sm" />}
                  <a href={`https://wa.me/57${String(p.telefono).replace(/\D/g, "").slice(-10)}`} target="_blank" rel="noopener" className="btn-borde h-9 text-sm">WhatsApp</a>
                </div></td>
              </tr>
            ))}
            {filas.length === 0 && <tr><td colSpan={6} className="px-4 py-12 text-center text-muted">{ver === "atender" ? "Nada por atender." : "Aún no hay pagos desde la web."}</td></tr>}
          </tbody>
        </table>
      </div>
    </main>
  );
}
