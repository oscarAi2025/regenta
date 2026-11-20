import Link from "next/link";
import { redirect } from "next/navigation";
import { comoUsuario, sinComodines } from "@/lib/db";
import { leerSesion, puede } from "@/lib/sesion";
import { Cabecera, Dato, pesos } from "@/components/ui/Cabecera";
import { EstadoDian } from "@/components/ui/EstadoDian";
import { Paginas } from "@/components/ui/Paginas";
import { MEDIO } from "@/lib/formato";

export const metadata = { title: "Ventas" };

// Ventas por rango de fechas: hoy, ayer, esta semana, este mes, el mes pasado, 30 días, el año o el rango que se elija,
// con búsqueda por número, cliente o producto. Para el dueño y el administrador la lista junta lo vendido en Regenta y el
// historial que vino de Alegra (marcado «Alegra»): así se ven TODAS las ventas en un solo lugar (20/11/2026, Oscar).

const POR_PAGINA = 50;
const iso = (d: Date) => d.toISOString().slice(0, 10);
const valida = (f?: string) => !!f && /^\d{4}-\d{2}-\d{2}$/.test(f) && f >= "2000-01-01" && new Date(f + "T12:00:00Z").toISOString().slice(0, 10) === f;
const fechaLarga = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" });

function rangos(hoy: string) {
  const d = new Date(hoy + "T12:00:00Z");
  const mas = (n: number) => { const x = new Date(d); x.setUTCDate(x.getUTCDate() + n); return iso(x); };
  const lunes = mas(-((d.getUTCDay() + 6) % 7));
  const mes1 = hoy.slice(0, 8) + "01";
  const ant = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() - 1, 1)), antFin = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 0));
  return [
    ["hoy", "Hoy", hoy, hoy], ["ayer", "Ayer", mas(-1), mas(-1)], ["semana", "Esta semana", lunes, hoy], ["mes", "Este mes", mes1, hoy],
    ["mes-anterior", "Mes anterior", iso(ant), iso(antFin)], ["30", "Últimos 30 días", mas(-29), hoy], ["anio", "Este año", hoy.slice(0, 4) + "-01-01", hoy],
  ] as const;
}

type Fila = { origen: "regenta" | "alegra"; id: string; fecha: string; hora: string | null; numero: string; cliente: string | null; total: number; devuelto: number;
  estado: string; condicion: string | null; medios: string | null; dian: string | null; lineas: number; cajero: string | null };

export default async function Ventas({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puede.vender(s.rol)) redirect("/inicio?aviso=permiso");
  const raw = await searchParams;
  const sp = Object.fromEntries(Object.entries(raw).map(([k, v]) => [k, Array.isArray(v) ? v[0] : v])) as Record<string, string | undefined>;
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
  const R = rangos(hoy);
  // Compatibilidad: ?dia=AAAA-MM-DD (enlaces viejos) = ese día.
  let desde = valida(sp.desde) ? sp.desde! : valida(sp.dia) ? sp.dia! : "";
  let hasta = valida(sp.hasta) ? sp.hasta! : valida(sp.dia) ? sp.dia! : "";
  const rango = R.find((r) => r[0] === sp.rango);
  if (rango) { desde = rango[2]; hasta = rango[3]; }
  if (!desde && !hasta) { desde = R[3][2]; hasta = R[3][3]; } // por defecto: este mes
  if (!desde) desde = hasta; if (!hasta) hasta = desde;
  if (desde > hasta) [desde, hasta] = [hasta, desde];
  const activo = R.find((r) => r[2] === desde && r[3] === hasta)?.[0] ?? "";
  const q = (sp.q ?? "").replace(/\0/g, "").trim().slice(0, 80);
  const dian = ["pendiente", "rechazado"].includes(sp.dian ?? "") ? sp.dian! : null;
  const conAlegra = puede.verCostos(s.rol) && !dian && sp.origen !== "regenta";
  const soloAlegra = conAlegra && sp.origen === "alegra";
  const pagina = Math.min(Math.max(Number.parseInt(sp.pagina ?? "1", 10) || 1, 1), 10000);

  const d = await comoUsuario(s, async (c) => {
    const palabras = q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 5).map(sinComodines);
    const p: unknown[] = [s.empresa, desde, hasta, palabras];
    const busca = (texto: string) => `(cardinality($4::text[]) = 0 or (select bool_and(sin_tildes(lower(${texto})) like '%' || sin_tildes(w) || '%') from unnest($4::text[]) w))`;
    const regenta = `
      select 'regenta' origen, v.id::text, (v.creado at time zone 'America/Bogota')::date fecha, to_char(v.creado at time zone 'America/Bogota', 'HH24:MI') hora,
             coalesce(v.prefijo, '') || v.numero numero, cl.nombre cliente, v.total::float total, coalesce(v.devuelto, 0)::float devuelto,
             case when v.estado = 'cerrada' then 'vendida' else v.estado end estado, v.condicion,
             (select string_agg(distinct pg.medio, ',') from pagos pg where pg.venta_id = v.id) medios, dd.estado dian,
             (select count(*) from venta_lineas l where l.venta_id = v.id)::int lineas, m.nombre cajero, v.creado orden
      from ventas v left join clientes cl on cl.id = v.cliente_id left join miembros m on m.empresa_id = v.empresa_id and m.user_id = v.usuario_id
      left join documentos_dian dd on dd.venta_id = v.id and dd.tipo = v.tipo_doc
      where v.empresa_id = $1 and v.origen is null and v.estado in ('cerrada', 'anulada')
        and ${dian ? `dd.estado = any($5)` : `(v.creado at time zone 'America/Bogota')::date between $2::date and $3::date`}
        and ${busca(`coalesce(v.prefijo, '') || v.numero::text || ' ' || coalesce(cl.nombre, '') || ' ' || coalesce(cl.numero_doc, '') || ' ' || coalesce((select string_agg(l.descripcion, ' ') from venta_lineas l where l.venta_id = v.id), '')`)}`;
    const alegra = `
      select 'alegra' origen, x.id::text, x.fecha, null::text hora, coalesce(x.prefijo, '') || coalesce(x.numero::text, '') numero, x.cliente_nombre cliente,
             x.total::float total, coalesce(x.devuelto, 0)::float devuelto,
             case when x.estado in ('pagada', 'por_cobrar') then 'vendida' when x.estado = 'anulada' then 'anulada' else 'borrador' end estado,
             case when x.estado = 'por_cobrar' then 'credito' else 'contado' end condicion, x.forma_pago medios, null::text dian,
             jsonb_array_length(x.lineas)::int lineas, null::text cajero, (x.fecha::timestamp + interval '12 hours') at time zone 'America/Bogota' orden
      from ventas_externas x
      where x.empresa_id = $1 and x.estado <> 'borrador' and x.fecha between $2::date and $3::date
        and ${busca(`coalesce(x.prefijo, '') || coalesce(x.numero::text, '') || ' ' || coalesce(x.cliente_nombre, '') || ' ' || coalesce(x.cliente_doc, '') || ' ' || coalesce((select string_agg(l ->> 'nombre', ' ') from jsonb_array_elements(x.lineas) l), '')`)}`;
    if (dian) p.push(dian === "pendiente" ? ["pendiente", "enviando"] : ["rechazado"]);
    const fuente = soloAlegra ? alegra : conAlegra ? `${regenta} union all ${alegra}` : regenta;
    const resumen = (await c.query(`select count(*) filter (where estado = 'vendida')::int ventas, count(*) filter (where estado = 'anulada')::int anuladas,
        coalesce(sum(total - devuelto) filter (where estado = 'vendida'), 0)::float neto, coalesce(sum(devuelto) filter (where estado = 'vendida'), 0)::float devuelto,
        count(*) filter (where estado = 'vendida' and origen = 'regenta')::int de_regenta, count(*) filter (where estado = 'vendida' and origen = 'alegra')::int de_alegra,
        coalesce(sum(total - devuelto) filter (where estado = 'vendida' and condicion = 'credito'), 0)::float a_credito, count(*)::int filas
      from (${fuente}) t`, p)).rows[0] as { ventas: number; anuladas: number; neto: number; devuelto: number; de_regenta: number; de_alegra: number; a_credito: number; filas: number };
    const filas = (await c.query(`select origen, id, fecha::text, hora, numero, cliente, total, devuelto, estado, condicion, medios, dian, lineas, cajero
      from (${fuente}) t order by orden desc, numero desc limit ${POR_PAGINA} offset ${(pagina - 1) * POR_PAGINA}`, p)).rows as Fila[];
    return { resumen, filas };
  });

  const enlace = (cambios: Record<string, string | number | null>) => {
    const u = new URLSearchParams();
    const base: Record<string, string | number | null> = { desde, hasta, q: q || null, origen: sp.origen ?? null, dian, ...cambios };
    for (const [k, v] of Object.entries(base)) if (v !== null && v !== "" && !(k === "pagina" && v === 1)) u.set(k, String(v));
    return `/ventas${u.size ? "?" + u : ""}`;
  };
  const paginas = Math.max(1, Math.ceil(d.resumen.filas / POR_PAGINA));
  const titulo = dian ? `Documentos ${dian === "pendiente" ? "esperando a la DIAN" : "rechazados por la DIAN"}` : desde === hasta ? fechaLarga(desde) : `Del ${fechaLarga(desde)} al ${fechaLarga(hasta)}`;
  const { resumen: r } = d;

  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo="Ventas" sub={titulo}>
        {dian && <Link href="/ventas" className="btn-borde">Ver todas las ventas</Link>}
        {puede.verCostos(s.rol) && <Link href={`/ventas/historial?desde=${desde}&hasta=${hasta}${q ? `&q=${encodeURIComponent(q)}` : ""}`} className="btn-borde">Por producto y cliente</Link>}
        {puede.anular(s.rol) && <Link href="/documentos" className="btn-borde">Documentos DIAN</Link>}
      </Cabecera>

      {!dian && (
        <section className="tarjeta p-4 grid gap-3" aria-label="Periodo">
          <nav aria-label="Periodos" className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin]">
            {R.map(([k, t]) => (
              <a key={k} href={enlace({ desde: null, hasta: null, rango: k, pagina: null })} aria-current={activo === k ? "page" : undefined}
                className={`shrink-0 px-3 py-1.5 rounded-lg text-sm font-semibold border ${activo === k ? "bg-ink text-white border-ink" : "bg-surface text-muted border-line hover:text-ink"}`}>{t}</a>
            ))}
          </nav>
          <form className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[150px_150px_minmax(0,1fr)_auto] lg:items-end" role="search">
            {sp.origen && <input type="hidden" name="origen" value={sp.origen} />}
            <div><label htmlFor="v-desde" className="etiqueta">Desde</label><input id="v-desde" name="desde" type="date" defaultValue={desde} max={hoy} className="campo" /></div>
            <div><label htmlFor="v-hasta" className="etiqueta">Hasta</label><input id="v-hasta" name="hasta" type="date" defaultValue={hasta} max={hoy} className="campo" /></div>
            <div><label htmlFor="v-q" className="etiqueta">Buscar</label><input id="v-q" name="q" defaultValue={q} className="campo" placeholder="Número, cliente, NIT o producto" /></div>
            <div className="flex gap-2"><button className="btn-oscuro">Ver ventas</button>{q && <a href={enlace({ q: null, pagina: null })} className="btn-borde">Quitar búsqueda</a>}</div>
          </form>
          {conAlegra || sp.origen === "regenta" ? (
            <nav aria-label="Origen" className="flex flex-wrap gap-1.5 text-sm">
              {[["", "Regenta y Alegra"], ["regenta", "Solo Regenta"], ["alegra", "Solo historial de Alegra"]].map(([k, t]) => (
                <a key={k || "todas"} href={enlace({ origen: k || null, pagina: null })} aria-current={(sp.origen ?? "") === k ? "page" : undefined}
                  className={`px-2.5 py-1 rounded-md font-semibold border ${(sp.origen ?? "") === k ? "bg-ink text-white border-ink" : "bg-surface text-muted border-line hover:text-ink"}`}>{t}</a>
              ))}
            </nav>
          ) : null}
        </section>
      )}

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3" aria-label="Resumen">
        <Dato titulo="Vendido" valor={pesos(r.neto)} tono="cruz" nota={r.devuelto > 0 ? `sin ${pesos(r.devuelto)} devueltos` : r.a_credito > 0 ? `${pesos(r.a_credito)} a crédito` : undefined} />
        <Dato titulo="Ventas" valor={r.ventas.toLocaleString("es-CO")} nota={conAlegra && r.de_alegra ? `${r.de_regenta} en Regenta · ${r.de_alegra} de Alegra` : undefined} />
        <Dato titulo="Ticket promedio" valor={pesos(r.ventas ? r.neto / r.ventas : 0)} />
        <Dato titulo="Anuladas" valor={r.anuladas.toLocaleString("es-CO")} tono={r.anuladas ? "aviso" : undefined} />
      </section>

      <div className="tarjeta overflow-x-auto">
        <table className="w-full text-[15px] min-w-[820px]" aria-label="Ventas del periodo">
          <thead className="text-left text-sm text-muted border-b border-line">
            <tr><th className="px-4 py-3 font-semibold">Fecha</th><th className="px-4 py-3 font-semibold">Número</th><th className="px-4 py-3 font-semibold">Cliente</th>
              <th className="px-4 py-3 font-semibold">Pago</th><th className="px-4 py-3 font-semibold">Estado</th><th className="px-4 py-3 font-semibold text-right">Total</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {d.filas.map((f) => {
              const href = f.origen === "regenta" ? `/ventas/${f.id}` : `/ventas/historial/${f.id}`;
              const pago = f.origen === "alegra" ? (f.condicion === "credito" ? "Crédito" : f.medios ?? "Contado")
                : f.condicion === "credito" && !f.medios ? "Crédito" : String(f.medios ?? "").split(",").filter(Boolean).map((m) => MEDIO[m] ?? m).join(" + ");
              return (
                <tr key={f.origen + f.id} className="hover:bg-paper/50 align-top">
                  <td className="px-4 py-3 num whitespace-nowrap">{fechaLarga(f.fecha)}{f.hora && <span className="block text-sm text-muted">{f.hora}</span>}</td>
                  <td className="px-4 py-3"><Link href={href} className="num font-semibold underline-offset-2 hover:underline">{f.numero}</Link>
                    <span className="block text-sm text-muted">{f.lineas} producto{f.lineas === 1 ? "" : "s"}{f.origen === "alegra" ? " · Alegra" : f.cajero ? ` · ${String(f.cajero).split(" (")[0]}` : ""}</span></td>
                  <td className="px-4 py-3 max-w-[30ch] truncate" title={f.cliente ?? undefined}>{f.cliente ?? <span className="text-muted">Consumidor final</span>}</td>
                  <td className="px-4 py-3 text-sm">{pago || "—"}</td>
                  <td className="px-4 py-3">{f.estado === "anulada" ? <span className="text-sm font-semibold text-alerta">Anulada</span>
                    : f.origen === "regenta" ? <EstadoDian e={f.dian} /> : <span className="text-sm text-muted">{f.condicion === "credito" ? "Por cobrar" : "Pagada"}</span>}</td>
                  <td className={`px-4 py-3 num font-semibold text-right whitespace-nowrap ${f.estado === "anulada" ? "line-through text-muted" : ""}`}>{pesos(f.total - (f.estado === "anulada" ? 0 : f.devuelto))}
                    {f.devuelto > 0 && f.estado !== "anulada" && <span className="block text-xs font-normal text-muted">devuelto {pesos(f.devuelto)}</span>}</td>
                </tr>
              );
            })}
            {d.filas.length === 0 && <tr><td colSpan={6} className="px-4 py-12 text-center text-muted">
              {q ? "No hay ventas con esa búsqueda en este periodo." : dian ? "No hay documentos en este estado." : "No hay ventas en este periodo. Prueba «Este mes», «Mes anterior» o «Este año»."}</td></tr>}
          </tbody>
        </table>
      </div>
      <Paginas pagina={pagina} paginas={paginas} enlace={(n) => enlace({ pagina: n })} etiqueta="Páginas de ventas"
        resumen={`${d.resumen.filas.toLocaleString("es-CO")} documentos`} />
    </main>
  );
}
