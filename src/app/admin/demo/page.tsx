import Link from "next/link";
import { sinRLS } from "@/lib/db";
import { Cabecera, Dato } from "@/components/ui/Cabecera";
import { exigirAdmin, fechaHora } from "@/lib/admin-pagina";

export const metadata = { title: "Visitas a la demo" };
export const dynamic = "force-dynamic";

const ROL: Record<string, string> = { dueno: "Dueño", cajero: "Cajero", bodega: "Bodega" };
const PERIODOS = [["7", "7 días"], ["30", "30 días"], ["90", "90 días"]] as const;
const dur = (a: string | Date, b: string | Date) => { const s = Math.max(0, Math.round((+new Date(b) - +new Date(a)) / 1000)); return s < 60 ? `${s} s` : s < 3600 ? `${Math.round(s / 60)} min` : `${(s / 3600).toFixed(1)} h`; };
const lugar = (v: { ciudad?: string | null; region?: string | null; pais?: string | null }) => [v.ciudad, v.region, v.pais && v.pais !== "CO" ? v.pais : null].filter(Boolean).join(", ") || "Sin ubicación";

/**
 * Consola → Visitas a la demo (08/11/2026): quién entra, desde dónde (ciudad aproximada por IP), con qué dispositivo,
 * de dónde viene y qué hace dentro, para saber qué demos acaban en contratación y a quién llamar.
 */
export default async function VisitasDemo({ searchParams }: { searchParams: Promise<{ dias?: string; solo?: string }> }) {
  await exigirAdmin();
  const q = await searchParams;
  const dias = PERIODOS.some(([k]) => k === q.dias) ? Number(q.dias) : 7;
  const solo = q.solo === "interes";
  const d = await sinRLS(async (c) => {
    const existe = (await c.query(`select to_regclass('public.demo_visitas') is not null ok`)).rows[0].ok as boolean;
    if (!existe) return null;
    const desde = `now() - interval '${dias} days'`;
    const visitas = (await c.query(`
      select v.*, s.nombre lead_nombre, s.drogueria lead_drogueria, s.telefono lead_telefono,
        count(e.id)::int eventos,
        count(*) filter (where e.tipo = 'pagina')::int paginas,
        count(*) filter (where e.tipo = 'venta')::int ventas,
        count(*) filter (where e.tipo = 'ia')::int ia,
        count(*) filter (where e.tipo = 'contratar')::int contratar,
        count(*) filter (where e.tipo = 'whatsapp')::int whatsapp,
        (select count(*)::int from demo_visitas o where o.visitante = v.visitante and v.visitante is not null) veces
      from demo_visitas v left join demo_eventos e on e.visita_id = v.id left join solicitudes_demo s on s.id = v.solicitud_id
      where v.creada > ${desde} group by v.id, s.id order by v.creada desc limit 500`)).rows;
    const grupo = async (col: string) => (await c.query(`select coalesce(${col}, 'Sin dato') k, count(*)::int n from demo_visitas where creada > ${desde} group by 1 order by 2 desc limit 8`)).rows as { k: string; n: number }[];
    return { visitas, ciudades: await grupo("ciudad"), origenes: await grupo("origen"), dispositivos: await grupo("dispositivo") };
  });
  if (!d) return (
    <main className="p-4 sm:p-6"><Cabecera titulo="Visitas a la demo" sub="Falta aplicar la migración 039 en la base de datos (db/produccion/bloque4-039.sql)." /></main>
  );
  const v = d.visitas, n = v.length;
  const interes = (x: (typeof v)[number]) => x.contratar > 0 || x.whatsapp > 0 || !!x.solicitud_id;
  const pct = (k: number) => (n ? `${Math.round((k / n) * 100)} %` : "—");
  const lista = solo ? v.filter(interes) : v;
  const Grupo = ({ t, filas }: { t: string; filas: { k: string; n: number }[] }) => (
    <div className="tarjeta p-4 min-w-0"><h2 className="font-semibold">{t}</h2><ul className="mt-2 grid gap-1 text-sm">{filas.map((f) => <li key={f.k} className="flex justify-between gap-3"><span className="truncate">{f.k}</span><span className="num font-semibold">{f.n}</span></li>)}{!filas.length && <li className="text-muted">Sin visitas</li>}</ul></div>
  );
  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo="Visitas a la demo" sub="Quién entra a la droguería de demostración, desde dónde y qué hace. Ubicación aproximada por la conexión (ciudad), sin guardar la IP." />
      <nav className="flex flex-wrap gap-1 tarjeta p-1 w-fit" aria-label="Periodo">
        {PERIODOS.map(([k, t]) => <Link key={k} href={`?dias=${k}${solo ? "&solo=interes" : ""}`} aria-current={dias === Number(k) ? "page" : undefined} className={`px-3.5 py-2 rounded-xl text-sm font-semibold ${dias === Number(k) ? "bg-ink text-white" : "text-muted"}`}>{t}</Link>)}
      </nav>
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3" aria-label="Cifras">
        <Dato titulo="Visitas" valor={n} nota={`${new Set(v.map((x) => x.visitante).filter(Boolean)).size} personas distintas (aprox.)`} />
        <Dato titulo="Hicieron una venta" valor={v.filter((x) => x.ventas > 0).length} nota={pct(v.filter((x) => x.ventas > 0).length)} />
        <Dato titulo="Preguntaron a la IA" valor={v.filter((x) => x.ia > 0).length} nota={pct(v.filter((x) => x.ia > 0).length)} />
        <Dato titulo="Mostraron interés" valor={v.filter(interes).length} tono={v.filter(interes).length ? "cruz" : undefined} nota="Contratar, WhatsApp o dejaron datos" />
      </section>
      <section className="grid md:grid-cols-3 gap-3" aria-label="De dónde vienen">
        <Grupo t="Ciudades" filas={d.ciudades} /><Grupo t="Origen" filas={d.origenes} /><Grupo t="Dispositivo" filas={d.dispositivos} />
      </section>
      <nav className="flex flex-wrap gap-1 tarjeta p-1 w-fit" aria-label="Filtro">
        <Link href={`?dias=${dias}`} aria-current={!solo ? "page" : undefined} className={`px-3.5 py-2 rounded-xl text-sm font-semibold ${!solo ? "bg-ink text-white" : "text-muted"}`}>Todas</Link>
        <Link href={`?dias=${dias}&solo=interes`} aria-current={solo ? "page" : undefined} className={`px-3.5 py-2 rounded-xl text-sm font-semibold ${solo ? "bg-ink text-white" : "text-muted"}`}>Con interés</Link>
      </nav>
      <ul className="grid gap-2">
        {lista.map((x) => (
          <li key={x.id}>
            <Link href={`/admin/demo/${x.id}`} className="tarjeta p-4 grid gap-1 md:grid-cols-[minmax(0,1fr)_auto] md:items-center hover:border-ink">
              <div className="min-w-0">
                <p className="font-semibold">{lugar(x)} <span className="text-muted font-normal">· {x.dispositivo ?? "dispositivo desconocido"}{x.sistema ? ` (${x.sistema})` : ""} · entró como {ROL[x.rol] ?? x.rol ?? "dueño"}</span></p>
                <p className="text-sm text-muted">{fechaHora(x.creada)} · {dur(x.creada, x.ultima)} · {x.paginas} pantallas · desde {x.origen ?? "directo"}{x.campana ? ` (${x.campana})` : ""}{x.landing ? ` · llegó por ${x.landing}` : ""}{x.veces > 1 ? ` · ${x.veces}.ª visita de esta persona` : ""}</p>
                {x.lead_nombre && <p className="text-sm font-semibold text-cruz">Dejó sus datos: {x.lead_nombre} · {x.lead_drogueria} · {x.lead_telefono}</p>}
              </div>
              <p className="flex flex-wrap gap-1.5 text-xs font-semibold">
                {x.ventas > 0 && <span className="rounded-full bg-emerald-100 text-emerald-800 px-2 py-1">Vendió {x.ventas}</span>}
                {x.ia > 0 && <span className="rounded-full bg-sky-100 text-sky-800 px-2 py-1">IA {x.ia}</span>}
                {x.contratar > 0 && <span className="rounded-full bg-amber-100 text-amber-900 px-2 py-1">Contratar</span>}
                {x.whatsapp > 0 && <span className="rounded-full bg-green-100 text-green-800 px-2 py-1">WhatsApp</span>}
              </p>
            </Link>
          </li>
        ))}
        {!lista.length && <li className="tarjeta p-10 text-center text-muted">No hay visitas en este periodo.</li>}
      </ul>
    </main>
  );
}
