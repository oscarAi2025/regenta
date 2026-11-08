import Link from "next/link";
import { redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion, puede } from "@/lib/sesion";
import { Cabecera } from "@/components/ui/Cabecera";
import { rango } from "@/lib/reportes";
import { datosLibro, TIPO_LIBRO } from "@/lib/libro-control";
import { Ajustes } from "./Ajustes";

export const metadata = { title: "Libro de control especial" };

const fecha = (f: string) => new Date(f + "T12:00:00").toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" });
// Las fechas del libro ya vienen en hora de Bogotá («AAAA-MM-DD HH:MI»): se muestran tal cual, sin pasar por la zona del servidor.
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const fechaHora = (f: string) => { const [d, h] = f.split(" "); const [a, m, dd] = d.split("-"); return `${Number(dd)} ${MESES[Number(m) - 1]} ${a} · ${h}`; };
const dma = (f: string | null) => (f ? f.split("-").reverse().join("/") : "—");
const und = (n: number) => `${n.toLocaleString("es-CO")} und`;

export default async function ControlEspecial({ searchParams }: { searchParams: Promise<{ desde?: string; hasta?: string; producto?: string }> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puede.verCostos(s.rol)) redirect("/inicio?aviso=permiso"); // datos de pacientes: dueño y administrador
  const sp = await searchParams;
  const r = rango(sp.desde, sp.hasta);
  const producto = sp.producto && /^[0-9a-f-]{36}$/i.test(sp.producto) ? sp.producto : null;
  const { d, cfg } = await comoUsuario(s, async (c) => ({
    d: await datosLibro(c, s.empresa, r, producto),
    cfg: (await c.query(`select formula_vigencia_dias, formula_exige_datos, demo from empresas where id = $1`, [s.empresa])).rows[0],
  }));
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
  const menos = (n: number) => new Date(new Date(hoy + "T12:00:00Z").getTime() - n * 86400000).toISOString().slice(0, 10);
  const mesPasadoFin = menos(Number(hoy.slice(8, 10)));
  const prod = d.elegido ? `&producto=${d.elegido}` : "";
  const atajos: [string, string, string][] = [["Hoy", hoy, hoy], ["7 días", menos(6), hoy], ["Este mes", hoy.slice(0, 8) + "01", hoy], ["Mes pasado", mesPasadoFin.slice(0, 8) + "01", mesPasadoFin]];
  const q = `desde=${r.desde}&hasta=${r.hasta}${prod}`;
  const nombreElegido = d.productos.find((p) => p.id === d.elegido)?.nombre;
  const sinRegistro = d.saldos.filter((x) => x.sin_registro > 0);

  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo="Libro de control especial" sub={<>{r.desde === r.hasta ? fecha(r.desde) : `${fecha(r.desde)} – ${fecha(r.hasta)}`}{nombreElegido ? ` · ${nombreElegido}` : ""}</>}>
        <a href={`/api/control-especial?${q}&formato=csv`} className="btn-borde">Exportar a Excel (CSV)</a>
        <a href={`/control-especial/informe?${q}`} target="_blank" rel="noopener" className="btn-oscuro">Informe para imprimir</a>
      </Cabecera>

      <form className="tarjeta p-4 grid gap-3 sm:flex sm:flex-wrap sm:items-end" aria-label="Filtros del libro">
        <label className="grid text-sm text-muted">Desde<input type="date" name="desde" defaultValue={r.desde} max={hoy} className="campo sm:w-auto" /></label>
        <label className="grid text-sm text-muted">Hasta<input type="date" name="hasta" defaultValue={r.hasta} max={hoy} className="campo sm:w-auto" /></label>
        <label className="grid text-sm text-muted sm:min-w-64 sm:flex-1">Producto
          <select name="producto" defaultValue={d.elegido ?? ""} className="campo">
            <option value="">Todos los de control especial</option>
            {d.productos.map((p) => <option key={p.id} value={p.id}>{p.nombre}{p.control_especial ? "" : " (ya no marcado)"}</option>)}
          </select>
        </label>
        <button className="btn-oscuro">Ver</button>
      </form>
      <nav className="flex flex-wrap gap-2" aria-label="Rangos rápidos">
        {atajos.map(([t, a, b]) => <Link key={t} href={`/control-especial?desde=${a}&hasta=${b}${prod}`} aria-current={a === r.desde && b === r.hasta ? "true" : undefined}
          className={`pastilla border ${a === r.desde && b === r.hasta ? "bg-ink text-white border-ink" : "bg-surface border-line hover:border-ink"}`}>{t}</Link>)}
      </nav>

      {d.productos.length === 0 ? (
        <section className="tarjeta p-6">
          <h2 className="titulo text-xl">Aún no tienes productos de control especial</h2>
          <p className="mt-1 text-muted max-w-2xl">Márcalos en <Link href="/productos" className="underline font-semibold text-ink">Productos</Link> → Editar → «Medicamento de control especial» (o con la columna «control especial» al cargar desde Excel). Desde ese momento la caja pide paciente, médico y fórmula, y cada venta queda aquí con su lote.</p>
        </section>
      ) : (
        <>
          <section className="tarjeta p-5" aria-labelledby="saldos-titulo">
            <div className="flex flex-wrap justify-between items-baseline gap-2">
              <h2 id="saldos-titulo" className="titulo text-xl">Saldo por producto</h2>
              <a href={`/api/control-especial?${q}&formato=csv&tipo=saldos`} className="text-sm font-semibold text-cruz underline underline-offset-4">Exportar saldos</a>
            </div>
            <p className="text-sm text-muted mt-1">En unidades. Saldo inicial + entradas − salidas = saldo final: compáralo con el conteo físico.</p>
            {sinRegistro.length > 0 && (
              <p role="status" className="mt-3 rounded-xl bg-aviso-soft text-aviso px-4 py-3 text-sm font-semibold">
                {sinRegistro.map((x) => `${x.nombre}: ${und(x.sin_registro)}`).join(" · ")} vendidas en el periodo sin registro en el libro (antes de marcarlo como control especial).
              </p>
            )}
            <div className="mt-3 hidden md:block overflow-x-auto">
              <table className="w-full text-sm num">
                <thead><tr className="text-left text-muted border-b border-line">
                  <th className="py-2 pr-3 font-medium">Producto</th><th className="py-2 px-2 text-right font-medium">Saldo inicial</th><th className="py-2 px-2 text-right font-medium">Entradas</th>
                  <th className="py-2 px-2 text-right font-medium">Salidas</th><th className="py-2 px-2 text-right font-medium">Saldo final</th>
                  <th className="py-2 px-2 text-right font-medium">Dispensado</th><th className="py-2 pl-2 text-right font-medium">Reintegrado</th>
                </tr></thead>
                <tbody className="divide-y divide-line">{d.saldos.map((x) => (
                  <tr key={x.id}>
                    <td className="py-2.5 pr-3 font-sans"><Link href={`/control-especial?desde=${r.desde}&hasta=${r.hasta}&producto=${x.id}`} className="font-semibold hover:underline">{x.nombre}</Link></td>
                    <td className="py-2.5 px-2 text-right">{x.inicial}</td><td className="py-2.5 px-2 text-right">{x.entradas}</td><td className="py-2.5 px-2 text-right">{x.salidas}</td>
                    <td className="py-2.5 px-2 text-right font-semibold">{x.final}</td><td className="py-2.5 px-2 text-right">{x.dispensado}</td><td className="py-2.5 pl-2 text-right">{x.reintegrado}</td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
            <ul className="mt-3 md:hidden grid gap-2">{d.saldos.map((x) => (
              <li key={x.id} className="rounded-xl border border-line p-3">
                <Link href={`/control-especial?desde=${r.desde}&hasta=${r.hasta}&producto=${x.id}`} className="block font-semibold leading-snug">{x.nombre}</Link>
                <dl className="mt-2 grid grid-cols-3 gap-x-2 gap-y-1 text-sm num">
                  <div><dt className="text-muted text-[12px]">Inicial</dt><dd>{x.inicial}</dd></div>
                  <div><dt className="text-muted text-[12px]">Entradas</dt><dd>{x.entradas}</dd></div>
                  <div><dt className="text-muted text-[12px]">Salidas</dt><dd>{x.salidas}</dd></div>
                  <div><dt className="text-muted text-[12px]">Saldo final</dt><dd className="font-semibold">{x.final}</dd></div>
                  <div><dt className="text-muted text-[12px]">Dispensado</dt><dd>{x.dispensado}</dd></div>
                  <div><dt className="text-muted text-[12px]">Reintegrado</dt><dd>{x.reintegrado}</dd></div>
                </dl>
              </li>
            ))}</ul>
          </section>

          <section className="tarjeta p-5" aria-labelledby="libro-titulo">
            <div className="flex flex-wrap justify-between items-baseline gap-2">
              <h2 id="libro-titulo" className="titulo text-xl">Dispensaciones y reintegros</h2>
              <p className="text-sm text-muted">{d.filas.length} registro{d.filas.length === 1 ? "" : "s"} · no se editan ni se borran</p>
            </div>
            {d.filas.length === 0 ? <p className="mt-2 text-muted">No hay dispensaciones de control especial en este periodo.</p> : (
              <>
                <div className="mt-3 hidden lg:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-muted border-b border-line">
                      <th className="py-2 pr-3 font-medium">Fecha</th><th className="py-2 px-2 font-medium">Producto y lote</th><th className="py-2 px-2 text-right font-medium">Cantidad</th>
                      <th className="py-2 px-2 font-medium">Paciente</th><th className="py-2 px-2 font-medium">Médico</th><th className="py-2 px-2 font-medium">Fórmula</th>
                      <th className="py-2 px-2 font-medium">Venta</th><th className="py-2 pl-2 font-medium">Usuario</th>
                    </tr></thead>
                    <tbody className="divide-y divide-line align-top">{d.filas.map((f) => (
                      <tr key={f.id} className={f.tipo === "reintegro" ? "bg-cruz-soft/40" : undefined}>
                        <td className="py-2.5 pr-3 whitespace-nowrap num">{fechaHora(f.fecha)}</td>
                        <td className="py-2.5 px-2"><p className="font-semibold leading-snug">{f.producto}</p><p className="text-muted num">Lote {f.lote ?? "—"}{f.vence ? ` · vence ${dma(f.vence)}` : ""}</p></td>
                        <td className="py-2.5 px-2 text-right whitespace-nowrap num">
                          {f.tipo === "reintegro" ? <span className="font-semibold text-cruz">+{f.reintegro}</span> : <span className="font-semibold">−{f.salida}</span>}
                          <span className="block text-[12px] text-muted">{TIPO_LIBRO[f.tipo]}</span>
                        </td>
                        <td className="py-2.5 px-2"><p>{f.paciente_nombre}</p><p className="text-muted num">{f.paciente_tipo_doc} {f.paciente_doc}</p></td>
                        <td className="py-2.5 px-2"><p>{f.medico_nombre}</p><p className="text-muted">Reg. {f.medico_registro}</p></td>
                        <td className="py-2.5 px-2 num whitespace-nowrap"><p>N.º {f.formula_numero}</p><p className="text-muted">{dma(f.formula_fecha)}</p></td>
                        <td className="py-2.5 px-2 num"><Link href={`/ventas/${f.venta_id}`} className="font-semibold text-cruz hover:underline">{f.venta}</Link>{f.motivo && <p className="text-muted font-sans text-[13px] max-w-48">{f.motivo}</p>}</td>
                        <td className="py-2.5 pl-2">{f.usuario || "—"}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
                <ul className="mt-3 lg:hidden grid gap-2">{d.filas.map((f) => (
                  <li key={f.id} className={`rounded-xl border p-3 ${f.tipo === "reintegro" ? "border-cruz/30 bg-cruz-soft/40" : "border-line"}`}>
                    <div className="flex justify-between gap-3">
                      <p className="font-semibold leading-snug min-w-0">{f.producto}</p>
                      <p className="num shrink-0 text-right">{f.tipo === "reintegro" ? <span className="font-semibold text-cruz">+{f.reintegro}</span> : <span className="font-semibold">−{f.salida}</span>}<span className="block text-[12px] text-muted">{TIPO_LIBRO[f.tipo]}</span></p>
                    </div>
                    <p className="text-sm text-muted num">{fechaHora(f.fecha)} · Lote {f.lote ?? "—"} · <Link href={`/ventas/${f.venta_id}`} className="font-semibold text-cruz">{f.venta}</Link></p>
                    <dl className="mt-2 grid gap-1 text-sm">
                      <div className="flex flex-wrap gap-x-2"><dt className="text-muted">Paciente</dt><dd>{f.paciente_nombre} · {f.paciente_tipo_doc} {f.paciente_doc}</dd></div>
                      <div className="flex flex-wrap gap-x-2"><dt className="text-muted">Médico</dt><dd>{f.medico_nombre} · Reg. {f.medico_registro}</dd></div>
                      <div className="flex flex-wrap gap-x-2"><dt className="text-muted">Fórmula</dt><dd className="num">N.º {f.formula_numero} del {dma(f.formula_fecha)}</dd></div>
                      <div className="flex flex-wrap gap-x-2"><dt className="text-muted">Usuario</dt><dd>{f.usuario || "—"}</dd></div>
                      {f.motivo && <div className="flex flex-wrap gap-x-2"><dt className="text-muted">Observación</dt><dd>{f.motivo}</dd></div>}
                    </dl>
                  </li>
                ))}</ul>
              </>
            )}
          </section>
        </>
      )}

      <Ajustes vigencia={Number(cfg?.formula_vigencia_dias ?? 30)} exige={!!cfg?.formula_exige_datos} />
      {cfg?.demo && <p className="text-sm text-muted -mt-2">En la demostración los ajustes se ven pero no se guardan.</p>}
    </main>
  );
}
