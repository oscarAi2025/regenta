import Link from "next/link";
import { redirect } from "next/navigation";
import { comoUsuario, sinComodines } from "@/lib/db";
import { leerSesion, puede } from "@/lib/sesion";
import { Cabecera, Dato } from "@/components/ui/Cabecera";
import { pesos } from "@/lib/formato";

export const metadata = { title: "Historial de Alegra" };

const ESTADO: Record<string, string> = { pagada: "Pagada", por_cobrar: "Por cobrar", anulada: "Anulada", borrador: "Borrador" };
const fecha = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" });

/** Ventas hechas en Alegra antes de pasar a Regenta: solo consulta (cliente, número o producto). No cuentan en los
 *  informes de Regenta ni en el inventario; las que quedaron por cobrar están en Cartera. */
export default async function Historial({ searchParams }: { searchParams: Promise<{ q?: string; cliente?: string }> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puede.vender(s.rol)) redirect("/inicio?aviso=permiso");
  const sp = await searchParams;
  const q = (sp.q ?? "").trim().slice(0, 80);
  const cliente = /^[0-9a-f-]{36}$/i.test(sp.cliente ?? "") ? sp.cliente! : null;
  const palabras = q.toLowerCase().split(/\s+/).filter(Boolean).slice(0, 5).map(sinComodines);
  const d = await comoUsuario(s, async (c) => {
    const donde = `x.empresa_id = $1 and ($2::uuid is null or x.cliente_id = $2)
      and (cardinality($3::text[]) = 0 or (select bool_and(sin_tildes(lower(coalesce(x.prefijo, '') || x.numero || ' ' || coalesce(x.cliente_nombre, '') || ' ' || coalesce(x.cliente_doc, '') || ' ' ||
        coalesce((select string_agg(l ->> 'nombre', ' ') from jsonb_array_elements(x.lineas) l), ''))) like '%' || sin_tildes(w) || '%') from unnest($3::text[]) w))`;
    const filas = (await c.query(`select x.id, coalesce(x.prefijo, '') || coalesce(x.numero::text, '') numero, x.fecha::text, x.cliente_nombre, x.cliente_doc, x.total::float, x.saldo::float, x.estado,
        jsonb_array_length(x.lineas)::int lineas from ventas_externas x where ${donde} order by x.fecha desc, x.numero desc nulls last limit 300`, [s.empresa, cliente, palabras])).rows as
      { id: string; numero: string; fecha: string; cliente_nombre: string | null; cliente_doc: string | null; total: number; saldo: number; estado: string; lineas: number }[];
    const tot = (await c.query(`select count(*)::int n, coalesce(sum(total) filter (where estado <> 'anulada'), 0)::float total, min(fecha)::text desde, max(fecha)::text hasta
      from ventas_externas x where ${donde}`, [s.empresa, cliente, palabras])).rows[0] as { n: number; total: number; desde: string | null; hasta: string | null };
    const nombre = cliente ? (await c.query(`select nombre from clientes where id = $1 and empresa_id = $2`, [cliente, s.empresa])).rows[0]?.nombre as string | undefined : undefined;
    return { filas, tot, nombre };
  });
  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Link href="/ventas" className="text-sm font-semibold text-cruz w-fit">← Ventas</Link>
      <Cabecera titulo="Historial de Alegra" sub={d.nombre ? `Compras de ${d.nombre} en Alegra` : "Ventas hechas en Alegra antes de pasar a Regenta. Solo consulta: no cuentan en los informes ni en el inventario."} />
      <section className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <Dato titulo="Documentos" valor={d.tot.n} />
        <Dato titulo="Vendido" valor={pesos(d.tot.total)} nota="sin anuladas" />
        <Dato titulo="Periodo" valor={d.tot.desde ? `${fecha(d.tot.desde)} – ${fecha(d.tot.hasta!)}` : "—"} />
      </section>
      <form className="flex flex-wrap gap-2" role="search">
        {cliente && <input type="hidden" name="cliente" value={cliente} />}
        <label htmlFor="q" className="sr-only">Buscar en el historial</label>
        <input id="q" name="q" defaultValue={q} placeholder="Cliente, NIT, número o producto" className="campo flex-1 min-w-48" />
        <button className="btn-borde">Buscar</button>
        {(q || cliente) && <Link href="/ventas/historial" className="btn-borde">Ver todo</Link>}
      </form>
      <div className="tarjeta overflow-x-auto">
        <table className="w-full text-[15px] min-w-[680px]">
          <thead className="text-left text-sm text-muted border-b border-line">
            <tr><th className="px-4 py-3 font-semibold">Fecha</th><th className="px-4 py-3 font-semibold">Número</th><th className="px-4 py-3 font-semibold">Cliente</th><th className="px-4 py-3 font-semibold">Estado</th><th className="px-4 py-3 font-semibold text-right">Total</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {d.filas.map((f) => (
              <tr key={f.id} className="hover:bg-paper/50">
                <td className="px-4 py-3 num text-muted">{fecha(f.fecha)}</td>
                <td className="px-4 py-3"><Link href={`/ventas/historial/${f.id}`} className="num font-semibold hover:underline">{f.numero}</Link><span className="text-muted text-sm"> · {f.lineas} línea{f.lineas === 1 ? "" : "s"}</span></td>
                <td className="px-4 py-3">{f.cliente_nombre ?? "—"}{f.cliente_doc && <span className="text-muted text-sm num"> · {f.cliente_doc}</span>}</td>
                <td className={`px-4 py-3 ${f.estado === "por_cobrar" ? "text-alerta font-semibold" : f.estado === "anulada" ? "text-muted line-through" : ""}`}>{ESTADO[f.estado]}{f.estado === "por_cobrar" ? ` · debe ${pesos(f.saldo)}` : ""}</td>
                <td className="px-4 py-3 num text-right">{pesos(f.total)}</td>
              </tr>
            ))}
            {d.filas.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-muted">{q ? `Nada coincide con «${q}».` : "No hay ventas traídas de Alegra."}</td></tr>}
          </tbody>
        </table>
      </div>
      {d.tot.n > d.filas.length && <p className="text-sm text-muted">Se muestran los {d.filas.length} más recientes de {d.tot.n}: busca para encontrar uno más antiguo.</p>}
    </main>
  );
}
