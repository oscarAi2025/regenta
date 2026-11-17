import { redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion, puede } from "@/lib/sesion";
import { Cabecera } from "@/components/ui/Cabecera";
import { hoyBogota, rango } from "@/lib/reportes";
import { TIPO_ASIENTO } from "@/lib/anexo13";
import { estadoPlazo, libroCompleto, moduloListo, sedes } from "@/lib/anexo13-datos";
import { AvisoPlazo, Pestanas } from "../Pestanas";

export const metadata = { title: "Libro completo de control especial" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fecha = (f: string) => new Date(f + "T12:00:00").toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" });
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const fechaHora = (f: string) => { const [d, h] = f.split(" "); const [a, m, dd] = d.split("-"); return `${Number(dd)} ${MESES[Number(m) - 1]} ${a} · ${h}`; };
const dma = (f: string | null) => (f ? f.split("-").reverse().join("/") : "—");

export default async function LibroCompleto({ searchParams }: { searchParams: Promise<{ desde?: string; hasta?: string; producto?: string; sede?: string }> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puede.verCostos(s.rol)) redirect("/inicio?aviso=permiso"); // datos de pacientes: dueño y administrador
  const sp = await searchParams;
  const r = rango(sp.desde, sp.hasta);
  const producto = sp.producto && UUID.test(sp.producto) ? sp.producto : null;
  const sede = sp.sede && UUID.test(sp.sede) ? sp.sede : null;
  const hoy = hoyBogota();
  const d = await comoUsuario(s, async (c) => (await moduloListo(c))
    ? { libro: await libroCompleto(c, s.empresa, sede, r.desde, r.hasta, producto), sedes: await sedes(c, s.empresa), plazo: await estadoPlazo(c, s.empresa, hoy) }
    : null);
  const filtro = `desde=${r.desde}&hasta=${r.hasta}${producto ? `&producto=${producto}` : ""}${sede ? `&sede=${sede}` : ""}`;
  const nombres = Object.fromEntries((d?.libro.productos ?? []).map((p) => [p.id, p.nombre]));

  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo="Libro completo de control especial" sub={r.desde === r.hasta ? fecha(r.desde) : `${fecha(r.desde)} – ${fecha(r.hasta)}`}>
        {d && <a href={`/api/control-especial/libro?${filtro}&formato=excel`} className="btn-borde" download>Descargar en Excel</a>}
      </Cabecera>
      <Pestanas actual="/control-especial/libro-completo" />
      {!d ? (
        <section className="tarjeta p-6"><h2 className="titulo text-xl">Se está activando</h2><p className="mt-1 text-muted">El libro completo estará disponible en unos minutos.</p></section>
      ) : (
        <>
          <AvisoPlazo plazo={d.plazo} />
          <form className="tarjeta p-4 grid gap-3 sm:flex sm:flex-wrap sm:items-end" aria-label="Filtros del libro completo">
            <label className="grid text-sm text-muted">Desde<input type="date" name="desde" defaultValue={r.desde} max={hoy} className="campo sm:w-auto" /></label>
            <label className="grid text-sm text-muted">Hasta<input type="date" name="hasta" defaultValue={r.hasta} max={hoy} className="campo sm:w-auto" /></label>
            <label className="grid text-sm text-muted sm:min-w-64 sm:flex-1">Medicamento
              <select name="producto" defaultValue={d.libro.elegido ?? ""} className="campo">
                <option value="">Todos los de control especial</option>
                {d.libro.productos.map((p) => <option key={p.id} value={p.id}>{p.nombre}{p.control_especial ? "" : " (ya no marcado)"}</option>)}
              </select>
            </label>
            {d.sedes.length > 1 && (
              <label className="grid text-sm text-muted">Sede
                <select name="sede" defaultValue={sede ?? ""} className="campo"><option value="">Todas</option>{d.sedes.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select>
              </label>
            )}
            <button className="btn-oscuro">Ver</button>
          </form>

          <section className="tarjeta p-5" aria-labelledby="asientos-titulo">
            <div className="flex flex-wrap justify-between items-baseline gap-2">
              <h2 id="asientos-titulo" className="titulo text-xl">Entradas, salidas y saldo</h2>
              <p className="text-sm text-muted">{d.libro.asientos.length} asiento{d.libro.asientos.length === 1 ? "" : "s"} · en unidades · no se editan ni se borran</p>
            </div>
            <p className="text-sm text-muted mt-1 max-w-3xl">Cada movimiento de inventario de los medicamentos de control especial, con el saldo que deja. Las entradas se registran en
              {" "}<a href="/compras" className="underline font-semibold text-ink">Compras</a>; las bajas, devoluciones y correcciones con un ajuste en
              {" "}<a href="/inventario" className="underline font-semibold text-ink">Inventario</a>. Un error se corrige con un asiento nuevo, nunca tachando.</p>
            {d.libro.asientos.length === 0 ? <p className="mt-3 text-muted">No hay movimientos de control especial en este periodo.</p> : (
              <>
                <div className="mt-3 hidden lg:block overflow-x-auto">
                  <table className="w-full text-sm">
                    <thead><tr className="text-left text-muted border-b border-line">
                      <th className="py-2 pr-3 font-medium">Fecha</th><th className="py-2 px-2 font-medium">Medicamento y lote</th><th className="py-2 px-2 font-medium">Movimiento</th>
                      <th className="py-2 px-2 text-right font-medium">Entrada</th><th className="py-2 px-2 text-right font-medium">Salida</th><th className="py-2 px-2 text-right font-medium">Saldo</th>
                      <th className="py-2 px-2 font-medium">Soporte</th><th className="py-2 pl-2 font-medium">Registró</th>
                    </tr></thead>
                    <tbody className="divide-y divide-line align-top">{d.libro.asientos.map((a) => (
                      <tr key={a.id}>
                        <td className="py-2.5 pr-3 whitespace-nowrap num">{fechaHora(a.fecha)}</td>
                        <td className="py-2.5 px-2"><p className="font-semibold leading-snug">{nombres[a.producto_id]}</p><p className="text-muted num">Lote {a.lote ?? "—"}{a.vence ? ` · vence ${dma(a.vence)}` : ""}</p></td>
                        <td className="py-2.5 px-2">{TIPO_ASIENTO[a.asiento]}</td>
                        <td className="py-2.5 px-2 text-right num font-semibold text-cruz">{a.entrada || ""}</td>
                        <td className="py-2.5 px-2 text-right num font-semibold">{a.salida || ""}</td>
                        <td className="py-2.5 px-2 text-right num font-semibold">{a.saldo}</td>
                        <td className="py-2.5 px-2 text-[13px]"><p>{a.soporte ?? "—"}</p>
                          {a.formula_numero && <p className="text-muted">Recetario N.º {a.formula_numero} · {a.medico}</p>}
                          {a.paciente && <p className="text-muted">{a.paciente}</p>}</td>
                        <td className="py-2.5 pl-2">{a.usuario || "—"}</td>
                      </tr>
                    ))}</tbody>
                  </table>
                </div>
                <ul className="mt-3 lg:hidden grid gap-2">{d.libro.asientos.map((a) => (
                  <li key={a.id} className="rounded-xl border border-line p-3">
                    <div className="flex justify-between gap-3">
                      <p className="font-semibold leading-snug min-w-0">{nombres[a.producto_id]}</p>
                      <p className="num shrink-0 text-right"><span className={`font-semibold ${a.entrada ? "text-cruz" : ""}`}>{a.entrada ? `+${a.entrada}` : `−${a.salida}`}</span>
                        <span className="block text-[12px] text-muted">saldo {a.saldo}</span></p>
                    </div>
                    <p className="text-sm text-muted num">{fechaHora(a.fecha)} · {TIPO_ASIENTO[a.asiento]} · Lote {a.lote ?? "—"}</p>
                    {a.soporte && <p className="text-sm mt-1 [overflow-wrap:anywhere]">{a.soporte}</p>}
                    {a.formula_numero && <p className="text-sm text-muted [overflow-wrap:anywhere]">Recetario N.º {a.formula_numero} · {a.medico}</p>}
                    {a.paciente && <p className="text-sm text-muted [overflow-wrap:anywhere]">{a.paciente}</p>}
                  </li>
                ))}</ul>
              </>
            )}
          </section>
        </>
      )}
    </main>
  );
}
