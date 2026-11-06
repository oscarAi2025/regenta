import Link from "next/link";
import type { Tx } from "@/lib/db";
import { fechaReal } from "@/lib/validar";

const TIPO: Record<string, [string, string]> = {
  inicial: ["Inicial", "bg-paper text-ink"], compra: ["Compra", "bg-cruz-soft text-cruz"], venta: ["Venta", "bg-paper text-ink"],
  devolucion: ["Devolución", "bg-cruz-soft text-cruz"], anulacion: ["Anulación", "bg-cruz-soft text-cruz"], ajuste: ["Ajuste", "bg-aviso-soft text-aviso"],
};
const MAX = 400;
type Mov = { id: string; fecha: string; tipo: string; documento: string; lote: string; usuario: string | null; entrada: number; salida: number; saldo: number };

/** Kardex del producto (sección de la ficha): movimientos con saldo acumulado, por fechas y por lote, y CSV. */
export async function Kardex({ c, producto, filtros }: { c: Tx; producto: { id: string; unidades_por_caja: number }; filtros: { desde?: string; hasta?: string; lote?: string } }) {
  const hoy = (await c.query(`select current_date::text h, (current_date - 90)::text d`)).rows[0];
  const valida = (f?: string) => (f && /^\d{4}-\d{2}-\d{2}$/.test(f) && fechaReal(f) ? f : null);
  const desde = filtros.desde === "" ? null : valida(filtros.desde) ?? hoy.d, hasta = valida(filtros.hasta);
  const lotes = (await c.query(`select s.lote_id, s.lote, s.vence::text, s.unidades from v_stock_lotes s where s.producto_id = $1 order by s.vence nulls last, s.lote`, [producto.id])).rows;
  const lote = lotes.some((l) => l.lote_id === filtros.lote) ? filtros.lote! : null;
  const movs: Mov[] = (await c.query(`select id::text, to_char(fecha at time zone 'America/Bogota', 'DD/MM/YYYY HH24:MI') fecha, tipo, documento, lote, usuario, entrada, salida, saldo
    from kardex($1, $2::date, $3::date, $4::uuid)`, [producto.id, desde, hasta, lote])).rows;
  const actuales = lote ? lotes.find((l) => l.lote_id === lote)!.unidades : lotes.reduce((a, l) => a + l.unidades, 0);
  const saldoInicial = movs.length ? movs[0].saldo - movs[0].entrada + movs[0].salida
    : Number((await c.query(`select coalesce((select saldo from kardex($1, null, ($2::date - 1), $3::uuid) order by fecha desc, id desc limit 1), 0) s`, [producto.id, desde ?? "1900-01-02", lote])).rows[0].s);
  const entradas = movs.reduce((a, m) => a + m.entrada, 0), salidas = movs.reduce((a, m) => a + m.salida, 0);
  const saldoFinal = movs.length ? movs[movs.length - 1].saldo : saldoInicial;
  const hastaHoy = !hasta || hasta >= hoy.h;
  const qs = new URLSearchParams({ producto: producto.id, formato: "csv", ...(desde ? { desde } : {}), ...(hasta ? { hasta } : {}), ...(lote ? { lote } : {}) });
  const mostrados = movs.slice(-MAX);
  const n = (x: number) => x.toLocaleString("es-CO");
  return (
    <section id="kardex" aria-labelledby="kardex-t" className="grid gap-3 scroll-mt-4">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div><h2 id="kardex-t" className="titulo text-2xl">Kardex</h2><p className="text-sm text-muted">Cada entrada y salida del producto, con el saldo después de cada movimiento (en unidades).</p></div>
        <a href={`/api/inventario/kardex?${qs}`} className="btn-borde h-10 text-sm" download>Descargar CSV</a>
      </div>
      <form className="tarjeta p-3 sm:p-4 grid grid-cols-2 sm:grid-cols-[auto_auto_minmax(0,1fr)_auto] gap-3 items-end" action="#kardex">
        <div><label htmlFor="k-desde" className="etiqueta">Desde</label><input id="k-desde" name="desde" type="date" defaultValue={desde ?? ""} className="campo" /></div>
        <div><label htmlFor="k-hasta" className="etiqueta">Hasta</label><input id="k-hasta" name="hasta" type="date" defaultValue={hasta ?? ""} className="campo" /></div>
        <div className="col-span-2 sm:col-span-1"><label htmlFor="k-lote" className="etiqueta">Lote</label>
          <select id="k-lote" name="lote" defaultValue={lote ?? ""} className="campo"><option value="">Todos los lotes</option>
            {lotes.map((l) => <option key={l.lote_id} value={l.lote_id}>{l.lote} · {l.vence ?? "sin fecha"} · {n(l.unidades)} und</option>)}</select></div>
        <button className="btn-oscuro col-span-2 sm:col-span-1">Filtrar</button>
      </form>
      <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[["Saldo inicial", n(saldoInicial)], ["Entradas", `+${n(entradas)}`], ["Salidas", `−${n(salidas)}`], ["Saldo final", n(saldoFinal)]].map(([t, v]) => (
          <div key={t} className="tarjeta px-4 py-3"><dt className="text-sm text-muted">{t}</dt><dd className="num titulo text-2xl">{v} <span className="text-sm font-sans font-normal text-muted">und</span></dd></div>
        ))}
      </dl>
      {hastaHoy && (
        <p role="status" className={`text-sm font-semibold ${saldoFinal === actuales ? "text-cruz" : "text-alerta"}`}>
          {saldoFinal === actuales ? `El saldo cuadra con las existencias actuales${lote ? " del lote" : ""}: ${n(actuales)} und.` : `El saldo (${n(saldoFinal)}) no cuadra con las existencias (${n(actuales)}).`}
        </p>
      )}
      <div className="tarjeta overflow-x-auto">
        <table className="w-full text-sm min-w-[820px]">
          <thead className="text-left text-muted border-b border-line"><tr>
            <th className="px-3 py-2.5 font-semibold">Fecha</th><th className="px-3 py-2.5 font-semibold">Tipo</th><th className="px-3 py-2.5 font-semibold">Documento o motivo</th>
            <th className="px-3 py-2.5 font-semibold">Lote</th><th className="px-3 py-2.5 font-semibold">Usuario</th>
            <th className="px-3 py-2.5 font-semibold text-right">Entrada</th><th className="px-3 py-2.5 font-semibold text-right">Salida</th><th className="px-3 py-2.5 font-semibold text-right">Saldo</th>
          </tr></thead>
          <tbody className="divide-y divide-line">
            <tr className="bg-paper/60"><td className="px-3 py-2 text-muted" colSpan={7}>Saldo {desde ? `al empezar el ${desde.split("-").reverse().join("/")}` : "inicial"}</td><td className="px-3 py-2 num text-right font-semibold">{n(saldoInicial)}</td></tr>
            {mostrados.map((m) => (
              <tr key={m.id}>
                <td className="px-3 py-2 num whitespace-nowrap">{m.fecha}</td>
                <td className="px-3 py-2"><span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${TIPO[m.tipo]?.[1] ?? ""}`}>{TIPO[m.tipo]?.[0] ?? m.tipo}</span></td>
                <td className="px-3 py-2 max-w-[280px]">{m.tipo === "venta" || m.tipo === "devolucion" || m.tipo === "anulacion" ? <span className="num">{m.documento}</span> : m.documento}</td>
                <td className="px-3 py-2 num">{m.lote}</td>
                <td className="px-3 py-2">{String(m.usuario ?? "—").split(" (")[0]}</td>
                <td className="px-3 py-2 num text-right text-cruz">{m.entrada ? `+${n(m.entrada)}` : ""}</td>
                <td className="px-3 py-2 num text-right text-alerta">{m.salida ? `−${n(m.salida)}` : ""}</td>
                <td className="px-3 py-2 num text-right font-semibold">{n(m.saldo)}</td>
              </tr>
            ))}
            {movs.length === 0 && <tr><td colSpan={8} className="px-3 py-8 text-center text-muted">No hay movimientos en ese rango.</td></tr>}
          </tbody>
        </table>
      </div>
      {movs.length > MAX && <p className="text-sm text-muted">Se muestran los últimos {n(MAX)} de {n(movs.length)} movimientos del rango. Descarga el CSV para verlos todos o acorta las fechas. <Link href={`?desde=${hoy.h}#kardex`} className="underline">Ver solo hoy</Link></p>}
      {producto.unidades_por_caja > 1 && <p className="text-sm text-muted">Las cantidades van en unidades: una caja son {producto.unidades_por_caja} unidades.</p>}
    </section>
  );
}
