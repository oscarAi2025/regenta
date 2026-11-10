import { redirect } from "next/navigation";
import { comoUsuario, sinComodines } from "@/lib/db";
import Link from "next/link";
import { leerSesion, puede } from "@/lib/sesion";
import { puedePrecios } from "@/lib/precios";
import { Cabecera } from "@/components/ui/Cabecera";
import { pesos } from "@/lib/formato";
import { CostosPendientes } from "./CostosPendientes";

export const metadata = { title: "Inventario" };

const fmt = (d: string | null) => (d ? new Date(d + "T00:00:00").toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" }) : "—");
const dias = (d: string | null) => (d ? Math.round((Date.parse(d + "T00:00:00") - Date.now()) / 864e5) : null);

type Fila = { id: string; nombre: string; laboratorio: string | null; unidades_por_caja: number; precio_caja: number; unidades: number; stock_minimo: number; total: number; vencidas: number; separadas: number;
  lotes: { lote: string; vence: string | null; unidades: number; costo: number | null; bloqueado: boolean }[] };

const POR_PAGINA = 100;

export default async function Inventario({ searchParams }: { searchParams: Promise<{ ver?: string; q?: string; pagina?: string }> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  const { ver = "vencen", q = "", pagina: pg = "1" } = await searchParams;
  const pagina = Math.min(Math.max(Number.parseInt(pg, 10) || 1, 1), 10000);
  const costos = puede.verCostos(s.rol);
  const datos = await comoUsuario(s, async (c) => {
    const resumen = (await c.query(`
      select count(*) filter (where vence < current_date and unidades > 0)::int vencidos,
             count(*) filter (where vence between current_date and current_date + 30 and unidades > 0)::int v30,
             count(*) filter (where vence between current_date + 31 and current_date + 90 and unidades > 0)::int v90
      from v_stock_lotes where empresa_id = $1`, [s.empresa])).rows[0];
    const agotados = (await c.query(`select count(*)::int n from productos p where empresa_id = $1 and activo
      and coalesce((select sum(unidades) from v_stock_vigente where producto_id = p.id), 0) <= 0`, [s.empresa])).rows[0].n;
    const valor = costos ? (await c.query(`select coalesce(sum(s.unidades * lc.costo_unidad), 0)::float v from v_stock_vigente s join lote_costos lc on lc.lote_id = s.lote_id where s.empresa_id = $1 and s.unidades > 0`, [s.empresa])).rows[0].v : null;
    const filtro = ver === "agotados" ? "and coalesce(st.unidades, 0) <= 0" : ver === "todos" ? "" : ver === "vencidos" ? "and st.vencidas > 0"
      : "and st.por_vencer <= current_date + 90";
    const palabras = q.trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 6).map(sinComodines);
    const filas: Fila[] = (await c.query(`
      select p.id, p.nombre, p.laboratorio, p.unidades_por_caja, p.precio_caja::float, p.stock_minimo, coalesce(st.unidades, 0)::int unidades, coalesce(st.vencidas, 0)::int vencidas, coalesce(st.separadas, 0)::int separadas, count(*) over ()::int total,
        coalesce((select json_agg(json_build_object('lote', l.lote, 'vence', l.vence, 'unidades', l.unidades, 'bloqueado', l.bloqueado, 'costo', ${costos ? "(select costo_unidad::float from lote_costos where lote_id = l.lote_id)" : "null"}) order by l.vence nulls last)
                  from v_stock_lotes l where l.producto_id = p.id and l.unidades > 0), '[]') lotes
      from productos p
      left join lateral (select sum(unidades) filter (where (vence is null or vence >= current_date) and not bloqueado) unidades, min(vence) filter (where unidades > 0) proximo, min(vence) filter (where unidades > 0 and vence >= current_date) por_vencer,
        sum(unidades) filter (where vence < current_date and unidades > 0) vencidas, sum(unidades) filter (where bloqueado and unidades > 0 and (vence is null or vence >= current_date)) separadas
        from v_stock_lotes where producto_id = p.id) st on true
      where p.empresa_id = $1 and p.activo ${filtro}
        and (cardinality($2::text[]) = 0 or (select bool_and(sin_tildes(p.nombre || ' ' || coalesce(p.laboratorio, '')) like '%' || sin_tildes(w) || '%') from unnest($2::text[]) w))
      order by st.proximo nulls last, p.nombre limit ${POR_PAGINA} offset $3`, [s.empresa, palabras, (pagina - 1) * POR_PAGINA])).rows;
    // Lotes con existencias que entraron sin costo (los recibe la bodega): el dueño o el administrador lo completan.
    const sinCosto = costos ? (await c.query(`select l.lote_id, p.nombre, l.lote, l.unidades, p.unidades_por_caja,
        (select m.motivo from movimientos m where m.lote_id = l.lote_id and m.tipo = 'compra' order by m.creado desc limit 1) motivo,
        (select k.id from compra_lineas cl join compras k on k.id = cl.compra_id where cl.lote_id = l.lote_id and k.estado = 'por_costear' limit 1) compra_id
      from v_stock_lotes l join productos p on p.id = l.producto_id where l.empresa_id = $1 and l.unidades > 0
        and not exists (select 1 from lote_costos lc where lc.lote_id = l.lote_id) order by p.nombre limit 60`, [s.empresa])).rows : [];
    // Compras que la bodega recibió sin costos: se costean en la compra (ahí nace la cuenta por pagar).
    const porCostear = costos ? (await c.query(`select c.id, c.numero, c.numero_factura, p.nombre proveedor from compras c join proveedores p on p.id = c.proveedor_id
      where c.empresa_id = $1 and c.estado = 'por_costear' order by c.creado limit 30`, [s.empresa])).rows as { id: string; numero: number; numero_factura: string; proveedor: string }[] : [];
    const conteo = puede.moverInventario(s.rol) ? ((await c.query(`select numero from conteos where empresa_id = $1 and estado = 'abierto' order by creado limit 1`, [s.empresa])).rows[0]?.numero as number | undefined) ?? null : null;
    return { resumen, agotados, valor, filas, sinCosto, conteo, porCostear };
  });
  const kardex = puede.moverInventario(s.rol);
  const tabs = [["vencen", "Vencen en 90 días"], ["vencidos", "Vencidos"], ["agotados", "Agotados"], ["todos", "Todo"]] as const;
  if (pagina > 1 && datos.filas.length === 0) redirect(`/inventario?ver=${ver}${q ? `&q=${encodeURIComponent(q)}` : ""}`); // página que ya no existe
  const total = datos.filas[0]?.total ?? 0, paginas = Math.ceil(total / POR_PAGINA);
  const enlace = (n: number) => `?ver=${ver}${q ? `&q=${encodeURIComponent(q)}` : ""}${n > 1 ? `&pagina=${n}` : ""}`;
  const costosTexto = paginas > 1 ? " · busca un producto o descarga todo en Excel" : "";
  return (
    <main className="p-4 sm:p-6">
      <Cabecera titulo="Inventario" sub={kardex ? "Lotes, vencimientos y lo que se acabó. Toca un producto para ver su kardex." : "Lotes, vencimientos y lo que se acabó."}>
        {puede.moverInventario(s.rol) && <>
          <Link href="/compras/nueva" className="btn-primario">Recibir mercancía</Link>
          <Link href="/compras" className="btn-borde">Compras</Link>
          <Link href="/inventario/ajustes" className="btn-borde">Ajustar o dar de baja</Link>
          {puede.moverInventario(s.rol) && <Link href="/inventario/lotes" className="btn-borde">Corregir lotes</Link>}
          <Link href="/inventario/conteos" className="btn-borde">{datos.conteo ? `Conteo N.º ${datos.conteo} en curso` : "Conteo físico"}</Link>
          {puedePrecios.cuarentena(s.rol) && <Link href="/inventario/cuarentena" className="btn-borde">Cuarentena</Link>}
          <Link href="/temperatura" className="btn-borde">Temperatura y humedad</Link>
        </>}
      </Cabecera>
      {(datos.sinCosto.length > 0 || datos.porCostear.length > 0) && <CostosPendientes lotes={datos.sinCosto.filter((l) => !l.compra_id)} compras={datos.porCostear} />}
      <div className="mt-4 grid grid-cols-2 lg:grid-cols-5 gap-3">
        {[["Lotes vencidos", datos.resumen.vencidos, "text-alerta"], ["Vencen en 30 días", datos.resumen.v30, "text-alerta"], ["Vencen en 31–90 días", datos.resumen.v90, "text-aviso"], ["Productos agotados", datos.agotados, "text-ink"]].map(([t, n, c]) => (
          <div key={t as string} className="bg-surface border border-line rounded-xl px-4 py-3">
            <p className="text-sm text-muted">{t}</p><p className={`num font-cond text-3xl ${c}`} style={{ fontWeight: 700 }}>{n as number}</p>
          </div>
        ))}
        {datos.valor !== null && (
          <div className="bg-surface border border-line rounded-xl px-4 py-3 col-span-2 lg:col-span-1">
            <p className="text-sm text-muted">Inventario a costo</p><p className="num font-cond text-3xl" style={{ fontWeight: 700 }}>{pesos(datos.valor)}</p>
          </div>
        )}
      </div>
      <form className="mt-5 flex flex-wrap items-center gap-2" role="search">
        <nav className="flex gap-1 bg-surface border border-line rounded-xl p-1 max-w-full overflow-x-auto [scrollbar-width:none]" aria-label="Filtro">
          {tabs.map(([k, t]) => (
            <a key={k} href={`?ver=${k}${q ? `&q=${encodeURIComponent(q)}` : ""}`} aria-current={ver === k ? "page" : undefined}
              className={`shrink-0 whitespace-nowrap px-3 py-1.5 rounded-lg text-sm font-semibold ${ver === k ? "bg-ink text-white" : "text-muted"}`}>{t}</a>
          ))}
        </nav>
        <input type="hidden" name="ver" value={ver} />
        <label htmlFor="q" className="sr-only">Buscar en el inventario</label>
        <input id="q" name="q" defaultValue={q} placeholder="Buscar producto" className="h-11 rounded-xl border border-line bg-surface px-4 flex-1 min-w-48" />
        <a href="/api/inventario/exportar" download className="btn-borde h-11 inline-flex items-center">Descargar en Excel</a>
      </form>
      {total > 0 && <p className="mt-3 text-sm text-muted num">{total <= POR_PAGINA ? `${total.toLocaleString("es-CO")} ${total === 1 ? "producto" : "productos"}` : `Productos ${((pagina - 1) * POR_PAGINA + 1).toLocaleString("es-CO")} a ${Math.min(pagina * POR_PAGINA, total).toLocaleString("es-CO")} de ${total.toLocaleString("es-CO")}`}{costosTexto}</p>}
      <div className="mt-4 bg-surface border border-line rounded-2xl overflow-x-auto">
        <table className="w-full text-sm min-w-[720px]">
          <thead className="text-left text-muted border-b border-line">
            <tr><th className="px-4 py-3 font-semibold">Producto</th><th className="px-4 py-3 font-semibold">Existencias</th><th className="px-4 py-3 font-semibold">Lotes (vence)</th><th className="px-4 py-3 font-semibold text-right">Precio caja</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {datos.filas.map((f) => (
              <tr key={f.id} className="align-top">
                <td className="px-4 py-3">{kardex ? <Link href={`/productos/${f.id}#kardex`} className="font-semibold hover:underline" title="Ver kardex">{f.nombre}</Link> : <p className="font-semibold">{f.nombre}</p>}<p className="text-muted">{f.laboratorio ?? "Sin laboratorio"}</p></td>
                <td className={`px-4 py-3 num ${f.unidades <= 0 ? "text-alerta font-semibold" : ""}`}>
                  {f.unidades <= 0 && f.vencidas + f.separadas > 0 ? <>0 vendibles<span className="block text-sm">{f.vencidas ? `${f.vencidas.toLocaleString("es-CO")} und vencidas: dar de baja` : ""}{f.vencidas && f.separadas ? " · " : ""}{f.separadas ? `${f.separadas.toLocaleString("es-CO")} und separadas` : ""}</span></>
                    : f.unidades <= 0 ? "Agotado" : f.unidades_por_caja > 1 ? `${Math.floor(f.unidades / f.unidades_por_caja)} cajas${f.unidades % f.unidades_por_caja ? ` + ${f.unidades % f.unidades_por_caja} und` : ""}` : `${f.unidades} und`}
                </td>
                <td className="px-4 py-3">
                  <ul className="flex flex-wrap gap-1.5">
                    {f.lotes.map((l) => {
                      const d = dias(l.vence);
                      const tono = l.bloqueado ? "bg-ink text-white" : d !== null && d <= 30 ? "bg-alerta-soft text-alerta" : d !== null && d <= 90 ? "bg-aviso-soft text-aviso" : "bg-paper text-ink";
                      return <li key={l.lote} className={`num rounded-md px-2 py-1 ${tono}`}><span className="font-semibold">{l.lote}</span> · {fmt(l.vence)} · {l.unidades} und{l.costo !== null ? ` · ${pesos(l.costo)}/und` : ""}{l.bloqueado ? " · en cuarentena: no se vende" : ""}</li>;
                    })}
                  </ul>
                </td>
                <td className="px-4 py-3 num text-right">{pesos(f.precio_caja)}</td>
              </tr>
            ))}
            {datos.filas.length === 0 && <tr><td colSpan={4} className="px-4 py-10 text-center text-muted">
              {q ? <>Ningún producto coincide con «{q}» en este filtro. </> : ver === "agotados" ? "No tienes productos agotados. " : ver === "todos" ? "Aún no hay productos en el inventario. " : ver === "vencidos" ? "No tienes lotes vencidos con existencias. " : "Ningún lote vence en los próximos 90 días. "}
              {ver !== "todos" && <a href={`?ver=todos${q ? `&q=${encodeURIComponent(q)}` : ""}`} className="font-semibold text-ink underline">Ver todo el inventario</a>}
            </td></tr>}
          </tbody>
        </table>
      </div>
      {paginas > 1 && (
        <nav className="mt-4 flex flex-wrap items-center gap-2" aria-label="Páginas del inventario">
          {pagina > 1 ? <a href={enlace(pagina - 1)} className="btn-borde h-10 text-sm" rel="prev">Anterior</a> : <span className="btn-borde h-10 text-sm opacity-40" aria-disabled="true">Anterior</span>}
          <span className="text-sm num px-2">Página {pagina} de {paginas}</span>
          {pagina < paginas ? <a href={enlace(pagina + 1)} className="btn-borde h-10 text-sm" rel="next">Siguiente</a> : <span className="btn-borde h-10 text-sm opacity-40" aria-disabled="true">Siguiente</span>}
        </nav>
      )}
    </main>
  );
}
