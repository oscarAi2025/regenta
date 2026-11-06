import Link from "next/link";
import { redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion, puede } from "@/lib/sesion";
import { Cabecera, pesos } from "@/components/ui/Cabecera";
import { MOTIVOS, MOTIVO_IDS, llevaActa, nombreMotivo } from "@/lib/ajustes";
import { Ajustar } from "./Ajustar";

export const metadata = { title: "Ajustar o dar de baja" };

type Fila = { id: string; numero: number; motivo: string; detalle: string | null; fecha: string; responsable: string | null; lotes: number; unidades: number;
  valor: number | null; sin_costo: boolean; productos: string[]; conteo: number | null };

export default async function Ajustes({ searchParams }: { searchParams: Promise<{ motivo?: string }> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puede.moverInventario(s.rol)) redirect("/inventario?aviso=permiso");
  const { motivo: m = "" } = await searchParams;
  const motivo = (MOTIVO_IDS as readonly string[]).includes(m) ? m : "";
  const costos = puede.verCostos(s.rol);
  const filas: Fila[] = await comoUsuario(s, async (c) => (await c.query(`
    select a.id, a.numero, a.motivo, a.detalle, to_char(a.creado at time zone 'America/Bogota', 'DD/MM/YYYY HH24:MI') fecha, mi.nombre responsable, k.numero conteo,
           count(al.id)::int lotes, coalesce(sum(al.unidades), 0)::int unidades,
           ${costos ? "sum(al.unidades * lc.costo_unidad)::float" : "null::float"} valor, ${costos ? "bool_or(lc.lote_id is null)" : "false"} sin_costo,
           (array_agg(p.nombre order by al.id))[1:3] productos
    from ajustes a join ajuste_lineas al on al.ajuste_id = a.id join productos p on p.id = al.producto_id
    left join lote_costos lc on lc.lote_id = al.lote_id
    left join miembros mi on mi.empresa_id = a.empresa_id and mi.user_id = a.usuario_id
    left join conteos k on k.id = a.conteo_id
    where a.empresa_id = $1 and ($2 = '' or a.motivo = $2)
    group by a.id, mi.nombre, k.numero order by a.creado desc limit 100`, [s.empresa, motivo])).rows);
  const filtros: [string, string][] = [["", "Todos"], ...MOTIVOS.map((x) => [x.id, x.nombre] as [string, string])];
  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo="Ajustar o dar de baja" sub="Saca del inventario lo vencido, averiado, perdido o devuelto, o corrige una diferencia de conteo. Todo queda con motivo, responsable y fecha.">
        <Link href="/inventario" className="btn-borde">Volver a inventario</Link>
      </Cabecera>
      <Ajustar verCosto={costos} />

      <section aria-labelledby="historial-t" className="grid gap-3 max-w-5xl">
        <h2 id="historial-t" className="titulo text-2xl">Historial de ajustes</h2>
        <nav aria-label="Filtrar por motivo" className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin]">
          {filtros.map(([k, t]) => (
            <Link key={k || "todos"} href={k ? `?motivo=${k}` : "/inventario/ajustes"} aria-current={motivo === k ? "page" : undefined} scroll={false}
              className={`shrink-0 px-3 py-1.5 rounded-lg text-sm font-semibold border ${motivo === k ? "bg-ink text-white border-ink" : "bg-surface text-muted border-line hover:text-ink"}`}>{t}</Link>
          ))}
        </nav>
        {filas.length === 0 ? (
          <p className="tarjeta p-8 text-center text-muted">{motivo ? `No hay ajustes con el motivo «${nombreMotivo(motivo)}».` : "Todavía no hay ajustes de inventario."}</p>
        ) : (
          <ul className="tarjeta divide-y divide-line" aria-label="Ajustes registrados">
            {filas.map((f) => (
              <li key={f.id} className="px-4 py-3 grid gap-1 sm:grid-cols-[110px_minmax(0,1fr)_auto] sm:gap-4 sm:items-center">
                <div className="flex sm:block items-baseline gap-2">
                  <p className="font-semibold num">N.º {f.numero}</p>
                  <p className="text-sm text-muted num">{f.fecha}</p>
                </div>
                <div className="min-w-0">
                  <p className="font-semibold">{nombreMotivo(f.motivo)}{f.conteo ? ` · conteo N.º ${f.conteo}` : f.detalle ? <span className="font-normal text-muted"> · {f.detalle}</span> : null}</p>
                  <p className="text-sm text-muted truncate">{f.productos.join(", ")}{f.lotes > f.productos.length ? ` y ${f.lotes - f.productos.length} más` : ""} · {String(f.responsable ?? "—").split(" (")[0]}</p>
                </div>
                <div className="flex items-center gap-3 sm:justify-end">
                  <p className={`num font-semibold ${f.unidades < 0 ? "text-alerta" : "text-cruz"}`}>{f.unidades > 0 ? "+" : ""}{f.unidades.toLocaleString("es-CO")} und
                    {costos && <span className="block text-sm font-normal text-muted text-right">{f.valor === null ? "sin costo" : `${f.valor < 0 ? "−" : ""}${pesos(Math.abs(f.valor))}${f.sin_costo ? "*" : ""}`}</span>}</p>
                  {llevaActa(f.motivo) && <Link href={`/inventario/actas/${f.id}`} className="btn-borde h-9 px-3 text-sm" aria-label={`Acta de baja N.º ${f.numero}`}>Acta</Link>}
                </div>
              </li>
            ))}
          </ul>
        )}
        {costos && filas.some((f) => f.sin_costo) && <p className="text-sm text-muted">* Hay lotes sin costo registrado: el valor no los incluye.</p>}
      </section>
    </main>
  );
}
