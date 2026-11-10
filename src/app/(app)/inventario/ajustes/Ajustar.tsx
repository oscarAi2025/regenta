"use client";
import { useEffect, useRef, useState } from "react";
import { useRefrescar } from "@/lib/refrescar";
import Link from "next/link";
import { MOTIVOS, llevaActa, nombreMotivo, unidadesTexto, type Motivo } from "@/lib/ajustes";

type Prod = { id: string; nombre: string; laboratorio: string | null; unidades_por_caja: number; exacto?: boolean };
type Lote = { lote_id: string; lote: string; vence: string | null; unidades: number; bloqueado: boolean; vencido: boolean; costo: number | null };
type Linea = { key: number; p: Prod; lotes: Lote[]; lote_id: string; cajas: string; sueltas: string; suma: boolean };
type Hecho = { id: string; numero: number; acta: boolean; motivo: string; unidades: number };

const n = (s: string) => Number(String(s).replace(/\D/g, "")) || 0;
const fecha = (d: string | null) => (d ? new Date(d + "T00:00:00").toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" }) : "sin fecha");
const pesos = (v: number) => "$" + Math.round(v).toLocaleString("es-CO");

export function Ajustar({ verCosto }: { verCosto: boolean }) {
  const refrescar = useRefrescar();
  const [motivo, setMotivo] = useState<Motivo | "">("");
  const [detalle, setDetalle] = useState("");
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Prod[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [hecho, setHecho] = useState<Hecho | null>(null);
  const buscar = useRef<HTMLInputElement>(null);
  const clave = useRef(0);
  const idem = useRef(crypto.randomUUID());
  const sumaPermitida = motivo === "conteo";
  // Una clave por contenido: si tras una falla de red cambian las líneas o el motivo, el reintento es un ajuste nuevo
  // (con la misma clave el servidor devolvería el anterior e ignoraría los cambios).
  useEffect(() => { idem.current = crypto.randomUUID(); }, [lineas, motivo, detalle]);

  useEffect(() => {
    if (q.trim().length < 2) { setRes([]); return; }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      setBuscando(true);
      fetch(`/api/productos?q=${encodeURIComponent(q)}`, { signal: ctl.signal }).then((r) => r.json()).then((j) => {
        const ps: Prod[] = j.productos ?? [];
        if (ps[0]?.exacto) { agregar(ps[0]); return; } // lector de código de barras: entra directo
        setRes(ps.slice(0, 8));
      }).catch(() => {}).finally(() => setBuscando(false));
    }, 160);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  // Al cambiar a una baja, las líneas que sumaban pasan a restar (una baja nunca suma).
  useEffect(() => { if (!sumaPermitida) setLineas((ls) => ls.map((l) => (l.suma ? { ...l, suma: false } : l))); }, [sumaPermitida]);

  async function agregar(p: Prod) {
    setQ(""); setRes([]); setHecho(null); setError("");
    const r = await fetch(`/api/inventario/lotes?producto=${p.id}`).catch(() => null);
    const j = await r?.json().catch(() => ({}));
    if (!r?.ok) { setError(j?.error ?? "No se pudieron traer los lotes. Revisa la conexión."); return; }
    const lotes: Lote[] = j.lotes ?? [];
    if (!lotes.length) { setError(`${p.nombre} no tiene lotes registrados: primero recibe la mercancía.`); return; }
    const preferido = (motivo === "vencido" ? lotes.find((l) => l.vencido && l.unidades > 0) : null) ?? lotes.find((l) => l.unidades > 0) ?? lotes[0];
    const key = ++clave.current;
    setLineas((ls) => [...ls, { key, p, lotes, lote_id: preferido.lote_id, cajas: "", sueltas: "", suma: false }]);
    setTimeout(() => document.getElementById(`${p.unidades_por_caja > 1 ? "cajas" : "sueltas"}-${key}`)?.focus(), 0);
  }

  async function agregarVencidos() {
    setError(""); setHecho(null);
    const r = await fetch("/api/inventario/lotes?vencidos=1").catch(() => null);
    const j = await r?.json().catch(() => ({}));
    if (!r?.ok) { setError(j?.error ?? "No se pudieron traer los lotes vencidos."); return; }
    const vencidos: (Lote & { producto_id: string; nombre: string; laboratorio: string | null; unidades_por_caja: number })[] = j.lotes ?? [];
    const ya = new Set(lineas.map((l) => l.lote_id));
    const nuevos = vencidos.filter((l) => !ya.has(l.lote_id));
    if (!nuevos.length) { setError(vencidos.length ? "Los lotes vencidos ya están en la lista." : "No hay lotes vencidos con existencias. ¡Bien!"); return; }
    setLineas((ls) => [...ls, ...nuevos.map((l) => {
      const upc = l.unidades_por_caja;
      return { key: ++clave.current, p: { id: l.producto_id, nombre: l.nombre, laboratorio: l.laboratorio, unidades_por_caja: upc }, lotes: [l], lote_id: l.lote_id,
        cajas: upc > 1 ? String(Math.floor(l.unidades / upc) || "") : "", sueltas: String(upc > 1 ? l.unidades % upc || "" : l.unidades), suma: false };
    })]);
  }

  const cambiar = (key: number, cambio: Partial<Linea>) => setLineas((ls) => ls.map((l) => (l.key === key ? { ...l, ...cambio } : l)));
  const cantidad = (l: Linea) => n(l.cajas) * l.p.unidades_por_caja + n(l.sueltas);
  const firmado = (l: Linea) => (l.suma ? 1 : -1) * cantidad(l);
  const loteDe = (l: Linea) => l.lotes.find((x) => x.lote_id === l.lote_id);
  const neto = lineas.reduce((a, l) => a + firmado(l), 0);
  const valor = verCosto ? lineas.reduce((a, l) => a + firmado(l) * (loteDe(l)?.costo ?? 0), 0) : null;
  const faltaCosto = verCosto && lineas.some((l) => loteDe(l)?.costo === null);

  async function guardar() {
    setError("");
    if (!motivo) { setError("Elige el motivo del ajuste."); document.getElementById("motivo-vencido")?.focus(); return; }
    if (motivo === "otro" && detalle.trim().length < 4) { setError("Con el motivo «Otro» escribe el detalle (qué pasó)."); document.getElementById("detalle")?.focus(); return; }
    const sinCant = lineas.find((l) => cantidad(l) <= 0);
    if (sinCant) { setError(`Falta la cantidad de ${sinCant.p.nombre}.`); document.getElementById(`${sinCant.p.unidades_por_caja > 1 ? "cajas" : "sueltas"}-${sinCant.key}`)?.focus(); return; }
    // Lo que se resta de un mismo lote (aunque esté en varias líneas) no puede pasar de lo que hay.
    const porLote = new Map<string, number>();
    for (const l of lineas) porLote.set(l.lote_id, (porLote.get(l.lote_id) ?? 0) + firmado(l));
    const negativo = lineas.find((l) => (loteDe(l)?.unidades ?? 0) + (porLote.get(l.lote_id) ?? 0) < 0);
    if (negativo) { setError(`${negativo.p.nombre}: el lote ${loteDe(negativo)?.lote} solo tiene ${loteDe(negativo)?.unidades ?? 0} und.`); return; }
    setEnviando(true);
    let r: Response;
    try {
      r = await fetch("/api/inventario/ajustes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        motivo, detalle: detalle.trim() || null, idem_key: idem.current, lineas: lineas.map((l) => ({ lote_id: l.lote_id, unidades: firmado(l) })) }) });
    } catch { setEnviando(false); setError("Sin conexión: revisa internet y vuelve a guardar (no se duplicará)."); return; }
    setEnviando(false);
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setError(j.error ?? "No se pudo registrar el ajuste"); return; }
    setHecho({ id: j.id, numero: j.numero, acta: !!j.acta, motivo, unidades: neto });
    setLineas([]); setDetalle(""); idem.current = crypto.randomUUID();
    void refrescar();
    setTimeout(() => document.getElementById("ajuste-hecho")?.focus(), 0);
  }

  const esBaja = motivo !== "" && motivo !== "conteo";
  return (
    <div className="grid gap-4 max-w-5xl">
      {hecho && (
        <div id="ajuste-hecho" tabIndex={-1} role="status" className="rounded-xl bg-cruz-soft text-cruz px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="font-semibold flex-1 min-w-[220px]">{hecho.motivo === "conteo" ? `Ajuste N.º ${hecho.numero} registrado` : `Baja N.º ${hecho.numero} registrada`} ({nombreMotivo(hecho.motivo).toLowerCase()}, {hecho.unidades > 0 ? "+" : "−"}{Math.abs(hecho.unidades).toLocaleString("es-CO")} und). El inventario ya está al día.</p>
          {hecho.acta && <Link href={`/inventario/actas/${hecho.id}`} className="btn-primario h-10 text-sm">Ver e imprimir el acta</Link>}
        </div>
      )}

      <section className="tarjeta p-4 sm:p-5 grid gap-3" aria-labelledby="motivo-t">
        <fieldset>
          <legend id="motivo-t" className="titulo text-xl">1. ¿Por qué ajustas?</legend>
          <p className="text-sm text-muted mb-3">Las bajas restan del lote. «Diferencia de conteo» puede sumar o restar.</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            {MOTIVOS.map((m) => (
              <label key={m.id} className={`flex items-center gap-2.5 rounded-xl border-2 px-3 py-2.5 cursor-pointer text-[15px] font-semibold has-[:focus-visible]:outline has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-marca ${motivo === m.id ? "border-ink bg-paper" : "border-line bg-surface hover:border-ink/50"}`}>
                <input id={`motivo-${m.id}`} type="radio" name="motivo" value={m.id} checked={motivo === m.id} onChange={() => { setMotivo(m.id); setError(""); }} className="accent-[var(--ink)] w-4 h-4 shrink-0" />
                <span>{m.nombre}{m.acta && <span className="block text-xs font-normal text-muted">Genera acta de baja</span>}</span>
              </label>
            ))}
          </div>
        </fieldset>
        <div>
          <label htmlFor="detalle" className="etiqueta">Detalle {motivo === "otro" ? "(obligatorio)" : "(opcional)"}</label>
          <input id="detalle" value={detalle} onChange={(e) => setDetalle(e.target.value)} maxLength={300} className="campo"
            placeholder={motivo === "devolucion_proveedor" ? "Proveedor y número de la nota o guía" : motivo === "perdida" ? "Qué pasó y cuándo se notó" : "Qué pasó"} />
        </div>
      </section>

      <section className="tarjeta p-4 sm:p-5 grid gap-3" aria-labelledby="productos-t">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 id="productos-t" className="titulo text-xl">2. Productos y lotes</h2>
          {motivo === "vencido" && <button type="button" onClick={agregarVencidos} className="btn-borde h-10 text-sm">Agregar todos los lotes vencidos</button>}
        </div>
        <div className="relative">
          <label htmlFor="buscar-ajuste" className="etiqueta">Producto</label>
          <input id="buscar-ajuste" ref={buscar} value={q} onChange={(e) => setQ(e.target.value)} className="campo h-12 text-lg" placeholder="Escanea o escribe el nombre" autoComplete="off"
            aria-describedby="buscar-ajuste-ayuda" />
          <p id="buscar-ajuste-ayuda" className="text-sm text-muted mt-1">Con el lector de código de barras el producto entra directo.</p>
          {res.length > 0 && (
            <ul aria-label="Resultados" className="absolute z-10 mt-1 w-full tarjeta shadow-lg divide-y divide-line max-h-80 overflow-auto">
              {res.map((p) => <li key={p.id}><button type="button" onClick={() => agregar(p)} className="w-full text-left px-4 py-2.5 hover:bg-paper"><span className="font-semibold">{p.nombre}</span><span className="block text-sm text-muted">{p.laboratorio ?? "Sin laboratorio"}</span></button></li>)}
            </ul>
          )}
          {q.trim().length >= 2 && !buscando && res.length === 0 && <p className="text-sm text-muted mt-2">No aparece ningún producto con ese nombre o código.</p>}
        </div>

        {lineas.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line p-6 text-center text-muted">Cada producto que escanees aparece aquí para elegir el lote y la cantidad.</p>
        ) : (
          <ul className="grid gap-3">
            {lineas.map((l) => {
              const lote = loteDe(l), cant = cantidad(l), queda = (lote?.unidades ?? 0) + firmado(l);
              return (
                <li key={l.key} className="rounded-xl border border-line p-3 sm:p-4 grid gap-3">
                  <div className="flex items-start gap-3">
                    <div className="flex-1 min-w-0"><p className="font-semibold leading-snug">{l.p.nombre}</p><p className="text-sm text-muted">{l.p.laboratorio ?? "Sin laboratorio"}{l.p.unidades_por_caja > 1 ? ` · caja x ${l.p.unidades_por_caja}` : ""}</p></div>
                    <button type="button" onClick={() => setLineas((ls) => ls.filter((x) => x.key !== l.key))} className="text-sm text-alerta underline py-1" aria-label={`Quitar ${l.p.nombre}`}>Quitar</button>
                  </div>
                  <div className="grid grid-cols-2 md:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_auto] gap-3 items-end">
                    <div className="col-span-2 md:col-span-1">
                      <label htmlFor={`lote-${l.key}`} className="etiqueta">Lote</label>
                      <select id={`lote-${l.key}`} value={l.lote_id} onChange={(e) => cambiar(l.key, { lote_id: e.target.value })} className="campo">
                        {l.lotes.map((x) => <option key={x.lote_id} value={x.lote_id}>{x.lote} · vence {fecha(x.vence)} · {x.unidades.toLocaleString("es-CO")} und{x.vencido ? " · vencido" : ""}{x.bloqueado ? " · bloqueado" : ""}</option>)}
                      </select>
                    </div>
                    {l.p.unidades_por_caja > 1 && <div><label htmlFor={`cajas-${l.key}`} className="etiqueta">Cajas</label><input id={`cajas-${l.key}`} inputMode="numeric" value={l.cajas} onChange={(e) => cambiar(l.key, { cajas: e.target.value.replace(/\D/g, "").slice(0, 6) })} className="campo num" /></div>}
                    <div><label htmlFor={`sueltas-${l.key}`} className="etiqueta">{l.p.unidades_por_caja > 1 ? "Unidades sueltas" : "Unidades"}</label><input id={`sueltas-${l.key}`} inputMode="numeric" value={l.sueltas} onChange={(e) => cambiar(l.key, { sueltas: e.target.value.replace(/\D/g, "").slice(0, 7) })} className="campo num" /></div>
                    {sumaPermitida && (
                      <div className="col-span-2 md:col-span-1" role="radiogroup" aria-label={`Sumar o restar en ${l.p.nombre}`}>
                        <span className="etiqueta" aria-hidden="true">Diferencia</span>
                        <div className="flex rounded-xl border-2 border-line overflow-hidden h-11">
                          {[[false, "Faltan"], [true, "Sobran"]].map(([v, t]) => (
                            <button key={String(v)} type="button" role="radio" aria-checked={l.suma === v} onClick={() => cambiar(l.key, { suma: v as boolean })}
                              className={`flex-1 px-3 text-sm font-semibold ${l.suma === v ? "bg-ink text-white" : "bg-surface text-ink"}`}>{t as string}</button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                  <p className={`text-sm num ${queda < 0 ? "text-alerta font-semibold" : "text-muted"}`}>
                    {lote ? <>En el lote hay {lote.unidades.toLocaleString("es-CO")} und{cant > 0 ? <> · {l.suma ? "entran" : "salen"} {cant.toLocaleString("es-CO")} → quedan {queda.toLocaleString("es-CO")} und</> : null}</> : null}
                    {queda < 0 && " · no alcanza"}
                    {verCosto && lote && cant > 0 && (lote.costo !== null ? ` · ${pesos(cant * lote.costo)} a costo` : " · lote sin costo")}
                  </p>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {error && <p role="alert" className="text-alerta font-semibold">{error}</p>}
      {lineas.length > 0 && (
        <div className="tarjeta p-4 flex flex-wrap items-center gap-3 lg:sticky lg:bottom-3 lg:shadow-lg">
          <p className="flex-1 min-w-[180px] font-semibold num">{lineas.length} lote{lineas.length === 1 ? "" : "s"} · {neto > 0 ? "+" : neto < 0 ? "−" : ""}{Math.abs(neto).toLocaleString("es-CO")} und
            {valor !== null && (valor !== 0 || !faltaCosto) ? ` · ${valor < 0 ? "−" : ""}${pesos(Math.abs(valor))} a costo` : ""}{faltaCosto ? <span className="block text-sm font-normal text-muted">Hay lotes sin costo registrado: no suman en el valor.</span> : null}</p>
          <button type="button" onClick={guardar} disabled={enviando} className={esBaja ? "btn-peligro" : "btn-primario"}>{enviando ? "Guardando…" : esBaja ? (llevaActa(motivo) ? "Dar de baja y generar acta" : "Dar de baja") : "Registrar ajuste"}</button>
        </div>
      )}
      <p className="sr-only" aria-live="polite">{lineas.length ? `${lineas.length} lotes en el ajuste, ${unidadesTexto(neto, 1)}` : ""}</p>
    </div>
  );
}
