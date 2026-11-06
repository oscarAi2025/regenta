"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { BLOQUEOS } from "@/lib/precios";
import { unidadesTexto } from "@/lib/ajustes";
import type { LoteSeparado } from "@/lib/cuarentena-datos";

type Lote = { lote_id: string; lote: string; vence: string | null; unidades: number; bloqueado: boolean; vencido: boolean };
type Accion = { lote_id: string; tipo: "liberar" | "baja" } | null;
type Hecho = { texto: string; acta?: string };

const fecha = (d: string | null) => (d ? d.split("-").reverse().join("/") : "sin fecha");
const MOTIVOS_BAJA = [["averia", "No apto o averiado (con acta)"], ["vencido", "Vencido (con acta)"], ["devolucion_proveedor", "Devolución a proveedor"], ["otro", "Otro"]] as const;

/** Lotes separados: poner en cuarentena, liberar o dar de baja (acta). Cada acción devuelve la lista actualizada. */
export function Cuarentena({ inicial, destino: destinoInicial, configura }: { inicial: LoteSeparado[]; destino: string; configura: boolean }) {
  const [lotes, setLotes] = useState(inicial);
  const [accion, setAccion] = useState<Accion>(null);
  const [motivo, setMotivo] = useState("");
  const [motivoBaja, setMotivoBaja] = useState<(typeof MOTIVOS_BAJA)[number][0]>("averia");
  const [cantidad, setCantidad] = useState("");
  const [hecho, setHecho] = useState<Hecho | null>(null);
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [destino, setDestino] = useState(destinoInicial);
  const [avisoDestino, setAvisoDestino] = useState("");
  // Poner en cuarentena
  const [q, setQ] = useState(""); const [res, setRes] = useState<{ id: string; nombre: string; laboratorio: string | null; unidades_por_caja: number; exacto?: boolean }[]>([]);
  const [prod, setProd] = useState<{ id: string; nombre: string; lotes: Lote[] } | null>(null);
  const [loteNuevo, setLoteNuevo] = useState(""); const [motivoNuevo, setMotivoNuevo] = useState("");
  const idem = useRef("");

  useEffect(() => {
    if (q.trim().length < 2) { setRes([]); return; }
    const ctl = new AbortController();
    const t = setTimeout(() => fetch(`/api/productos?q=${encodeURIComponent(q)}`, { signal: ctl.signal }).then((r) => r.json()).then((j) => {
      const ps = j.productos ?? [];
      if (ps[0]?.exacto) { void elegirProducto(ps[0]); return; }
      setRes(ps.slice(0, 8));
    }).catch(() => {}), 160);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  async function elegirProducto(p: { id: string; nombre: string }) {
    setQ(""); setRes([]); setError("");
    const r = await fetch(`/api/inventario/lotes?producto=${p.id}`).catch(() => null);
    const j = await r?.json().catch(() => ({}));
    if (!r?.ok) { setError(j?.error ?? "No se pudieron traer los lotes."); return; }
    const vendibles = (j.lotes as Lote[]).filter((l) => l.unidades > 0 && !l.bloqueado);
    if (!vendibles.length) { setError(`${p.nombre} no tiene lotes con existencias para separar.`); return; }
    setProd({ id: p.id, nombre: p.nombre, lotes: vendibles }); setLoteNuevo(vendibles[0].lote_id);
    setTimeout(() => document.getElementById("motivo-nuevo")?.focus(), 0);
  }

  async function llamar(url: string, metodo: string, cuerpo: object) {
    setEnviando(true); setError("");
    const r = await fetch(url, { method: metodo, headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) }).catch(() => null);
    const j = await r?.json().catch(() => ({}));
    setEnviando(false);
    if (!r) { setError("Sin conexión: revisa internet e intenta de nuevo."); return null; }
    if (!r.ok) { setError(j?.error ?? "No se pudo guardar"); return null; }
    if (j.lotes) setLotes(j.lotes);
    return j;
  }

  async function poner() {
    if (!prod) return;
    const l = prod.lotes.find((x) => x.lote_id === loteNuevo);
    const j = await llamar("/api/inventario/cuarentena", "POST", { lote_id: loteNuevo, motivo: motivoNuevo });
    if (j) { setHecho({ texto: `El lote ${l?.lote} de ${prod.nombre} quedó en cuarentena: no se vende hasta liberarlo.` }); setProd(null); setMotivoNuevo(""); }
  }

  function abrir(a: Accion, l?: LoteSeparado) {
    setAccion(a); setMotivo(""); setError(""); setHecho(null); setCantidad("");
    setMotivoBaja(l?.vencido ? "vencido" : "averia"); idem.current = crypto.randomUUID();
  }

  async function confirmar(l: LoteSeparado) {
    if (accion?.tipo === "liberar") {
      const j = await llamar("/api/inventario/cuarentena/liberar", "POST", { lote_id: l.lote_id, motivo });
      if (j) { setAccion(null); setHecho({ texto: `El lote ${l.lote} de ${l.nombre} volvió a la venta (${unidadesTexto(l.unidades, l.unidades_por_caja)}).` }); }
    } else {
      const n = cantidad.trim() ? Number(cantidad.replace(/\D/g, "")) : undefined;
      const j = await llamar("/api/inventario/cuarentena/baja", "POST", { lote_id: l.lote_id, motivo: motivoBaja, detalle: motivo.trim() || null, unidades: n, idem_key: idem.current });
      if (j) { setAccion(null); setHecho({ texto: `Baja N.º ${j.numero} registrada: salen ${unidadesTexto(j.unidades, l.unidades_por_caja)} del lote ${l.lote} de ${l.nombre}.`, acta: j.acta ? j.id : undefined }); }
    }
    setTimeout(() => document.getElementById("cuarentena-hecho")?.focus(), 0);
  }

  async function guardarDestino(d: string) {
    setAvisoDestino("");
    const r = await fetch("/api/inventario/cuarentena", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ destino: d }) }).catch(() => null);
    const j = await r?.json().catch(() => ({}));
    if (!r?.ok) { setAvisoDestino(j?.error ?? "No se pudo guardar"); return; }
    setDestino(j.destino); setAvisoDestino("Guardado.");
  }

  return (
    <div className="grid gap-4 max-w-5xl">
      {hecho && (
        <div id="cuarentena-hecho" tabIndex={-1} role="status" className="rounded-xl bg-cruz-soft text-cruz px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-2 outline-none">
          <p className="font-semibold flex-1 min-w-[200px]">{hecho.texto}</p>
          {hecho.acta && <Link href={`/inventario/actas/${hecho.acta}`} className="btn-primario h-10 text-sm">Ver e imprimir el acta</Link>}
        </div>
      )}

      <section aria-labelledby="separados-t" className="grid gap-3">
        <h2 id="separados-t" className="titulo text-2xl">Lotes separados <span className="num text-muted text-xl">({lotes.length})</span></h2>
        {lotes.length === 0 ? <p className="tarjeta p-8 text-center text-muted">No hay lotes separados. Lo que devuelva un cliente a cuarentena aparecerá aquí.</p> : (
          <ul className="grid gap-3" aria-label="Lotes en cuarentena">
            {lotes.map((l) => {
              const abierta = accion?.lote_id === l.lote_id;
              return (
                <li key={l.lote_id} className="tarjeta p-4 grid gap-3" data-lote={l.lote_id}>
                  <div className="flex flex-wrap items-start gap-x-4 gap-y-2">
                    <div className="min-w-0 flex-1 basis-64">
                      <p className="font-semibold leading-snug">{l.nombre}</p>
                      <p className="text-sm text-muted num">Lote {l.lote} · vence {fecha(l.vence)}{l.vencido ? " (vencido)" : ""} · {unidadesTexto(l.unidades, l.unidades_por_caja)}</p>
                      {l.motivo && <p className="text-sm mt-1 break-words">{l.motivo}</p>}
                    </div>
                    <div className="sm:text-right shrink-0">
                      <span className={`inline-block rounded-lg px-2.5 py-1 text-sm font-semibold ${l.tipo === "invima" ? "bg-alerta-soft text-alerta" : "bg-aviso-soft text-aviso"}`}>{BLOQUEOS[l.tipo]}</span>
                      {l.desde && <p className="text-xs text-muted mt-1 num">desde {l.desde}{l.dias ? ` · ${l.dias} día${l.dias === 1 ? "" : "s"}` : ""}</p>}
                    </div>
                  </div>
                  {!abierta ? (
                    <div className="flex flex-wrap gap-2">
                      {l.tipo !== "invima" && <button type="button" className="btn-borde h-10 text-sm" onClick={() => abrir({ lote_id: l.lote_id, tipo: "liberar" }, l)}>Liberar para la venta</button>}
                      <button type="button" className="btn-borde h-10 text-sm" onClick={() => abrir({ lote_id: l.lote_id, tipo: "baja" }, l)}>Dar de baja</button>
                      {l.tipo === "invima" && <p className="text-sm text-muted self-center">Separado por una alerta del INVIMA: no se libera desde aquí.</p>}
                    </div>
                  ) : (
                    <div className="rounded-xl border-2 border-ink p-3 grid gap-3">
                      {accion.tipo === "baja" && (
                        <div className="grid sm:grid-cols-2 gap-3">
                          <div><label htmlFor={`baja-motivo-${l.lote_id}`} className="etiqueta">Motivo de la baja</label>
                            <select id={`baja-motivo-${l.lote_id}`} className="campo" value={motivoBaja} onChange={(e) => setMotivoBaja(e.target.value as typeof motivoBaja)}>
                              {MOTIVOS_BAJA.filter(([k]) => k !== "vencido" || l.vencido).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
                            </select></div>
                          <div><label htmlFor={`baja-cant-${l.lote_id}`} className="etiqueta">Unidades (vacío = todo el lote, {l.unidades})</label>
                            <input id={`baja-cant-${l.lote_id}`} className="campo num" inputMode="numeric" value={cantidad} onChange={(e) => setCantidad(e.target.value.replace(/\D/g, "").slice(0, 7))} placeholder={String(l.unidades)} /></div>
                        </div>
                      )}
                      <div>
                        <label htmlFor={`motivo-${l.lote_id}`} className="etiqueta">{accion.tipo === "liberar" ? "¿Qué se revisó? (obligatorio)" : `Detalle ${motivoBaja === "otro" ? "(obligatorio)" : "(opcional)"}`}</label>
                        <input id={`motivo-${l.lote_id}`} className="campo" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={200}
                          placeholder={accion.tipo === "liberar" ? "Ej.: empaque sellado, en buen estado" : "Ej.: empaque abierto"} />
                      </div>
                      {error && <p role="alert" className="text-sm text-alerta font-semibold">{error}</p>}
                      <div className="flex flex-wrap gap-2">
                        <button type="button" className="btn-primario h-10 text-sm" disabled={enviando || (accion.tipo === "liberar" ? motivo.trim().length < 4 : motivoBaja === "otro" && motivo.trim().length < 4)} onClick={() => void confirmar(l)}>
                          {enviando ? "Guardando…" : accion.tipo === "liberar" ? "Liberar lote" : "Dar de baja"}</button>
                        <button type="button" className="btn-borde h-10 text-sm" onClick={() => setAccion(null)} disabled={enviando}>Cancelar</button>
                      </div>
                    </div>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </section>

      <section className="tarjeta p-4 sm:p-5 grid gap-3" aria-labelledby="poner-t">
        <div>
          <h2 id="poner-t" className="titulo text-xl">Poner un lote en cuarentena</h2>
          <p className="text-sm text-muted">Para mercancía en duda (empaque dañado, cadena de frío, revisión pendiente): el lote completo deja de venderse hasta que lo liberes o lo des de baja.</p>
        </div>
        {!prod ? (
          <div className="relative">
            <label htmlFor="buscar-cuarentena" className="etiqueta">Producto</label>
            <input id="buscar-cuarentena" className="campo" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Escanea o escribe el nombre" autoComplete="off" />
            {res.length > 0 && (
              <ul aria-label="Resultados" className="absolute z-10 mt-1 w-full tarjeta shadow-lg divide-y divide-line max-h-80 overflow-auto">
                {res.map((p) => <li key={p.id}><button type="button" onClick={() => void elegirProducto(p)} className="w-full text-left px-4 py-2.5 hover:bg-paper"><span className="font-semibold">{p.nombre}</span><span className="block text-sm text-muted">{p.laboratorio ?? "Genérico"}</span></button></li>)}
              </ul>
            )}
          </div>
        ) : (
          <div className="grid gap-3">
            <p className="font-semibold">{prod.nombre} <button type="button" className="text-sm text-muted underline font-normal ml-2" onClick={() => setProd(null)}>Cambiar</button></p>
            <div className="grid sm:grid-cols-2 gap-3">
              <div><label htmlFor="lote-nuevo" className="etiqueta">Lote</label>
                <select id="lote-nuevo" className="campo" value={loteNuevo} onChange={(e) => setLoteNuevo(e.target.value)}>
                  {prod.lotes.map((l) => <option key={l.lote_id} value={l.lote_id}>{l.lote} · vence {fecha(l.vence)} · {l.unidades} und</option>)}
                </select></div>
              <div><label htmlFor="motivo-nuevo" className="etiqueta">Motivo</label>
                <input id="motivo-nuevo" className="campo" value={motivoNuevo} onChange={(e) => setMotivoNuevo(e.target.value)} maxLength={200} placeholder="Ej.: llegó con el empaque golpeado" /></div>
            </div>
            <div><button type="button" className="btn-oscuro" disabled={enviando || motivoNuevo.trim().length < 4} onClick={() => void poner()}>{enviando ? "Guardando…" : "Poner en cuarentena"}</button></div>
          </div>
        )}
        {error && !accion && <p role="alert" className="text-sm text-alerta font-semibold">{error}</p>}
      </section>

      {configura && (
        <section className="tarjeta p-4 sm:p-5 grid gap-3" aria-labelledby="destino-t">
          <fieldset>
            <legend id="destino-t" className="titulo text-xl">Devoluciones de clientes</legend>
            <p className="text-sm text-muted mb-2">A dónde va por defecto lo que devuelve un cliente. En cada devolución se puede cambiar.</p>
            <div className="grid sm:grid-cols-2 gap-2">
              {([["vendible", "Vuelve a la venta"], ["cuarentena", "A cuarentena para revisarlo"]] as const).map(([k, t]) => (
                <label key={k} className={`flex items-center gap-2.5 rounded-xl border-2 px-3 py-2.5 cursor-pointer font-semibold ${destino === k ? "border-ink bg-paper" : "border-line bg-surface hover:border-ink/50"}`}>
                  <input type="radio" name="destino" value={k} checked={destino === k} onChange={() => void guardarDestino(k)} className="accent-[var(--ink)] w-4 h-4 shrink-0" />{t}
                </label>
              ))}
            </div>
          </fieldset>
          {avisoDestino && <p role="status" className={`text-sm font-semibold ${avisoDestino === "Guardado." ? "text-cruz" : "text-alerta"}`}>{avisoDestino}</p>}
        </section>
      )}
    </div>
  );
}
