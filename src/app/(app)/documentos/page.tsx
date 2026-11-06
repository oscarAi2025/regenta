import Link from "next/link";
import { redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion, puede } from "@/lib/sesion";
import { Cabecera, pesos } from "@/components/ui/Cabecera";
import { ESTADOS, POR_PAGINA, TIPOS, consultaDian, contarDocumentos, leerFiltro, listarDocumentos, qs, ventasRechazadas, type Documento, type EstadoDoc } from "@/lib/documentos";
import { ReenviarDoc, ReenviarTodos } from "./Reenviar";

export const metadata = { title: "Documentos electrónicos" };

const COLOR: Record<EstadoDoc, string> = {
  aceptado: "bg-cruz-soft text-cruz", simulado: "bg-sky-100 text-sky-900", pendiente: "bg-aviso-soft text-aviso",
  rechazado: "bg-alerta-soft text-alerta", anulado: "bg-paper text-muted",
};
const fechaLarga = (f: string) => new Date(f + "T12:00:00").toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" });

function Estado({ e }: { e: EstadoDoc }) {
  return <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[13px] font-semibold whitespace-nowrap ${COLOR[e]}`}>{ESTADOS[e]}</span>;
}

/** Comprobante, PDF del proveedor (si lo hay) y CUFE/CUDE con su consulta en la DIAN. */
function Soporte({ d }: { d: Documento }) {
  const comprobante = d.tipo === "nc_devolucion" ? (d.devolucion_id ? `/tiquete/devolucion/${d.devolucion_id}` : null) : d.tipo === "nc_anulacion" ? null : `/tiquete/${d.venta_id}`;
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      {comprobante && <a href={comprobante} className="font-semibold text-cruz underline-offset-2 hover:underline">Comprobante</a>}
      {d.pdf && <a href={d.pdf} target="_blank" rel="noopener noreferrer" className="font-semibold text-cruz underline-offset-2 hover:underline">PDF</a>}
      {d.cufe && (
        <details className="basis-full">
          <summary className="cursor-pointer font-semibold text-ink/80 hover:text-ink w-fit">{d.tipo === "factura" ? "CUFE" : "CUDE"}</summary>
          <span className="mt-1 max-w-[280px] rounded-xl border border-line bg-paper/60 p-2.5 text-xs grid gap-1.5">
            <span className="break-all num">{d.cufe}</span>
            {d.simulado ? <span className="text-muted">Emisión simulada (demostración o numeración de pruebas): no se consulta en la DIAN.</span>
              : <a href={consultaDian(d.cufe)} target="_blank" rel="noopener noreferrer" className="font-semibold text-cruz">Consultar en la DIAN</a>}
          </span>
        </details>
      )}
    </span>
  );
}

export default async function Documentos({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puede.anular(s.rol)) redirect("/inicio?aviso=permiso"); // dueño y administrador
  const f = leerFiltro(await searchParams);
  const { docs, n, ventas } = await comoUsuario(s, async (c) => {
    const n = await contarDocumentos(c, s.empresa, f);
    return { n, docs: await listarDocumentos(c, s.empresa, f), ventas: n.rechazado ? await ventasRechazadas(c, s.empresa, f) : [] };
  });
  const totalFiltro = f.estado ? (f.estado === "pendiente" ? n.pendiente : n[f.estado]) : n.total;
  const paginas = Math.max(1, Math.ceil(totalFiltro / POR_PAGINA));
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
  const hace30 = new Date(new Date(hoy + "T12:00:00Z").getTime() - 29 * 86400000).toISOString().slice(0, 10);
  const filtrado = !!(f.tipo || f.estado || f.q);
  const contador = (estado: EstadoDoc, titulo: string, valor: number, tono: string, nota?: string) => {
    const activo = f.estado === estado;
    return (
      <Link href={`/documentos?${qs(f, { estado: activo ? null : estado })}`} aria-current={activo ? "true" : undefined} aria-label={`${titulo}: ${valor}${activo ? " (filtro activo, quitar)" : ""}`}
        className={`tarjeta px-4 py-3.5 transition-colors hover:border-ink ${activo ? "border-ink ring-2 ring-ink/15" : ""}`}>
        <span className="block text-sm text-muted">{titulo}</span>
        <span className={`block num titulo text-[30px] leading-tight ${valor ? tono : "text-ink"}`}>{valor.toLocaleString("es-CO")}</span>
        <span className="block text-[13px] text-muted mt-0.5">{activo ? "Mostrando solo estos · quitar" : nota ?? "Ver solo estos"}</span>
      </Link>
    );
  };

  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo="Documentos electrónicos" sub={`Tiquetes POS, facturas y notas crédito ante la DIAN · ${f.desde === f.hasta ? fechaLarga(f.desde) : `${fechaLarga(f.desde)} – ${fechaLarga(f.hasta)}`}`}>
        <a href={`/api/documentos?${qs(f)}`} className="btn-borde" download>Exportar a Excel (CSV)</a>
      </Cabecera>

      <form className="tarjeta p-4 grid grid-cols-2 md:grid-cols-[auto_auto_minmax(0,1fr)_minmax(0,1fr)_auto] gap-3 items-end" aria-label="Filtros">
        <label className="grid text-sm font-semibold gap-1">Desde<input type="date" name="desde" defaultValue={f.desde} max={hoy} className="campo font-normal" /></label>
        <label className="grid text-sm font-semibold gap-1">Hasta<input type="date" name="hasta" defaultValue={f.hasta} max={hoy} className="campo font-normal" /></label>
        <label className="grid text-sm font-semibold gap-1 col-span-2 md:col-span-1">Tipo
          <select name="tipo" defaultValue={f.tipo ?? ""} className="campo font-normal">
            <option value="">Todos los tipos</option>
            {Object.entries(TIPOS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select>
        </label>
        <label className="grid text-sm font-semibold gap-1 col-span-2 md:col-span-1">Buscar
          <input type="search" name="q" defaultValue={f.q} maxLength={60} placeholder="Número o cliente" className="campo font-normal" />
        </label>
        {f.estado && <input type="hidden" name="estado" value={f.estado} />}
        <div className="col-span-2 md:col-span-1 flex gap-2">
          <button className="btn-oscuro flex-1 md:flex-none">Buscar</button>
          {filtrado && <Link href={`/documentos?${qs(f, { tipo: null, estado: null, q: null })}`} className="btn-borde">Limpiar</Link>}
        </div>
      </form>

      <section className="grid grid-cols-3 gap-3" aria-label="Por estado">
        {contador("aceptado", "Aceptados", n.aceptado, "text-cruz", n.simulado ? `${n.simulado.toLocaleString("es-CO")} en emisión simulada` : undefined)}
        {contador("pendiente", "Enviando", n.pendiente, "text-aviso", n.pendiente ? "La cola los reintenta sola" : undefined)}
        {contador("rechazado", "Rechazados", n.rechazado, "text-alerta", n.rechazado ? "Corrige y reenvía" : undefined)}
      </section>

      {n.rechazado > 0 && (
        <section className="tarjeta border-alerta/40 bg-alerta-soft/40 p-4 flex flex-wrap items-center justify-between gap-3" aria-label="Rechazados">
          <p className="text-[15px] max-w-2xl"><b className="text-alerta">{n.rechazado === 1 ? "Hay 1 documento rechazado" : `Hay ${n.rechazado} documentos rechazados`} por la DIAN.</b> Revisa el motivo (datos del cliente o de la droguería), corrígelo y reenvía. Se arman de nuevo con los datos actuales.</p>
          <ReenviarTodos ventas={ventas} n={n.rechazado} />
        </section>
      )}

      {docs.length === 0 ? (
        <section className="tarjeta px-5 py-12 text-center grid gap-3 justify-items-center">
          {filtrado ? <>
            <p className="titulo text-xl">Ningún documento cumple estos filtros</p>
            <p className="text-muted max-w-md">Prueba con otro rango de fechas o quita los filtros.</p>
            <Link href={`/documentos?${qs(f, { tipo: null, estado: null, q: null })}`} className="btn-borde">Quitar filtros</Link>
          </> : <>
            <p className="titulo text-xl">No hay documentos en estas fechas</p>
            <p className="text-muted max-w-md">Cada venta de la caja genera su tiquete POS o su factura electrónica, y cada anulación o devolución su nota crédito. Aquí verás todos con su estado ante la DIAN.</p>
            <div className="flex flex-wrap gap-2 justify-center">
              <Link href={`/documentos?desde=${hace30}&hasta=${hoy}`} className="btn-borde">Ver los últimos 30 días</Link>
              <Link href="/caja" className="btn-primario">Ir a la caja</Link>
            </div>
          </>}
        </section>
      ) : (
        <>
          {/* Escritorio: tabla */}
          <div className="tarjeta overflow-x-auto hidden md:block">
            <table className="w-full text-[15px] min-w-[860px]">
              <caption className="sr-only">Documentos electrónicos</caption>
              <thead className="text-left text-sm text-muted border-b border-line">
                <tr>
                  <th scope="col" className="px-4 py-3 font-semibold">Fecha</th><th scope="col" className="px-4 py-3 font-semibold">Documento</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Cliente</th><th scope="col" className="px-4 py-3 font-semibold text-right">Total</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Estado DIAN</th><th scope="col" className="px-4 py-3 font-semibold">Soporte</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {docs.map((d) => (
                  <tr key={d.id} data-doc={d.numero} className="align-top hover:bg-paper/50">
                    <td className="px-4 py-3 num text-muted whitespace-nowrap text-sm">{d.fecha}</td>
                    <td className="px-4 py-3">
                      <span className="num font-semibold">{d.numero}</span>
                      <span className="block text-sm text-muted">{TIPOS[d.tipo]}{d.tipo.startsWith("nc") ? <> de <Link href={`/ventas/${d.venta_id}`} className="text-cruz font-semibold underline-offset-2 hover:underline">{d.venta}</Link></>
                        : <> · <Link href={`/ventas/${d.venta_id}`} className="text-cruz font-semibold underline-offset-2 hover:underline">Ver venta{d.venta_anulada ? " (anulada)" : ""}</Link></>}</span>
                    </td>
                    <td className="px-4 py-3 text-sm">{d.cliente ? <>{d.cliente}<span className="block text-muted num">{d.cliente_doc}</span></> : <span className="text-muted">Consumidor final</span>}</td>
                    <td className={`px-4 py-3 num font-semibold text-right whitespace-nowrap ${d.tipo.startsWith("nc") ? "text-alerta" : ""}`}>{d.tipo.startsWith("nc") ? "−" : ""}{pesos(d.total)}</td>
                    <td className="px-4 py-3 max-w-[300px]">
                      <Estado e={d.estado} />
                      {d.estado === "rechazado" && d.ultimo_error && <p className="mt-1 text-sm text-alerta line-clamp-3" title={d.ultimo_error}>{d.ultimo_error}</p>}
                      {d.estado === "pendiente" && <p className="mt-1 text-xs text-muted">Intentos: {d.intentos}{d.ultimo_error ? ` · ${d.ultimo_error}` : ""}</p>}
                      {d.estado === "anulado" && <p className="mt-1 text-xs text-muted">La venta se anuló antes de salir a la DIAN.</p>}
                    </td>
                    <td className="px-4 py-3"><span className="grid gap-2 justify-items-start"><Soporte d={d} />{d.estado === "rechazado" && <ReenviarDoc venta={d.venta_id} numero={d.numero} />}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Celular: tarjetas */}
          <ul className="grid gap-3 md:hidden" aria-label="Documentos electrónicos">
            {docs.map((d) => (
              <li key={d.id} data-doc={d.numero} className="tarjeta p-4 grid gap-2">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="num font-semibold">{d.numero}</p>
                    <p className="text-sm text-muted">{TIPOS[d.tipo]} · <span className="num">{d.fecha}</span></p>
                  </div>
                  <Estado e={d.estado} />
                </div>
                <div className="flex items-end justify-between gap-3">
                  <p className="text-sm min-w-0">{d.cliente ?? <span className="text-muted">Consumidor final</span>}</p>
                  <p className={`num font-semibold whitespace-nowrap ${d.tipo.startsWith("nc") ? "text-alerta" : ""}`}>{d.tipo.startsWith("nc") ? "−" : ""}{pesos(d.total)}</p>
                </div>
                {d.estado === "rechazado" && d.ultimo_error && <p className="text-sm text-alerta break-words">{d.ultimo_error}</p>}
                {d.estado === "anulado" && <p className="text-xs text-muted">La venta se anuló antes de salir a la DIAN.</p>}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-1 border-t border-line">
                  <Link href={`/ventas/${d.venta_id}`} className="text-sm font-semibold text-cruz">Venta {d.venta}</Link>
                  <Soporte d={d} />
                  {d.estado === "rechazado" && <ReenviarDoc venta={d.venta_id} numero={d.numero} />}
                </div>
              </li>
            ))}
          </ul>

          <nav className="flex flex-wrap items-center justify-between gap-3 text-sm" aria-label="Páginas">
            <p className="text-muted">{totalFiltro.toLocaleString("es-CO")} documento{totalFiltro === 1 ? "" : "s"} · página {Math.min(f.pagina, paginas)} de {paginas}</p>
            <div className="flex gap-2">
              {f.pagina > 1 ? <Link href={`/documentos?${qs(f, { pagina: f.pagina - 1 })}`} className="btn-borde h-10">← Anteriores</Link> : null}
              {f.pagina < paginas ? <Link href={`/documentos?${qs(f, { pagina: f.pagina + 1 })}`} className="btn-borde h-10">Siguientes →</Link> : null}
            </div>
          </nav>
        </>
      )}
      <p className="text-sm text-muted max-w-3xl">El XML y el PDF de cada documento los genera el proveedor de facturación electrónica: cuando entrega el PDF, aparece aquí. Con el CUFE/CUDE se consulta el documento en la DIAN.</p>
    </main>
  );
}
