"use client";
import { useState } from "react";
import { MEDIOS_PAGO, leerNumero, nombreMedio, pesosExactos } from "@/lib/compras";
import { AYUDA_CATEGORIA, CATEGORIAS, nombreCategoria, type FilaGasto } from "@/lib/gastos";

const fecha = (d: string) => d.split("-").reverse().join("/");

/** Registrar, listar y anular gastos. Tras guardar, la API devuelve la lista ya filtrada y la pantalla la aplica (sin
 *  depender de recargar). `qs` = filtros de la dirección; `filtros` = formulario de filtros (servidor). */
export function Gastos({ inicial, qs, hoy, puesto, filtros, filtrado }: {
  inicial: FilaGasto[]; qs: string; hoy: string; puesto: { caja: string; turno: boolean } | null; filtros: React.ReactNode; filtrado: boolean;
}) {
  const [filas, setFilas] = useState(inicial);
  const [f, setF] = useState({ fecha: hoy, categoria: "", descripcion: "", medio: "efectivo", valor: "", referencia: "", fueraCaja: false });
  const [idem, setIdem] = useState(() => crypto.randomUUID());
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [anulando, setAnulando] = useState<string | null>(null);
  const [motivo, setMotivo] = useState("");
  const [errorAnular, setErrorAnular] = useState("");
  const desdeCaja = f.medio === "efectivo" && !f.fueraCaja;
  const api = `/api/gastos${qs ? "?" + qs : ""}`;

  async function registrar(e: React.FormEvent) {
    e.preventDefault(); setError(""); setAviso("");
    const valor = leerNumero(f.valor);
    if (!f.categoria) { setError("Elige la categoría del gasto."); return; }
    if (f.descripcion.trim().length < 3) { setError("Escribe en qué se gastó."); return; }
    if (!valor) { setError("Escribe el valor del gasto."); return; }
    setOcupado(true);
    try {
      const r = await fetch(api, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        fecha: desdeCaja ? hoy : f.fecha, categoria: f.categoria, descripcion: f.descripcion, medio: f.medio, valor, referencia: f.referencia || null, desde_caja: desdeCaja, idem_key: idem }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setError(j.error ?? "No se pudo registrar el gasto"); return; }
      setFilas(j.gastos ?? filas);
      setAviso(`Gasto G-${j.numero} de ${pesosExactos(valor)} registrado${j.egreso_caja ? ` (salió de ${puesto?.caja ?? "la caja"} como egreso del turno)` : ""}.`);
      setF({ ...f, descripcion: "", valor: "", referencia: "" });
      setIdem(crypto.randomUUID());
    } catch { setError("Sin conexión: revisa internet y vuelve a intentar (no se duplicará)."); } finally { setOcupado(false); }
  }

  async function anular(e: React.FormEvent, g: FilaGasto) {
    e.preventDefault(); setErrorAnular(""); setAviso("");
    if (motivo.trim().length < 4) { setErrorAnular("Escribe el motivo de la anulación."); return; }
    setOcupado(true);
    try {
      const r = await fetch(api, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: g.id, motivo }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setErrorAnular(j.error ?? "No se pudo anular el gasto"); return; }
      setFilas(j.gastos ?? filas); setAnulando(null); setMotivo("");
      setAviso(`Gasto G-${g.numero} anulado${j.ingreso_caja ? ": el efectivo volvió a la caja como entrada del turno abierto" : ""}.`);
    } catch { setErrorAnular("Sin conexión: revisa internet y vuelve a intentar."); } finally { setOcupado(false); }
  }

  const vigentes = filas.filter((g) => !g.anulado);
  const total = vigentes.reduce((a, g) => a + g.valor, 0);
  return (
    <>
      <form onSubmit={registrar} className="tarjeta p-4 sm:p-5 grid gap-3 sm:grid-cols-2 lg:grid-cols-[150px_minmax(0,1fr)_minmax(0,2fr)_150px] lg:items-start" aria-label="Registrar un gasto">
        <h2 className="titulo text-xl sm:col-span-2 lg:col-span-4">Registrar un gasto</h2>
        <div><label htmlFor="g-fecha" className="etiqueta">Fecha</label>
          <input id="g-fecha" type="date" max={hoy} value={desdeCaja ? hoy : f.fecha} disabled={desdeCaja} onChange={(e) => setF({ ...f, fecha: e.target.value })} className="campo disabled:opacity-70" /></div>
        <div><label htmlFor="g-categoria" className="etiqueta">Categoría</label>
          <select id="g-categoria" value={f.categoria} onChange={(e) => setF({ ...f, categoria: e.target.value })} className="campo" aria-describedby={AYUDA_CATEGORIA[f.categoria] ? "g-ayuda" : undefined}>
            <option value="">Elige…</option>{CATEGORIAS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
          {AYUDA_CATEGORIA[f.categoria] && <p id="g-ayuda" className="text-[13px] text-muted mt-1">{AYUDA_CATEGORIA[f.categoria]}</p>}</div>
        <div><label htmlFor="g-descripcion" className="etiqueta">Descripción</label>
          <input id="g-descripcion" value={f.descripcion} maxLength={200} onChange={(e) => setF({ ...f, descripcion: e.target.value })} className="campo" placeholder="Arriendo de noviembre, recibo de la luz…" /></div>
        <div><label htmlFor="g-valor" className="etiqueta">Valor</label>
          <input id="g-valor" inputMode="decimal" value={f.valor} onChange={(e) => setF({ ...f, valor: e.target.value.replace(/[^\d.,]/g, "") })} className="campo num" placeholder="0" /></div>
        <div><label htmlFor="g-medio" className="etiqueta">Medio de pago</label>
          <select id="g-medio" value={f.medio} onChange={(e) => setF({ ...f, medio: e.target.value })} className="campo">{MEDIOS_PAGO.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></div>
        <div className="sm:col-span-2 lg:col-span-3"><label htmlFor="g-referencia" className="etiqueta">Referencia (opcional)</label>
          <input id="g-referencia" value={f.referencia} maxLength={60} onChange={(e) => setF({ ...f, referencia: e.target.value })} className="campo" placeholder="N.º de recibo o factura" /></div>
        {f.medio === "efectivo" && (
          <div className="sm:col-span-2 lg:col-span-3 grid gap-1 text-sm">
            <label className="flex items-center gap-2"><input type="checkbox" checked={f.fueraCaja} onChange={(e) => setF({ ...f, fueraCaja: e.target.checked })} className="w-4 h-4" />No sale de la caja</label>
            {desdeCaja && <p className={puesto?.turno ? "text-muted" : "text-aviso font-semibold"}>
              {puesto ? (puesto.turno ? `Sale de ${puesto.caja} como egreso del turno abierto, con la fecha de hoy.` : `${puesto.caja} no tiene turno abierto: ábrelo en Turno o marca «No sale de la caja».`) : "Esta droguería no tiene cajas activas: marca «No sale de la caja»."}</p>}
          </div>
        )}
        <div className="sm:col-span-2 lg:col-span-1 lg:col-start-4"><button disabled={ocupado} className="btn-primario w-full">{ocupado ? "Guardando…" : "Registrar gasto"}</button></div>
        {error && <p role="alert" className="sm:col-span-2 lg:col-span-4 text-alerta font-semibold">{error}</p>}
      </form>
      {aviso && <p role="status" className="rounded-xl bg-cruz-soft text-cruz font-semibold px-4 py-3">{aviso}</p>}
      {filtros}
      <section className="tarjeta" aria-label="Gastos registrados">
        <div className="flex flex-wrap justify-between items-baseline gap-2 px-4 pt-4">
          <h2 className="titulo text-xl">Gastos registrados</h2>
          <p className="text-sm text-muted num">{vigentes.length} vigente{vigentes.length === 1 ? "" : "s"} · <b className="text-ink" data-total-gastos>{pesosExactos(total)}</b></p>
        </div>
        <div className="relative overflow-x-auto mt-2">
          <table className="w-full text-[15px] min-w-[860px]" aria-label="Gastos">
            <thead className="text-left text-sm text-muted border-b border-line"><tr>
              <th className="px-4 py-2.5 font-semibold">Gasto</th><th className="px-4 py-2.5 font-semibold">Categoría</th><th className="px-4 py-2.5 font-semibold">Descripción</th>
              <th className="px-4 py-2.5 font-semibold">Medio</th><th className="px-4 py-2.5 font-semibold text-right">Valor</th><th className="px-4 py-2.5 font-semibold"><span className="sr-only">Acciones</span></th>
            </tr></thead>
            <tbody className="divide-y divide-line">
              {filas.map((g) => (
                <tr key={g.id} className={`align-top ${g.anulado ? "text-muted" : ""}`}>
                  <td className="px-4 py-3"><b className="num">G-{g.numero}</b><span className="block text-sm text-muted num">{fecha(g.fecha)}</span></td>
                  <td className="px-4 py-3">{nombreCategoria(g.categoria)}</td>
                  <td className="px-4 py-3 break-words max-w-[340px]">{g.descripcion}{g.referencia && <span className="block text-sm text-muted">Ref. {g.referencia}</span>}
                    <span className="block text-[13px] text-muted">{String(g.usuario ?? "").split(" (")[0]} · {g.creado}</span>
                    {g.anulado && <span className="block text-sm text-alerta">Anulado{g.anula ? ` por ${String(g.anula).split(" (")[0]}` : ""}: {g.motivo}</span>}</td>
                  <td className="px-4 py-3">{nombreMedio(g.medio)}{g.caja && <span className="block text-sm text-muted">Salió de {g.caja}</span>}</td>
                  <td className={`px-4 py-3 text-right num font-semibold ${g.anulado ? "line-through" : ""}`}>{pesosExactos(g.valor)}</td>
                  <td className="px-4 py-3 text-right">
                    {!g.anulado && anulando !== g.id && <button type="button" onClick={() => { setAnulando(g.id); setMotivo(""); setErrorAnular(""); }} className="text-sm font-semibold text-alerta hover:underline">Anular</button>}
                    {g.anulado && <span className="rounded-md px-2 py-0.5 text-sm font-semibold bg-alerta-soft text-alerta">Anulado</span>}
                    {anulando === g.id && (
                      <form onSubmit={(e) => anular(e, g)} className="grid gap-2 min-w-[220px] text-left" aria-label={`Anular el gasto G-${g.numero}`}>
                        <label htmlFor={`motivo-${g.id}`} className="etiqueta mb-0">Motivo de la anulación</label>
                        <input id={`motivo-${g.id}`} value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} className="campo" autoFocus />
                        <div className="flex gap-2"><button disabled={ocupado} className="btn-primario">Anular gasto</button><button type="button" onClick={() => setAnulando(null)} className="btn-borde">Cancelar</button></div>
                        {errorAnular && <p role="alert" className="text-alerta text-sm font-semibold">{errorAnular}</p>}
                      </form>
                    )}
                  </td>
                </tr>
              ))}
              {filas.length === 0 && <tr><td colSpan={6} className="px-4 py-12 text-center text-muted">{filtrado ? "No hay gastos con ese filtro." : "Todavía no hay gastos. Registra el primero arriba."}</td></tr>}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
