import Link from "next/link";
import { redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion, puede } from "@/lib/sesion";
import { Cabecera, pesos } from "@/components/ui/Cabecera";
import { ESTADOS, POR_PAGINA, TIPOS, consultaDian, contarDocumentos, leerFiltro, listarDocumentos, qs, resta, reenviosRechazados, rutaReenvio, type Documento, type EstadoDoc } from "@/lib/documentos";
import { nombreClave } from "@/lib/dian/xml";
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

const enlace = "font-semibold text-cruz underline-offset-2 hover:underline";
const tipoDian = (d: Documento) => (d.tipo === "nc_anulacion" || d.tipo === "nc_devolucion" ? "nota_credito" : d.tipo);

/** Comprobante, XML, PDF del proveedor (si lo hay), nota débito (facturas) y CUFE/CUDE/CUDS con su consulta en la DIAN. */
function Soporte({ d }: { d: Documento }) {
  const comprobante = d.tipo === "nc_devolucion" ? (d.devolucion_id ? `/tiquete/devolucion/${d.devolucion_id}` : null)
    : d.tipo === "pos" || d.tipo === "factura" ? `/tiquete/${d.venta_id}` : null;
  const clave = nombreClave(tipoDian(d));
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      {comprobante && <a href={comprobante} className={enlace}>Comprobante</a>}
      {d.xml && <a href={`/api/documentos/${d.id}/xml`} download className={enlace} aria-label={`Descargar el XML de ${d.numero}`}>XML</a>}
      {d.pdf && <a href={d.pdf} target="_blank" rel="noopener noreferrer" className={enlace}>PDF</a>}
      {d.tipo === "factura" && !d.venta_anulada && d.estado !== "rechazado" && d.estado !== "anulado" &&
        <a href={`/documentos/nota-debito/${d.id}`} className={enlace} aria-label={`Nota débito de ${d.numero}`}>Nota débito</a>}
      {d.cufe && (
        <details className="basis-full">
          <summary className="cursor-pointer font-semibold text-ink/80 hover:text-ink w-fit">{clave}</summary>
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

/** De dónde sale el documento: su venta, la factura de la nota débito, o las compras del documento soporte. */
function Origen({ d }: { d: Documento }) {
  const compras = d.compras ?? [];
  if (d.tipo === "soporte" || d.tipo === "ajuste_soporte") return (
    <>
      {d.tipo === "ajuste_soporte" && d.origen && <> de <span className="num">{d.origen}</span> · {d.concepto === "anulacion" ? "anulación" : "corrección"}</>}
      {d.tipo === "soporte" && (compras.length > 1 ? " semanal" : " por operación")}
      {compras.length > 0 && <> · <a href={`/compras/${compras[0].id}`} className={`${enlace} whitespace-nowrap`}>{compras.length === 1 ? `Compra N.º ${compras[0].numero}` : `${compras.length} compras (N.º ${compras.map((k) => k.numero).join(", ")})`}</a></>}
      {d.anulado_por && <span className="block text-alerta">Anulado con {d.anulado_por}</span>}
    </>
  );
  if (!d.venta_id) return null;
  if (d.tipo === "nota_debito") return <> de <span className="num">{d.origen}</span> · <a href={`/ventas/${d.venta_id}`} className={enlace}>Venta {d.venta}</a></>;
  if (d.tipo.startsWith("nc")) return <> de <a href={`/ventas/${d.venta_id}`} className={enlace}>{d.venta}</a></>;
  return <> · <a href={`/ventas/${d.venta_id}`} className={enlace}>Ver venta{d.venta_anulada ? " (anulada)" : ""}</a></>;
}

function Tercero({ d }: { d: Documento }) {
  if (d.proveedor) return <>{d.proveedor}<span className="block text-muted num">{d.proveedor_doc ?? "Sin NIT"}</span></>;
  return d.cliente ? <>{d.cliente}<span className="block text-muted num">{d.cliente_doc}</span></> : <span className="text-muted">Consumidor final</span>;
}

export default async function Documentos({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puede.anular(s.rol)) redirect("/inicio?aviso=permiso"); // dueño y administrador
  const f = leerFiltro(await searchParams);
  const { docs, n, rutas } = await comoUsuario(s, async (c) => {
    const n = await contarDocumentos(c, s.empresa, f);
    return { n, docs: await listarDocumentos(c, s.empresa, f), rutas: n.rechazado ? await reenviosRechazados(c, s.empresa, f) : [] };
  });
  const totalFiltro = f.estado ? (f.estado === "pendiente" ? n.pendiente : n[f.estado]) : n.total;
  const paginas = Math.max(1, Math.ceil(totalFiltro / POR_PAGINA));
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
  const hace30 = new Date(new Date(hoy + "T12:00:00Z").getTime() - 29 * 86400000).toISOString().slice(0, 10);
  const filtrado = !!(f.tipo || f.estado || f.q);
  const contador = (estado: EstadoDoc, titulo: string, valor: number, tono: string, nota?: string) => {
    const activo = f.estado === estado;
    return (
      <a href={`/documentos?${qs(f, { estado: activo ? null : estado })}`} aria-current={activo ? "true" : undefined} aria-label={`${titulo}: ${valor}${activo ? " (filtro activo, quitar)" : ""}`}
        className={`tarjeta px-4 py-3.5 transition-colors hover:border-ink ${activo ? "border-ink ring-2 ring-ink/15" : ""}`}>
        <span className="block text-sm text-muted">{titulo}</span>
        <span className={`block num titulo text-[30px] leading-tight ${valor ? tono : "text-ink"}`}>{valor.toLocaleString("es-CO")}</span>
        <span className="block text-[13px] text-muted mt-0.5">{activo ? "Mostrando solo estos · quitar" : nota ?? "Ver solo estos"}</span>
      </a>
    );
  };

  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo="Documentos electrónicos" sub={`Tiquetes POS, facturas, notas y documentos soporte ante la DIAN · ${f.desde === f.hasta ? fechaLarga(f.desde) : `${fechaLarga(f.desde)} – ${fechaLarga(f.hasta)}`}`}>
        <a href={`/api/documentos?${qs(f)}`} className="btn-borde" download>Exportar a Excel (CSV)</a>
        <a href={`/api/documentos/xml?${qs(f)}`} className="btn-borde" download>Descargar XML (ZIP)</a>
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
          {filtrado && <a href={`/documentos?${qs(f, { tipo: null, estado: null, q: null })}`} className="btn-borde">Limpiar</a>}
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
          <ReenviarTodos rutas={rutas} n={n.rechazado} />
        </section>
      )}

      {docs.length === 0 ? (
        <section className="tarjeta px-5 py-12 text-center grid gap-3 justify-items-center">
          {filtrado ? <>
            <p className="titulo text-xl">Ningún documento cumple estos filtros</p>
            <p className="text-muted max-w-md">Prueba con otro rango de fechas o quita los filtros.</p>
            <a href={`/documentos?${qs(f, { tipo: null, estado: null, q: null })}`} className="btn-borde">Quitar filtros</a>
          </> : <>
            <p className="titulo text-xl">No hay documentos en estas fechas</p>
            <p className="text-muted max-w-md">Cada venta de la caja genera su tiquete POS o su factura electrónica, y cada anulación o devolución su nota crédito. Las compras a proveedores no obligados a facturar tienen su documento soporte. Aquí verás todos con su estado ante la DIAN.</p>
            <div className="flex flex-wrap gap-2 justify-center">
              <a href={`/documentos?desde=${hace30}&hasta=${hoy}`} className="btn-borde">Ver los últimos 30 días</a>
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
                  <th scope="col" className="px-4 py-3 font-semibold">Cliente o proveedor</th><th scope="col" className="px-4 py-3 font-semibold text-right">Total</th>
                  <th scope="col" className="px-4 py-3 font-semibold">Estado DIAN</th><th scope="col" className="px-4 py-3 font-semibold">Soporte</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {docs.map((d) => (
                  <tr key={d.id} data-doc={d.numero} className="align-top hover:bg-paper/50">
                    <td className="px-4 py-3 num text-muted whitespace-nowrap text-sm">{d.fecha}</td>
                    <td className="px-4 py-3">
                      <span className="num font-semibold">{d.numero}</span>
                      <span className="block text-sm text-muted">{TIPOS[d.tipo]}<Origen d={d} /></span>
                      {d.motivo && <span className="block text-xs text-muted max-w-[260px] break-words">Motivo: {d.motivo}</span>}
                    </td>
                    <td className="px-4 py-3 text-sm"><Tercero d={d} /></td>
                    <td className={`px-4 py-3 num font-semibold text-right whitespace-nowrap ${resta(d.tipo) ? "text-alerta" : ""}`}>{resta(d.tipo) ? "−" : ""}{pesos(d.total)}</td>
                    <td className="px-4 py-3 max-w-[300px]">
                      <Estado e={d.estado} />
                      {d.estado === "rechazado" && d.ultimo_error && <p className="mt-1 text-sm text-alerta line-clamp-3" title={d.ultimo_error}>{d.ultimo_error}</p>}
                      {d.estado === "pendiente" && <p className="mt-1 text-xs text-muted">Intentos: {d.intentos}{d.ultimo_error ? ` · ${d.ultimo_error}` : ""}</p>}
                      {d.estado === "anulado" && <p className="mt-1 text-xs text-muted">La venta se anuló antes de salir a la DIAN.</p>}
                    </td>
                    <td className="px-4 py-3"><span className="grid gap-2 justify-items-start"><Soporte d={d} />{d.estado === "rechazado" && <ReenviarDoc url={rutaReenvio(d)} numero={d.numero} />}</span></td>
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
                  <p className="text-sm min-w-0 break-words">{d.proveedor ?? d.cliente ?? <span className="text-muted">Consumidor final</span>}</p>
                  <p className={`num font-semibold whitespace-nowrap ${resta(d.tipo) ? "text-alerta" : ""}`}>{resta(d.tipo) ? "−" : ""}{pesos(d.total)}</p>
                </div>
                {(d.tipo === "soporte" || d.tipo === "ajuste_soporte" || d.tipo === "nota_debito") && <p className="text-sm text-muted break-words"><Origen d={d} /></p>}
                {d.motivo && <p className="text-xs text-muted break-words">Motivo: {d.motivo}</p>}
                {d.estado === "rechazado" && d.ultimo_error && <p className="text-sm text-alerta break-words">{d.ultimo_error}</p>}
                {d.estado === "anulado" && <p className="text-xs text-muted">La venta se anuló antes de salir a la DIAN.</p>}
                <div className="flex flex-wrap items-center gap-x-3 gap-y-2 pt-1 border-t border-line">
                  {d.venta_id && d.tipo !== "nota_debito" && <Link href={`/ventas/${d.venta_id}`} className="text-sm font-semibold text-cruz">Venta {d.venta}</Link>}
                  <Soporte d={d} />
                  {d.estado === "rechazado" && <ReenviarDoc url={rutaReenvio(d)} numero={d.numero} />}
                </div>
              </li>
            ))}
          </ul>

          <nav className="flex flex-wrap items-center justify-between gap-3 text-sm" aria-label="Páginas">
            <p className="text-muted">{totalFiltro.toLocaleString("es-CO")} documento{totalFiltro === 1 ? "" : "s"} · página {Math.min(f.pagina, paginas)} de {paginas}</p>
            <div className="flex gap-2">
              {f.pagina > 1 ? <a href={`/documentos?${qs(f, { pagina: f.pagina - 1 })}`} className="btn-borde h-10">← Anteriores</a> : null}
              {f.pagina < paginas ? <a href={`/documentos?${qs(f, { pagina: f.pagina + 1 })}`} className="btn-borde h-10">Siguientes →</a> : null}
            </div>
          </nav>
        </>
      )}
      <p className="text-sm text-muted max-w-3xl">El XML y el PDF de cada documento los genera el proveedor de facturación electrónica: cuando los entrega, aparecen aquí (en la emisión simulada el XML es de prueba y lo dice). Con el CUFE, CUDE o CUDS se consulta el documento en la DIAN. El documento soporte se genera desde la compra, para compras a proveedores no obligados a facturar.</p>
    </main>
  );
}
