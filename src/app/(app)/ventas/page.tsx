import Link from "next/link";
import { redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion, puede } from "@/lib/sesion";
import { Cabecera, Dato, pesos } from "@/components/ui/Cabecera";
import { EstadoDian } from "@/components/ui/EstadoDian";
import { MEDIO } from "@/lib/formato";

export const metadata = { title: "Ventas" };

export default async function Ventas({ searchParams }: { searchParams: Promise<{ dia?: string; dian?: string }> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puede.vender(s.rol)) redirect("/inicio?aviso=permiso");
  const sp = await searchParams;
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
  const valida = (f?: string) => !!f && /^\d{4}-\d{2}-\d{2}$/.test(f) && new Date(f + "T12:00:00Z").toISOString().slice(0, 10) === f;
  const dia = valida(sp.dia) ? sp.dia! : hoy;
  const dian = ["pendiente", "rechazado"].includes(sp.dian ?? "") ? sp.dian! : null;
  const filas = await comoUsuario(s, async (c) => (await c.query(`
    select v.id, v.prefijo || v.numero numero, v.total::float, coalesce(v.devuelto, 0)::float devuelto, v.condicion, v.estado, v.tipo_doc, to_char(v.creado at time zone 'America/Bogota', 'HH24:MI') hora,
           coalesce(m.nombre, '—') cajero, d.estado dian,
           (select string_agg(distinct p.medio, ',') from pagos p where p.venta_id = v.id) medios,
           (select count(*) from venta_lineas l where l.venta_id = v.id)::int lineas
    from ventas v left join miembros m on m.empresa_id = v.empresa_id and m.user_id = v.usuario_id
    left join documentos_dian d on d.venta_id = v.id and d.tipo = v.tipo_doc
    where v.empresa_id = $1 and v.origen is null and ${dian ? "d.estado = any($3)" : "(v.creado at time zone 'America/Bogota')::date = $2::date"}
    order by v.creado desc limit 300`, dian ? [s.empresa, dia, dian === "pendiente" ? ["pendiente", "enviando"] : ["rechazado"]] : [s.empresa, dia])).rows);
  const historial = await comoUsuario(s, async (c) => (await c.query(`select count(*)::int n, coalesce(sum(total - devuelto) filter (where estado in ('pagada', 'por_cobrar')), 0)::float total,
    min(fecha)::text desde, max(fecha)::text hasta from ventas_externas where empresa_id = $1`, [s.empresa])).rows[0] as { n: number; total: number; desde: string | null; hasta: string | null });
  const corta = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("es-CO", { month: "short", year: "numeric" });
  const cerradas = filas.filter((f) => f.estado === "cerrada");
  // Neto: lo devuelto no es venta (igual que «Ventas netas» en el turno).
  const total = cerradas.reduce((a, f) => a + f.total - f.devuelto, 0);
  const otro = (n: number) => { const d = new Date(dia + "T12:00:00"); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo="Ventas" sub={dian ? `Documentos ${dian === "pendiente" ? "esperando a la DIAN" : "rechazados por la DIAN"}` : new Date(dia + "T12:00:00").toLocaleDateString("es-CO", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}>
        {!dian && <>
          <Link href={`/ventas?dia=${otro(-1)}`} className="btn-borde" aria-label="Día anterior">←</Link>
          <form className="flex gap-2"><input type="date" name="dia" defaultValue={dia} max={hoy} className="campo w-auto" aria-label="Elegir día" /><button className="btn-borde">Ver</button></form>
          <Link href={`/ventas?dia=${otro(1)}`} className={`btn-borde ${dia >= hoy ? "pointer-events-none opacity-40" : ""}`} aria-label="Día siguiente">→</Link>
        </>}
        {dian && <Link href="/ventas" className="btn-borde">Ver ventas de hoy</Link>}
        {puede.anular(s.rol) && <Link href="/documentos" className="btn-borde">Documentos DIAN</Link>}
      </Cabecera>
      {historial.n > 0 && !dian && puede.verCostos(s.rol) && (
        <Link href="/ventas/historial" className="tarjeta px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1 hover:border-ink/40">
          <span className="flex-1 min-w-[220px]"><span className="font-semibold">Historial de ventas de Alegra</span>
            <span className="block text-sm text-muted num">{historial.n.toLocaleString("es-CO")} documentos · {pesos(historial.total)} facturados{historial.desde ? ` · ${corta(historial.desde)} a ${corta(historial.hasta!)}` : ""} · por mes, productos y clientes</span></span>
          <span className="btn-borde h-10 text-sm">Ver historial</span>
        </Link>
      )}
      {!dian && (
        <section className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <Dato titulo="Total del día" valor={pesos(total)} tono="cruz" nota={cerradas.some((f) => f.devuelto > 0) ? "sin lo devuelto" : undefined} />
          <Dato titulo="Ventas" valor={cerradas.length} nota={filas.length > cerradas.length ? `${filas.length - cerradas.length} anulada(s)` : undefined} />
          <Dato titulo="Ticket promedio" valor={pesos(cerradas.length ? total / cerradas.length : 0)} />
        </section>
      )}
      <div className="tarjeta overflow-x-auto">
        <table className="w-full text-[15px] min-w-[680px]">
          <thead className="text-left text-sm text-muted border-b border-line">
            <tr><th className="px-4 py-3 font-semibold">Hora</th><th className="px-4 py-3 font-semibold">Número</th><th className="px-4 py-3 font-semibold">Cajero</th><th className="px-4 py-3 font-semibold">Pago</th><th className="px-4 py-3 font-semibold">DIAN</th><th className="px-4 py-3 font-semibold text-right">Total</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {filas.map((f) => (
              <tr key={f.id} className="hover:bg-paper/50">
                <td className="px-4 py-3 num text-muted">{f.hora}</td>
                <td className="px-4 py-3"><Link href={`/ventas/${f.id}`} className="num font-semibold underline-offset-2 hover:underline">{f.numero}</Link><span className="text-muted text-sm"> · {f.lineas} línea{f.lineas === 1 ? "" : "s"}</span></td>
                <td className="px-4 py-3">{String(f.cajero).split(" (")[0]}</td>
                <td className="px-4 py-3 text-sm">{f.condicion === "credito" && !f.medios ? "Crédito" : String(f.medios ?? "").split(",").map((m: string) => MEDIO[m] ?? m).join(" + ")}</td>
                <td className="px-4 py-3">{f.estado === "anulada" ? <span className="text-sm font-semibold text-alerta">Anulada</span> : <EstadoDian e={f.dian} />}</td>
                <td className={`px-4 py-3 num font-semibold text-right ${f.estado === "anulada" ? "line-through text-muted" : ""}`}>{pesos(f.total)}</td>
              </tr>
            ))}
            {filas.length === 0 && <tr><td colSpan={6} className="px-4 py-12 text-center text-muted">No hay ventas {dian ? "en este estado" : "este día"}.</td></tr>}
          </tbody>
        </table>
      </div>
    </main>
  );
}
