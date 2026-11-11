import Link from "next/link";
import { redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion, puede } from "@/lib/sesion";
import { Cabecera, Dato } from "@/components/ui/Cabecera";
import { pesos } from "@/lib/formato";
import { ESTADO_HISTORIAL, documentosHistorial, leerFiltro, resumenHistorial, ventasRegenta } from "@/lib/historial-alegra";
import { Paginas } from "@/components/ui/Paginas";

export const metadata = { title: "Historial de ventas" };

const POR_PAGINA = 100;
const fecha = (d: string) => new Date(d + "T12:00:00").toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" });
const mesTexto = (m: string) => { const t = new Date(m + "-15T12:00:00").toLocaleDateString("es-CO", { month: "long", year: "numeric" }); return t.charAt(0).toUpperCase() + t.slice(1); };

/** Todo lo vendido en Alegra antes de pasar a Regenta: resumen, ventas por mes, productos y clientes que más compran, y
 *  cada documento con sus líneas. Solo consulta: no mueve inventario ni va a la DIAN; lo que quedó por cobrar está en Cartera. */
export default async function Historial({ searchParams }: { searchParams: Promise<{ q?: string; cliente?: string; desde?: string; hasta?: string; pagina?: string }> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puede.verCostos(s.rol)) redirect("/ventas?aviso=permiso"); // informe de gerencia: dueño y administrador
  const sp = await searchParams;
  const f = leerFiltro(sp);
  const pagina = Math.min(Math.max(Number.parseInt(sp.pagina ?? "1", 10) || 1, 1), 1000);
  const d = await comoUsuario(s, async (c) => {
    const r = await resumenHistorial(c, s.empresa, f);
    const docs = await documentosHistorial(c, s.empresa, f, POR_PAGINA, (pagina - 1) * POR_PAGINA);
    const total = (await c.query(`select count(*)::int n from ventas_externas where empresa_id = $1`, [s.empresa])).rows[0].n as number;
    const nombre = f.cliente ? (await c.query(`select nombre from clientes where id = $1 and empresa_id = $2`, [f.cliente, s.empresa])).rows[0]?.nombre as string | undefined : undefined;
    // Con filtro (fechas, cliente o texto) también salen las ventas hechas en Regenta: el buscador por fechas no puede
    // dejar fuera las de ayer.
    const regenta = f.q || f.cliente || f.desde || f.hasta || total === 0 ? await ventasRegenta(c, s.empresa, f) : null;
    return { ...r, docs, total, nombre, regenta };
  });
  const filtros = new URLSearchParams(Object.entries({ q: f.q, cliente: f.cliente ?? "", desde: f.desde ?? "", hasta: f.hasta ?? "" }).filter(([, v]) => v));
  const enlace = (n: number) => { const p = new URLSearchParams(filtros); if (n > 1) p.set("pagina", String(n)); const t = p.toString(); return `/ventas/historial${t ? `?${t}` : ""}`; };
  const docsTotales = d.resumen.todos;
  if (pagina > 1 && d.docs.length === 0 && docsTotales > 0) redirect(enlace(Math.ceil(docsTotales / POR_PAGINA))); // página que ya no existe
  const paginas = Math.max(1, Math.ceil(docsTotales / POR_PAGINA));
  const hayFiltro = !!(f.q || f.cliente || f.desde || f.hasta);
  const rg = d.regenta;
  const seccionRegenta = rg && (
    <section className="tarjeta p-4 sm:p-5 min-w-0 border-2 border-cruz/40" aria-labelledby="regenta-t">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="regenta-t" className="titulo text-xl">Ventas en Regenta {f.desde || f.hasta ? (f.desde === f.hasta ? `del ${fecha(f.desde!)}` : `${f.desde ? `del ${fecha(f.desde)}` : ""} ${f.hasta ? `al ${fecha(f.hasta)}` : ""}`) : hayFiltro ? "con este filtro" : "(las más recientes)"}</h2>
        <p className="num text-sm"><b className="text-lg">{pesos(rg.total)}</b> · {rg.n} venta{rg.n === 1 ? "" : "s"}{rg.anuladas ? ` · ${rg.anuladas} anulada${rg.anuladas === 1 ? "" : "s"}` : ""}
          {(f.desde || f.hasta) && <> · <Link href={`/reportes?desde=${f.desde ?? f.hasta}&hasta=${f.hasta ?? f.desde}`} className="text-cruz font-semibold underline">Ver reporte</Link></>}</p>
      </div>
      {rg.filas.length === 0 ? <p className="mt-2 text-muted">{f.q ? `Ninguna venta de Regenta coincide con «${f.q}».` : "No hay ventas de Regenta en estas fechas."}</p> : (
        <div className="mt-3 overflow-x-auto">
          <table className="w-full text-[15px] min-w-[640px]">
            <thead className="text-left text-sm text-muted border-b border-line"><tr><th className="py-2 pr-3 font-semibold">Fecha</th><th className="py-2 pr-3 font-semibold">Número</th><th className="py-2 pr-3 font-semibold">Cliente</th><th className="py-2 pr-3 font-semibold">Estado</th><th className="py-2 font-semibold text-right">Total</th></tr></thead>
            <tbody className="divide-y divide-line">{rg.filas.map((v) => (
              <tr key={v.id}>
                <td className="py-2 pr-3 num text-muted">{fecha(v.fecha)} · {v.hora}</td>
                <td className="py-2 pr-3"><Link href={`/ventas/${v.id}`} className="num font-semibold hover:underline">{v.numero}</Link><span className="text-muted text-sm"> · {v.lineas} línea{v.lineas === 1 ? "" : "s"}</span></td>
                <td className="py-2 pr-3">{v.cliente ?? "Consumidor final"}</td>
                <td className={`py-2 pr-3 ${v.estado === "anulada" ? "text-muted line-through" : ""}`}>{v.estado === "anulada" ? "Anulada" : "Vendida"}</td>
                <td className="py-2 num text-right font-semibold">{pesos(v.total)}</td>
              </tr>))}</tbody>
          </table>
        </div>
      )}
    </section>
  );
  const maxMes = Math.max(1, ...d.meses.map((m) => m.total));

  const formulario = (
    <form className="tarjeta p-4 grid gap-3 sm:grid-cols-[minmax(0,2fr)_auto_auto_auto] sm:items-end" role="search" aria-label="Filtrar el historial">
        {f.cliente && <input type="hidden" name="cliente" value={f.cliente} />}
        <label className="grid gap-1 text-sm font-semibold" htmlFor="q">Buscar<input id="q" name="q" defaultValue={f.q} placeholder="Cliente, NIT, número o producto" className="campo font-normal" /></label>
        <label className="grid gap-1 text-sm font-semibold" htmlFor="desde">Desde<input id="desde" name="desde" type="date" defaultValue={f.desde ?? ""} className="campo font-normal" /></label>
        <label className="grid gap-1 text-sm font-semibold" htmlFor="hasta">Hasta<input id="hasta" name="hasta" type="date" defaultValue={f.hasta ?? ""} className="campo font-normal" /></label>
        <div className="flex gap-2"><button className="btn-oscuro">Filtrar</button>{hayFiltro && <Link href="/ventas/historial" className="btn-borde">Ver todo</Link>}</div>
      </form>
  );
  if (d.total === 0) {
    return (
      <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
        <Link href="/ventas" className="text-sm font-semibold text-cruz w-fit">← Ventas</Link>
        <Cabecera titulo="Historial de ventas" sub="Busca las ventas por fechas, cliente, número o producto." />
        {formulario}
        {seccionRegenta}
      </main>
    );
  }
  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Link href="/ventas" className="text-sm font-semibold text-cruz w-fit">← Ventas</Link>
      <Cabecera titulo={d.nombre ? `Compras de ${d.nombre} en Alegra` : "Historial de ventas"}
        sub={`Todo lo vendido en Alegra del ${d.resumen.minimo ? fecha(d.resumen.minimo) : "—"} al ${d.resumen.maximo ? fecha(d.resumen.maximo) : "—"}: ${d.total.toLocaleString("es-CO")} documentos. Solo consulta: no mueve inventario ni va a la DIAN; lo que quedó por cobrar está en Cartera.`}>
        <a href={`/api/ventas/historial/exportar${filtros.toString() ? `?${filtros}` : ""}`} download className="btn-borde">Descargar en Excel</a>
      </Cabecera>

      {formulario}

      {seccionRegenta}
      {seccionRegenta && <h2 className="titulo text-2xl -mb-2">Ventas en Alegra (antes de Regenta)</h2>}

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3" aria-label="Resumen">
        <Dato titulo="Facturado" valor={pesos(d.resumen.facturado)} nota={`${d.resumen.n.toLocaleString("es-CO")} documentos${d.resumen.anuladas ? ` · ${d.resumen.anuladas} anulados aparte` : ""}`} />
        <Dato titulo="IVA" valor={pesos(d.resumen.iva)} />
        <Dato titulo="Clientes distintos" valor={d.resumen.clientes.toLocaleString("es-CO")} />
        <Dato titulo="Por cobrar" valor={pesos(d.resumen.por_cobrar)} tono={d.resumen.por_cobrar > 0 ? "alerta" : undefined} nota={d.resumen.por_cobrar > 0 ? <Link href="/cartera" className="underline">Ver en Cartera</Link> : undefined} />
      </section>

      <div className="grid gap-5 xl:grid-cols-2">
        <section className="tarjeta p-4 sm:p-5 min-w-0" aria-labelledby="meses-t">
          <h2 id="meses-t" className="titulo text-xl mb-3">Ventas por mes</h2>
          {d.meses.length === 0 ? <p className="text-muted">Sin ventas en este filtro.</p> : (
            <ul className="grid grid-cols-[minmax(0,1fr)] gap-2">
              {d.meses.map((m) => (
                <li key={m.mes} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_auto] items-center gap-3 text-sm">
                  <span className="font-semibold">{mesTexto(m.mes)}</span>
                  <span className="h-3 rounded-full bg-paper overflow-hidden" aria-hidden="true"><span className="block h-full bg-cruz rounded-full" style={{ width: `${Math.max(2, (m.total / maxMes) * 100)}%` }} /></span>
                  <span className="num text-right">{pesos(m.total)}<span className="block text-xs text-muted">{m.documentos} doc.</span></span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="tarjeta p-4 sm:p-5 min-w-0" aria-labelledby="clientes-t">
          <h2 id="clientes-t" className="titulo text-xl mb-3">Clientes que más compraron</h2>
          <ol className="grid grid-cols-[minmax(0,1fr)] gap-1.5 text-sm">
            {d.clientes.map((c, i) => (
              <li key={i} className="flex items-baseline gap-3 min-w-0">
                <span className="text-muted num w-5 text-right">{i + 1}</span>
                <span className="flex-1 min-w-0 truncate">{c.cliente_id ? <Link href={`/clientes/${c.cliente_id}`} className="font-semibold hover:underline">{c.cliente}</Link> : <span className="font-semibold">{c.cliente}</span>}
                  <span className="text-muted"> · {c.documentos} doc. · última {fecha(c.ultima)}</span></span>
                <span className="num font-semibold">{pesos(c.total)}</span>
              </li>
            ))}
          </ol>
        </section>
      </div>

      <section className="tarjeta p-4 sm:p-5 min-w-0" aria-labelledby="productos-t">
        <h2 id="productos-t" className="titulo text-xl mb-3">Productos más vendidos</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[560px]">
            <thead className="text-left text-muted border-b border-line"><tr><th className="py-2 pr-3 font-semibold">#</th><th className="py-2 pr-3 font-semibold">Producto</th><th className="py-2 pr-3 font-semibold text-right">Cantidad</th><th className="py-2 pr-3 font-semibold text-right">Documentos</th><th className="py-2 font-semibold text-right">Vendido</th></tr></thead>
            <tbody className="divide-y divide-line">
              {d.productos.map((p, i) => (
                <tr key={i}><td className="py-2 pr-3 text-muted num">{i + 1}</td><td className="py-2 pr-3 font-semibold">{p.producto}</td><td className="py-2 pr-3 num text-right">{p.cantidad.toLocaleString("es-CO")}</td><td className="py-2 pr-3 num text-right">{p.documentos}</td><td className="py-2 num text-right">{pesos(p.total)}</td></tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="grid gap-3" aria-labelledby="docs-t">
        <h2 id="docs-t" className="titulo text-2xl">Documentos</h2>
        <div className="tarjeta overflow-x-auto">
          <table className="w-full text-[15px] min-w-[720px]">
            <thead className="text-left text-sm text-muted border-b border-line">
              <tr><th className="px-4 py-3 font-semibold">Fecha</th><th className="px-4 py-3 font-semibold">Número</th><th className="px-4 py-3 font-semibold">Cliente</th><th className="px-4 py-3 font-semibold">Estado</th><th className="px-4 py-3 font-semibold text-right">Total</th></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {d.docs.map((x) => (
                <tr key={x.id} className="hover:bg-paper/50">
                  <td className="px-4 py-3 num text-muted">{fecha(x.fecha)}</td>
                  <td className="px-4 py-3"><Link href={`/ventas/historial/${x.id}`} className="num font-semibold hover:underline">{x.numero}</Link><span className="text-muted text-sm"> · {x.lineas} línea{x.lineas === 1 ? "" : "s"}</span></td>
                  <td className="px-4 py-3">{x.cliente_nombre ?? "—"}{x.cliente_doc && <span className="text-muted text-sm num"> · {x.cliente_doc}</span>}</td>
                  <td className={`px-4 py-3 ${x.estado === "por_cobrar" ? "text-alerta font-semibold" : x.estado === "anulada" ? "text-muted line-through" : ""}`}>{x.estado === "por_cobrar" && x.saldo_hoy === 0 ? "Pagada en Regenta" : ESTADO_HISTORIAL[x.estado]}{x.estado === "por_cobrar" && x.saldo_hoy > 0 ? ` · debe ${pesos(x.saldo_hoy)}` : ""}</td>
                  <td className="px-4 py-3 num text-right">{pesos(x.total)}</td>
                </tr>
              ))}
              {d.docs.length === 0 && <tr><td colSpan={5} className="px-4 py-10 text-center text-muted">{f.q ? `Nada coincide con «${f.q}».` : "No hay documentos en estas fechas."}</td></tr>}
            </tbody>
          </table>
        </div>
        {paginas > 1 && (
          <Paginas pagina={pagina} paginas={paginas} enlace={enlace} etiqueta="Páginas del historial" resumen={`${docsTotales.toLocaleString("es-CO")} documentos`} />
        )}
      </section>
    </main>
  );
}
