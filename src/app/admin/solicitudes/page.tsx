import Link from "next/link";
import { sinRLS } from "@/lib/db";
import { Cabecera } from "@/components/ui/Cabecera";
import { Accion } from "@/components/admin/Accion";
import { exigirAdmin, fechaHora } from "@/lib/admin-pagina";

export const metadata = { title: "Solicitudes de demo" };
export const dynamic = "force-dynamic";
const ESTADOS = [["nueva", "Nuevas"], ["contactada", "Contactadas"], ["cliente", "Ya son clientes"], ["descartada", "Descartadas"]] as const;

export default async function Solicitudes({ searchParams }: { searchParams: Promise<{ estado?: string }> }) {
  await exigirAdmin();
  const { estado = "nueva" } = await searchParams;
  const est = ESTADOS.some(([k]) => k === estado) ? estado : "nueva";
  const filas = await sinRLS(async (c) => (await c.query(`select * from solicitudes_demo where estado = $1 order by creado desc limit 300`, [est])).rows);
  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo="Solicitudes de demo" sub="Las personas que pidieron que les mostraran Regenta desde la web." />
      <nav className="flex flex-wrap gap-1 tarjeta p-1 w-fit" aria-label="Estado">
        {ESTADOS.map(([k, t]) => <Link key={k} href={`?estado=${k}`} aria-current={est === k ? "page" : undefined} className={`px-3.5 py-2 rounded-xl text-sm font-semibold ${est === k ? "bg-ink text-white" : "text-muted"}`}>{t}</Link>)}
      </nav>
      <ul className="grid gap-3">
        {filas.map((s) => (
          <li key={s.id} className="tarjeta p-5 grid gap-3 md:grid-cols-[minmax(0,1fr)_auto] md:items-center">
            <div className="min-w-0">
              <p className="font-semibold text-lg">{s.drogueria}</p>
              <p className="text-muted">{s.nombre}{s.ciudad ? ` · ${s.ciudad}` : ""} · {s.telefono}{s.email ? ` · ${s.email}` : ""}{s.cajas ? ` · ${s.cajas === "distribuidor" ? "distribuidor" : `${s.cajas} caja(s)`}` : ""}</p>
              {s.mensaje && <p className="mt-1 text-sm">«{s.mensaje}»</p>}
              <p className="text-xs text-muted mt-1">{fechaHora(s.creado)}{s.origen ? ` · desde ${s.origen}` : ""}</p>
            </div>
            <div className="flex flex-wrap gap-2">
              <a href={`https://wa.me/57${String(s.telefono).replace(/\D/g, "").slice(-10)}?text=${encodeURIComponent(`Hola ${String(s.nombre).split(" ")[0]}, te escribo de Regenta por la demo que pediste para ${s.drogueria}.`)}`} target="_blank" rel="noopener" className="btn-primario h-10 text-sm">WhatsApp</a>
              {est !== "contactada" && <Accion url="/api/admin/solicitudes" metodo="PATCH" cuerpo={{ id: Number(s.id), estado: "contactada" }} texto="Contactada" />}
              {est !== "cliente" && <Link href={`/admin/clientes/nuevo?solicitud=${s.id}`} className="btn-oscuro h-10 text-sm">Crear cliente</Link>}
              {est !== "descartada" && <Accion url="/api/admin/solicitudes" metodo="PATCH" cuerpo={{ id: Number(s.id), estado: "descartada" }} texto="Descartar" clase="btn-borde h-10 text-sm text-muted" />}
            </div>
          </li>
        ))}
        {filas.length === 0 && <li className="tarjeta p-10 text-center text-muted">No hay solicitudes en este estado.</li>}
      </ul>
    </main>
  );
}
