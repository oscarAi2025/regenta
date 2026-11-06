import Link from "next/link";
import { redirect } from "next/navigation";
import { comoUsuario, sinComodines } from "@/lib/db";
import { leerSesion } from "@/lib/sesion";
import { Cabecera, existenciasTexto, pesos } from "@/components/ui/Cabecera";

export const metadata = { title: "Productos" };

export default async function Productos({ searchParams }: { searchParams: Promise<{ q?: string; ver?: string; pagina?: string }> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  const { q = "", ver = "", pagina: pg = "1" } = await searchParams;
  const POR_PAGINA = 50;
  const pagina = Math.max(1, Math.min(1000, Number.parseInt(pg, 10) || 1));
  const gestiona = s.rol === "dueno" || s.rol === "admin";
  const palabras = q.trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6).map(sinComodines);
  const { filas, total, hallados } = await comoUsuario(s, async (c) => {
    const filas = (await c.query(`
      select count(*) over ()::int hallados, p.id, p.nombre, p.laboratorio, p.ean, p.iva::float, p.unidades_por_caja, p.precio_caja::float, p.precio_unidad::float, p.stock_minimo,
             p.requiere_formula, p.control_especial, coalesce(st.u, 0)::int unidades
      from productos p left join lateral (select sum(unidades) u from v_stock_vigente where producto_id = p.id) st on true
      where p.empresa_id = $1 and p.activo
        and (cardinality($2::text[]) = 0 or p.ean = $3 or (select bool_and(lower(p.nombre || ' ' || coalesce(p.laboratorio, '')) like '%' || w || '%') from unnest($2::text[]) w))
        ${ver === "bajos" ? "and p.stock_minimo > 0 and coalesce(st.u, 0) <= p.stock_minimo * p.unidades_por_caja" : ""}
      order by p.nombre limit $4 offset $5`, [s.empresa, palabras, q.trim(), POR_PAGINA, (pagina - 1) * POR_PAGINA])).rows;
    const total = (await c.query(`select count(*)::int n from productos where empresa_id = $1 and activo`, [s.empresa])).rows[0].n;
    return { filas, total, hallados: (filas[0]?.hallados as number | undefined) ?? 0 };
  });
  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo="Productos" sub={`${total.toLocaleString("es-CO")} productos en tu droguería`}>
        {gestiona && <><Link href="/productos/nuevo" className="btn-primario">Agregar producto</Link><Link href="/productos/importar" className="btn-borde">Cargar desde Excel</Link><Link href="/control-especial" className="btn-borde">Libro de control especial</Link></>}
      </Cabecera>
      <form className="flex flex-wrap gap-2" role="search">
        <label htmlFor="q" className="sr-only">Buscar producto</label>
        <input id="q" name="q" defaultValue={q} placeholder="Nombre, laboratorio o código de barras" className="campo flex-1 min-w-56" />
        {ver && <input type="hidden" name="ver" value={ver} />}
        <button className="btn-oscuro">Buscar</button>
        <Link href={ver === "bajos" ? "/productos" : "/productos?ver=bajos"} className={ver === "bajos" ? "btn-oscuro" : "btn-borde"}>Bajo el mínimo</Link>
      </form>
      <div className="tarjeta overflow-x-auto">
        <table className="w-full text-[15px] min-w-[760px]">
          <thead className="text-left text-sm text-muted border-b border-line">
            <tr><th className="px-4 py-3 font-semibold">Producto</th><th className="px-4 py-3 font-semibold">Código</th><th className="px-4 py-3 font-semibold">Presentación</th><th className="px-4 py-3 font-semibold">Existencias</th><th className="px-4 py-3 font-semibold text-right">Precio</th>{gestiona && <th className="px-4 py-3" />}</tr>
          </thead>
          <tbody className="divide-y divide-line">
            {filas.map((p) => {
              const bajo = p.stock_minimo > 0 && p.unidades <= p.stock_minimo * p.unidades_por_caja;
              return (
                <tr key={p.id} className="hover:bg-paper/50">
                  <td className="px-4 py-3"><p className="font-semibold leading-snug">{p.nombre}</p><p className="text-sm text-muted">{p.laboratorio ?? "Genérico"}{p.iva ? ` · IVA ${p.iva} %` : ""}
                    {p.control_especial ? <span className="ml-2 inline-block rounded px-1.5 py-0.5 text-[12px] font-semibold bg-alerta-soft text-alerta">Control especial</span>
                      : p.requiere_formula ? <span className="ml-2 inline-block rounded px-1.5 py-0.5 text-[12px] font-semibold bg-aviso-soft text-aviso">Con fórmula</span> : null}</p></td>
                  <td className="px-4 py-3 num text-sm text-muted">{p.ean ?? "—"}</td>
                  <td className="px-4 py-3 text-sm">{p.unidades_por_caja > 1 ? `Caja x${p.unidades_por_caja}${p.precio_unidad ? " · se fracciona" : ""}` : "Unidad"}</td>
                  <td className={`px-4 py-3 num text-sm ${p.unidades <= 0 ? "text-alerta font-semibold" : bajo ? "text-aviso font-semibold" : ""}`}>{existenciasTexto(p.unidades, p.unidades_por_caja)}</td>
                  <td className="px-4 py-3 num text-right"><span className="font-semibold">{pesos(p.precio_caja)}</span>{p.precio_unidad ? <span className="block text-sm text-muted">{pesos(p.precio_unidad)} und</span> : null}</td>
                  {gestiona && <td className="px-4 py-3 text-right"><Link href={`/productos/${p.id}`} className="inline-block py-2 px-2 text-sm font-semibold text-cruz">Editar</Link></td>}
                </tr>
              );
            })}
            {filas.length === 0 && <tr><td colSpan={6} className="px-4 py-12 text-center text-muted">No hay productos que coincidan.{gestiona && <> <Link href="/productos/nuevo" className="underline">Agrega uno</Link>.</>}</td></tr>}
          </tbody>
        </table>
      </div>
      {hallados > POR_PAGINA && (() => {
        const ultima = Math.ceil(hallados / POR_PAGINA);
        const url = (n: number) => `?${new URLSearchParams({ ...(q ? { q } : {}), ...(ver ? { ver } : {}), pagina: String(n) })}`;
        return (
          <nav className="flex flex-wrap items-center justify-between gap-3" aria-label="Páginas">
            <p className="text-sm text-muted">{((pagina - 1) * POR_PAGINA + 1).toLocaleString("es-CO")}–{Math.min(pagina * POR_PAGINA, hallados).toLocaleString("es-CO")} de {hallados.toLocaleString("es-CO")}</p>
            <div className="flex gap-2">
              {pagina > 1 && <Link href={url(pagina - 1)} className="btn-borde">Anterior</Link>}
              {pagina < ultima && <Link href={url(pagina + 1)} className="btn-oscuro">Siguiente</Link>}
            </div>
          </nav>
        );
      })()}
    </main>
  );
}
