import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { pool } from "@/lib/db";
import { leerSesion } from "@/lib/sesion";
import { Isotipo } from "@/components/Marca";
import { Navegacion } from "@/components/Navegacion";
import { Asistente } from "@/components/app/Asistente";
import { Buscador } from "@/components/app/Buscador";
import { BotonBuscar } from "@/components/app/BotonBuscar";
import { iaActiva } from "@/lib/ia/claude";
import { AvisoPermiso } from "@/components/app/AvisoPermiso";
import { AvisoPlan } from "@/components/app/AvisoPlan";
import Link from "next/link";
import { ModoDemo } from "@/components/app/ModoDemo";
import { GARANTIA, PRECIO_DESDE } from "@/lib/oferta";
import { MarcaRender } from "@/components/MarcaRender";

// La aplicación nunca se indexa: solo la portada comercial es pública.
export const metadata: Metadata = { robots: { index: false, follow: false } };

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  // Una sola ida a la base (sin transacción): solo los datos de la cabecera de la empresa de la sesión firmada.
  const emp = (await pool.query(`select e.nombre_comercial, e.razon_social, e.nit, e.dv, e.demo, e.plan,
      (select max(vence) - current_date from pagos_suscripcion where empresa_id = e.id and estado = 'aprobado') dias,
      (select to_char(max(vence), 'DD/MM/YYYY') from pagos_suscripcion where empresa_id = e.id and estado = 'aprobado') vence,
      exists (select 1 from pagos_suscripcion where empresa_id = e.id and estado = 'aprobado' and proveedor = 'stripe' and suscripcion is not null
        and not coalesce((detalle ->> 'cancelada')::boolean or (detalle ->> 'cancelar_al_final')::boolean, false)) autorenueva,
      (select coalesce(sum(monto), 0) from cargos_documentos where empresa_id = e.id and estado = 'pendiente')::float cargos
    from empresas e where e.id = $1`, [s.empresa])).rows[0];
  if (!emp) redirect("/entrar");
  const rol = { dueno: "Dueño", admin: "Administrador", cajero: "Cajera", bodeguero: "Bodega", vendedor: "Vendedor" }[s.rol];
  return (
    <div className="min-h-screen lg:grid lg:grid-cols-[236px_1fr]">
      <aside className="bg-ink text-white lg:h-screen flex lg:flex-col items-center lg:items-stretch gap-2 px-3 py-3 lg:py-5 sticky top-0 z-20 [@media(max-height:500px)]:static">
        <Link href="/inicio" className="flex items-center gap-2.5 lg:px-2 shrink-0" aria-label="Regenta, ir al inicio">
          <Isotipo size={38} claro />
          <span className="hidden lg:block leading-none">
            <span className="block font-cond text-[24px] tracking-[-0.03em]" style={{ fontWeight: 700 }}>Regenta</span>
            <span className="block text-[10.5px] text-white/50 mt-1">by Farmagenéricos Colombia</span>
          </span>
        </Link>
        <Navegacion rol={s.rol} demo={!!emp.demo} />
      </aside>
      <div className="min-w-0">
        {emp.demo && <ModoDemo rol={s.rol} precio={PRECIO_DESDE} garantia={GARANTIA} />}
        <header className="flex items-center justify-between gap-4 px-4 sm:px-6 h-14 border-b border-line bg-surface">
          <p className="truncate"><span className="font-semibold">{emp.nombre_comercial ?? emp.razon_social}</span><span className="text-muted text-sm"> · NIT {emp.nit}-{emp.dv}</span><span className="hidden 2xl:inline text-muted text-sm"> · Regenta, facturación y gestión farmacéutica</span></p>
          <BotonBuscar />
          <Link href="/cuenta" className="text-sm text-muted shrink-0 hidden sm:block hover:text-ink" title="Mi cuenta: contraseña y sesiones">{s.nombre.split(" (")[0]} · {rol}</Link>
        </header>
        {s.soporte && (
          <p className="bg-amber-300 text-[#0b1f33] px-4 sm:px-6 py-2 text-sm font-semibold flex flex-wrap items-center justify-between gap-2">
            Estás dentro de {emp.nombre_comercial ?? emp.razon_social} como soporte de Regenta: todo lo que hagas queda a nombre del usuario.
            <Link href="/admin/clientes" className="underline">Volver a la consola</Link>
          </p>
        )}
        {!emp.demo && <AvisoPlan rol={s.rol} dias={emp.dias === null ? null : Number(emp.dias)} vence={emp.vence} autorenueva={emp.autorenueva} plan={emp.plan} cargos={emp.cargos} />}
        <AvisoPermiso />
        <div className="pb-24">{children}<MarcaRender /></div>
      </div>
      <Buscador rol={s.rol} />
      <Asistente activa={iaActiva()} />
    </div>
  );
}
