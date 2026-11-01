import { sinRLS } from "@/lib/db";
import { Cabecera } from "@/components/ui/Cabecera";
import { exigirAdmin } from "@/lib/admin-pagina";
import { NuevoCliente } from "./NuevoCliente";

export const metadata = { title: "Nuevo cliente" };
export const dynamic = "force-dynamic";

/** Alta de cliente; se puede precargar desde una solicitud de demo (?solicitud=) o un pago (?pago=). */
export default async function Nuevo({ searchParams }: { searchParams: Promise<{ solicitud?: string; pago?: string }> }) {
  await exigirAdmin();
  const sp = await searchParams;
  const pre = await sinRLS(async (c) => {
    if (sp.solicitud && /^\d{1,15}$/.test(sp.solicitud)) { const s = (await c.query(`select id, nombre, drogueria, ciudad, telefono, email from solicitudes_demo where id = $1`, [sp.solicitud])).rows[0]; if (s) return { solicitud: Number(s.id), razon_social: s.drogueria, ciudad: s.ciudad ?? "", telefono: s.telefono, email: s.email ?? "", dueno_nombre: s.nombre, dueno_email: s.email ?? "" }; }
    if (sp.pago) { const p = (await c.query(`select referencia, plan, nombre, empresa, nit, email, telefono from pagos_suscripcion where referencia = $1`, [sp.pago])).rows[0]; if (p) return { pago: p.referencia, razon_social: p.empresa, nit: (p.nit ?? "").replace(/\D/g, "").slice(0, 10), telefono: p.telefono, email: p.email, plan: p.plan, dueno_nombre: p.nombre, dueno_email: p.email }; }
    return {};
  });
  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo="Nuevo cliente" sub="Crea la droguería o distribuidora, su caja, sus numeraciones DIAN y el usuario del dueño en un solo paso." />
      <NuevoCliente pre={pre} />
    </main>
  );
}
