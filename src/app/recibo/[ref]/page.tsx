import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { sinRLS } from "@/lib/db";
import { leerSesion } from "@/lib/sesion";
import { pesos } from "@/lib/formato";
import { Botones } from "./Botones";

// Comprobante de un pago del plan de Regenta, para el dueño de la droguería (no es la factura electrónica del servicio:
// si ya se emitió, aquí sale su número). El cobro con tarjeta lo procesa Stripe a nombre de la LLC; los demás medios, la S.A.S.
export const metadata: Metadata = { title: "Comprobante de pago", robots: { index: false, follow: false } };

const EMISOR = {
  stripe: { nombre: "IA DEV INVESTMENTS LLC", id: "Albuquerque, NM, EE. UU." },
  otro: { nombre: "IA DEV INVESTIMENTS COLOMBIA S.A.S.", id: "NIT 901.845.370-5 · Ibagué, Tolima" },
};
const MEDIO: Record<string, string> = { stripe: "Tarjeta (Stripe)", wompi: "Wompi", qr: "QR Bancolombia" };
const PLAN: Record<string, string> = { esencial: "Esencial", pro: "Pro" };

export default async function Recibo({ params }: { params: Promise<{ ref: string }> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (s.rol !== "dueno") redirect("/inicio?aviso=permiso");
  const { ref } = await params;
  if (!/^RG-[A-Z0-9-]{6,80}$/.test(ref)) notFound();
  const p = await sinRLS(async (c) => (await c.query(`select p.*, to_char(p.creado at time zone 'America/Bogota', 'DD/MM/YYYY HH24:MI') fecha, to_char(p.vence, 'DD/MM/YYYY') hasta,
      e.razon_social, e.nit enit, e.dv, e.direccion, e.ciudad from pagos_suscripcion p join empresas e on e.id = p.empresa_id
    where p.referencia = $1 and p.empresa_id = $2 and p.estado in ('aprobado', 'anulado')`, [ref, s.empresa])).rows[0]);
  if (!p) notFound();
  const em = p.proveedor === "stripe" ? EMISOR.stripe : EMISOR.otro;
  const fila = (k: string, v: React.ReactNode) => <tr><th className="text-left font-semibold pr-4 py-1.5 align-top">{k}</th><td className="py-1.5">{v}</td></tr>;
  return (
    <main className="max-w-2xl mx-auto p-6 sm:p-10 bg-white text-ink grid gap-6">
      <header className="flex flex-wrap justify-between gap-4">
        <div><p className="titulo text-2xl">Regenta</p><p className="text-sm">{em.nombre}<br />{em.id}</p></div>
        <div className="text-right"><h1 className="titulo text-xl">Comprobante de pago</h1><p className="text-sm font-mono">{p.referencia}</p></div>
      </header>
      {p.estado === "anulado" && <p className="font-semibold text-alerta">Este pago fue anulado o reembolsado.</p>}
      <table className="text-[15px]"><tbody>
        {fila("Cliente", <>{p.razon_social}<br />NIT {p.enit}{p.dv ? `-${p.dv}` : ""}{p.direccion ? ` · ${p.direccion}` : ""}{p.ciudad ? `, ${p.ciudad}` : ""}</>)}
        {fila("Fecha del pago", p.fecha)}
        {fila("Concepto", `Plan Regenta ${PLAN[p.plan] ?? p.plan}, ${p.periodo === "anio" ? "un año" : "un mes"} de servicio`)}
        {p.hasta && fila("Servicio pagado hasta", p.hasta)}
        {fila("Medio de pago", MEDIO[p.proveedor] ?? p.proveedor)}
        {fila("Valor pagado", <b className="num">{pesos(p.monto)}</b>)}
        {(p.factura || p.proveedor !== "stripe") && fila("Factura electrónica", p.factura ?? "Pendiente de emisión")}
      </tbody></table>
      <p className="text-xs text-muted">Este comprobante certifica el pago recibido; no reemplaza la factura electrónica del servicio.</p>
      <Botones />
    </main>
  );
}
