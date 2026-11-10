"use client";
import { useMemo, useRef, useState } from "react";

export type Linea = {
  id: number; producto_id: string; nombre: string; laboratorio: string | null; ean: string | null; unidades_por_caja: number;
  lote_id: string; lote: string; vence: string | null; vencido: boolean; contado: number | null; sistema: number; costo: number | null; nuevo: boolean;
  oculto?: boolean;
};
type Prod = { id: string; nombre: string; laboratorio: string | null; ean: string | null; unidades_por_caja: number; exacto?: boolean };
type LoteSis = { lote_id: string; lote: string; vence: string | null; unidades: number; vencido: boolean; costo: number | null };
type Elegir = { p: Prod; otros: LoteSis[]; nuevo: { lote: string; vence: string } };

const fecha = (d: string | null) => (d ? new Date(d + "T00:00:00").toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "2-digit" }) : "sin fecha");
const pesos = (v: number) => (v < 0 ? "−" : "") + "$" + Math.abs(Math.round(v)).toLocaleString("es-CO");
const POR_PAGINA = 80;

/** `ciego`: conteo a ciegas. Aquí nadie ve lo del sistema ni las diferencias (se cuenta lo que hay); la gerencia las ve
 *  en el informe y, al cerrar, todos ven el resultado. */
export function Contar({ conteo, inicial, verCosto, ciego = false }: { conteo: { id: string; numero: number }; inicial: Linea[]; verCosto: boolean; ciego?: boolean }) {
  const [lineas, setLineas] = useState<Linea[]>(inicial);
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Prod[]>([]);
  const [aviso, setAviso] = useState<{ texto: string; tono: "ok" | "error"; producto?: string } | null>(null);
  const [elegir, setElegir] = useState<Elegir | null>(null);
  const [ver, setVer] = useState<"todos" | "sin" | "dif">("todos");
  const [filtro, setFiltro] = useState("");
  const [cuantos, setCuantos] = useState(POR_PAGINA);
  const [editando, setEditando] = useState<Record<number, string>>({});
  const [cerrar, setCerrar] = useState(false);
  const [enCero, setEnCero] = useState(false);
  const [obs, setObs] = useState("");
  const [cerrando, setCerrando] = useState(false);
  const [errorCierre, setErrorCierre] = useState("");
  const ultimoLote = useRef<Record<string, string>>({});
  const escaner = useRef<HTMLInputElement>(null);

  const resumen = useMemo(() => {
    let contados = 0, dif = 0, sobran = 0, faltan = 0, valor = 0, sinCosto = false;
    for (const l of lineas) {
      if (l.contado === null) continue;
      contados++;
      const d = l.contado - l.sistema;
      if (d !== 0) { dif++; if (d > 0) sobran += d; else faltan -= d; if (l.costo === null) sinCosto = true; else valor += d * l.costo; }
    }
    return { contados, dif, sobran, faltan, valor, sinCosto, sinContar: lineas.length - contados };
  }, [lineas]);

  const visibles = useMemo(() => {
    const ws = filtro.trim().toLowerCase().split(/\s+/).filter(Boolean);
    return lineas.filter((l) => (ver === "sin" ? l.contado === null : ver === "dif" ? l.contado !== null && l.contado !== l.sistema : true)
      && ws.every((w) => `${l.nombre} ${l.laboratorio ?? ""} ${l.lote} ${l.ean ?? ""}`.toLowerCase().includes(w)));
  }, [lineas, ver, filtro]);

  function aplicar(r: { linea_id: number; lote_id: string; producto_id: string; lote: string; vence: string | null; contado: number; nuevo: boolean; sistema: number | null }, p?: Prod, costo?: number | null) {
    setLineas((ls) => {
      const i = ls.findIndex((l) => l.lote_id === r.lote_id);
      if (i >= 0) { const c = [...ls]; c[i] = { ...c[i], contado: r.contado, sistema: r.sistema ?? 0 }; return c; }
      const base = p ?? ls.find((l) => l.producto_id === r.producto_id);
      if (!base) return ls;
      const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
      return [{ id: r.linea_id, producto_id: r.producto_id, nombre: base.nombre, laboratorio: base.laboratorio, ean: base.ean, unidades_por_caja: base.unidades_por_caja,
        lote_id: r.lote_id, lote: r.lote, vence: r.vence, vencido: !!r.vence && r.vence < hoy, contado: r.contado, sistema: r.sistema ?? 0, costo: costo ?? null, nuevo: r.nuevo }, ...ls];
    });
  }

  async function enviar(cuerpo: Record<string, unknown>) {
    const r = await fetch(`/api/inventario/conteos/${conteo.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) }).catch(() => null);
    const j = await r?.json().catch(() => ({}));
    if (!r?.ok) { setAviso({ texto: j?.error ?? "Sin conexión: no se guardó. Vuelve a escanear.", tono: "error" }); return null; }
    return j;
  }

  /** Un escaneo (o elegir un lote) suma 1 a ese lote. */
  async function sumarUno(lote_id: string, p?: Prod, costo?: number | null) {
    const j = await enviar({ modo: "sumar", cantidad: 1, lote_id });
    if (!j) return;
    aplicar(j, p, costo);
    ultimoLote.current[j.producto_id] = lote_id;
    const nombre = p?.nombre ?? lineas.find((l) => l.producto_id === j.producto_id)?.nombre ?? "";
    setAviso({ texto: `+1 · ${nombre} · lote ${j.lote} → ${j.contado.toLocaleString("es-CO")} contadas`, tono: "ok", producto: j.producto_id });
  }

  async function porProducto(p: Prod) {
    setQ(""); setRes([]); setElegir(null);
    const delConteo = lineas.filter((l) => l.producto_id === p.id);
    const recordado = ultimoLote.current[p.id];
    if (recordado && delConteo.some((l) => l.lote_id === recordado)) return sumarUno(recordado, p);
    if (delConteo.length === 1) return sumarUno(delConteo[0].lote_id, p);
    // Varios lotes (o ninguno en el conteo): se elige. También se ofrecen los demás lotes del producto y uno nuevo.
    const r = await fetch(`/api/inventario/lotes?producto=${p.id}`).catch(() => null);
    const j = await r?.json().catch(() => ({}));
    const otros: LoteSis[] = (j?.lotes ?? []).filter((x: LoteSis) => !delConteo.some((l) => l.lote_id === x.lote_id));
    setElegir({ p, otros, nuevo: { lote: "", vence: "" } });
    setTimeout(() => document.getElementById("elegir-lote")?.focus(), 0);
  }

  async function escanear(e: React.FormEvent) {
    e.preventDefault();
    const t = q.trim();
    if (!t) return;
    const local = lineas.find((l) => l.ean && l.ean === t);
    if (local) { setQ(""); return porProducto({ id: local.producto_id, nombre: local.nombre, laboratorio: local.laboratorio, ean: local.ean, unidades_por_caja: local.unidades_por_caja }); }
    const r = await fetch(`/api/productos?q=${encodeURIComponent(t)}`).catch(() => null);
    const j = await r?.json().catch(() => ({}));
    const ps: Prod[] = j?.productos ?? [];
    if (ps[0]?.exacto) return porProducto(ps[0]);
    if (!ps.length) { setAviso({ texto: `No hay ningún producto con «${t}». Si es nuevo, créalo en Productos.`, tono: "error" }); setQ(""); return; }
    setRes(ps.slice(0, 8));
  }

  async function fijar(l: Linea) {
    const v = editando[l.id];
    if (v === undefined) return;
    setEditando((e) => { const c = { ...e }; delete c[l.id]; return c; });
    if (v.trim() === "" || Number(v) === l.contado) return;
    const j = await enviar({ modo: "fijar", cantidad: Number(v), lote_id: l.lote_id });
    if (j) { aplicar(j); setAviso({ texto: `${l.nombre} · lote ${l.lote}: ${j.contado.toLocaleString("es-CO")} contadas`, tono: "ok" }); }
  }

  async function loteNuevo(e: React.FormEvent) {
    e.preventDefault();
    if (!elegir) return;
    const { lote, vence } = elegir.nuevo;
    if (!lote.trim()) { setAviso({ texto: "Escribe el código del lote nuevo.", tono: "error" }); return; }
    if (!vence) { setAviso({ texto: "Pon el vencimiento del lote nuevo.", tono: "error" }); return; }
    const j = await enviar({ modo: "sumar", cantidad: 1, producto_id: elegir.p.id, lote: lote.trim().toUpperCase(), vence });
    if (!j) return;
    aplicar(j, elegir.p, null);
    ultimoLote.current[elegir.p.id] = j.lote_id;
    setAviso({ texto: `+1 · ${elegir.p.nombre} · lote ${j.lote}${j.lote_creado ? " (lote nuevo)" : ""} → ${j.contado} contadas`, tono: "ok", producto: elegir.p.id });
    setElegir(null);
    escaner.current?.focus();
  }

  async function actualizar() {
    const r = await fetch(`/api/inventario/conteos/${conteo.id}`).catch(() => null);
    const j = await r?.json().catch(() => ({}));
    if (r?.ok) { setLineas(j.lineas); setAviso({ texto: "Lista actualizada con lo que contaron en otros equipos.", tono: "ok" }); }
    else setAviso({ texto: j?.error ?? "Sin conexión.", tono: "error" });
  }

  async function confirmarCierre() {
    setErrorCierre(""); setCerrando(true);
    const r = await fetch(`/api/inventario/conteos/${conteo.id}/cerrar`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ sin_contar_en_cero: enCero, observaciones: obs.trim() || null }) }).catch(() => null);
    const j = await r?.json().catch(() => ({}));
    setCerrando(false);
    if (!r?.ok) { setErrorCierre(j?.error ?? "Sin conexión: el conteo no se cerró. Intenta de nuevo."); return; }
    location.assign(`/inventario/conteos/${conteo.id}`); // carga completa: el conteo cerrado se ve con los datos del cierre
  }

  const tabs: [typeof ver, string, number][] = [["todos", "Todos", lineas.length], ["sin", "Sin contar", resumen.sinContar], ...(ciego ? [] : [["dif", "Con diferencia", resumen.dif] as [typeof ver, string, number]])];
  return (
    <div className="grid gap-4 max-w-5xl">
      <section className="tarjeta p-4 sm:p-5 grid gap-3" aria-labelledby="escanear-t">
        <h2 id="escanear-t" className="sr-only">Escanear</h2>
        <form onSubmit={escanear} className="grid gap-2 relative">
          <label htmlFor="escaner" className="etiqueta text-base">Escanea el código de barras (cada escaneo suma 1)</label>
          <div className="flex gap-2">
            <input id="escaner" ref={escaner} autoFocus value={q} onChange={(e) => { setQ(e.target.value); setRes([]); }} autoComplete="off" enterKeyHint="go"
              className="campo h-14 text-xl flex-1 min-w-0" placeholder="Código o nombre" />
            <button className="btn-oscuro h-14 px-4 sm:px-6">Contar</button>
          </div>
          {res.length > 0 && (
            <ul aria-label="Resultados" className="absolute top-full z-10 mt-1 w-full tarjeta shadow-lg divide-y divide-line max-h-80 overflow-auto">
              {res.map((p) => <li key={p.id}><button type="button" onClick={() => porProducto(p)} className="w-full text-left px-4 py-3 hover:bg-paper"><span className="font-semibold">{p.nombre}</span><span className="block text-sm text-muted">{p.laboratorio ?? "Genérico"}</span></button></li>)}
            </ul>
          )}
        </form>
        <p className="text-sm text-muted num">{resumen.contados.toLocaleString("es-CO")} de {lineas.length.toLocaleString("es-CO")} lotes contados{ciego ? " · conteo a ciegas: cuenta lo que hay, sin mirar el sistema" : ` · ${resumen.dif} con diferencia`}</p>
        <div aria-live="polite">
          {aviso && (
            <p className={`rounded-xl px-4 py-3 font-semibold flex flex-wrap items-center gap-x-3 gap-y-1 ${aviso.tono === "ok" ? "bg-cruz-soft text-cruz" : "bg-alerta-soft text-alerta"}`} role={aviso.tono === "error" ? "alert" : "status"}>
              <span className="flex-1 min-w-0 break-words">{aviso.texto}</span>
              {aviso.producto && lineas.filter((l) => l.producto_id === aviso.producto).length > 0 && (
                <button type="button" className="underline text-sm" onClick={() => { const pid = aviso.producto!; delete ultimoLote.current[pid]; const l = lineas.find((x) => x.producto_id === pid)!;
                  setAviso(null); porProducto({ id: pid, nombre: l.nombre, laboratorio: l.laboratorio, ean: l.ean, unidades_por_caja: l.unidades_por_caja }); }}>Cambiar de lote</button>
              )}
            </p>
          )}
        </div>
      </section>

      {elegir && (
        <section className="tarjeta p-4 sm:p-5 grid gap-3 border-ink border-2" aria-labelledby="elegir-lote">
          <div className="flex items-start gap-3">
            <h2 id="elegir-lote" tabIndex={-1} className="titulo text-xl flex-1">¿De qué lote es? <span className="block font-sans font-semibold text-base">{elegir.p.nombre}</span></h2>
            <button type="button" onClick={() => { setElegir(null); escaner.current?.focus(); }} className="text-sm underline py-1">Cancelar</button>
          </div>
          <div className="grid sm:grid-cols-2 gap-2">
            {lineas.filter((l) => l.producto_id === elegir.p.id).map((l) => (
              <button key={l.lote_id} type="button" onClick={() => { setElegir(null); sumarUno(l.lote_id); escaner.current?.focus(); }} className="rounded-xl border-2 border-line hover:border-ink bg-surface px-4 py-3 text-left">
                <span className="font-semibold num">Lote {l.lote}</span><span className="block text-sm text-muted num">Vence {fecha(l.vence)} · contadas {l.contado ?? 0}</span>
              </button>
            ))}
            {elegir.otros.map((x) => (
              <button key={x.lote_id} type="button" onClick={() => { const p = elegir.p; setElegir(null); sumarUno(x.lote_id, p, x.costo); escaner.current?.focus(); }} className="rounded-xl border-2 border-dashed border-line hover:border-ink bg-surface px-4 py-3 text-left">
                <span className="font-semibold num">Lote {x.lote}</span><span className="block text-sm text-muted num">Vence {fecha(x.vence)}{ciego ? "" : ` · en el sistema ${x.unidades} und`} · no estaba en este conteo</span>
              </button>
            ))}
          </div>
          <form onSubmit={loteNuevo} className="grid grid-cols-2 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end rounded-xl bg-paper p-3">
            <p className="col-span-2 sm:col-span-3 text-sm font-semibold">¿Es un lote que no está en el sistema?</p>
            <div><label htmlFor="nuevo-lote" className="etiqueta">Lote</label><input id="nuevo-lote" value={elegir.nuevo.lote} onChange={(e) => setElegir({ ...elegir, nuevo: { ...elegir.nuevo, lote: e.target.value.toUpperCase() } })} maxLength={40} className="campo" autoComplete="off" /></div>
            <div><label htmlFor="nuevo-vence" className="etiqueta">Vence</label><input id="nuevo-vence" type="date" value={elegir.nuevo.vence} onChange={(e) => setElegir({ ...elegir, nuevo: { ...elegir.nuevo, vence: e.target.value } })} className="campo" /></div>
            <button className="btn-borde col-span-2 sm:col-span-1">Contar en lote nuevo</button>
          </form>
        </section>
      )}

      <section className="grid gap-3" aria-labelledby="lineas-t">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <h2 id="lineas-t" className="titulo text-2xl">Lotes del conteo</h2>
          <button type="button" onClick={actualizar} className="btn-borde h-10 text-sm">Actualizar</button>
        </div>
        <div className="grid sm:grid-cols-[auto_minmax(0,1fr)] gap-2 items-center">
          <nav className="flex gap-1 bg-surface border border-line rounded-xl p-1 overflow-x-auto" aria-label="Filtro de lotes">
            {tabs.map(([k, t, nn]) => (
              <button key={k} type="button" onClick={() => { setVer(k); setCuantos(POR_PAGINA); }} aria-pressed={ver === k}
                className={`shrink-0 px-3 py-1.5 rounded-lg text-sm font-semibold num ${ver === k ? "bg-ink text-white" : "text-muted"}`}>{t} ({nn.toLocaleString("es-CO")})</button>
            ))}
          </nav>
          <div><label htmlFor="filtro-lineas" className="sr-only">Buscar en el conteo</label>
            <input id="filtro-lineas" value={filtro} onChange={(e) => { setFiltro(e.target.value); setCuantos(POR_PAGINA); }} className="campo" placeholder="Buscar producto o lote en la lista" /></div>
        </div>
        <ul className="tarjeta divide-y divide-line" aria-label="Lotes">
          {visibles.slice(0, cuantos).map((l) => {
            const d = l.contado === null ? null : l.contado - l.sistema;
            const valor = editando[l.id] ?? (l.contado === null ? "" : String(l.contado));
            return (
              <li key={l.lote_id} className="px-3 sm:px-4 py-3 grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 items-center">
                <div className="min-w-0">
                  <p className="font-semibold leading-snug break-words">{l.nombre}</p>
                  <p className="text-sm text-muted num">Lote <b className="text-ink">{l.lote}</b> · vence {fecha(l.vence)}{l.vencido ? <span className="text-alerta font-semibold"> · vencido</span> : null}{l.nuevo ? " · agregado al contar" : ""}</p>
                </div>
                <div className="flex items-center gap-2">
                  <label htmlFor={`contado-${l.id}`} className="sr-only">Contado de {l.nombre} lote {l.lote}</label>
                  <input id={`contado-${l.id}`} inputMode="numeric" value={valor} placeholder="—" onChange={(e) => setEditando({ ...editando, [l.id]: e.target.value.replace(/\D/g, "").slice(0, 7) })}
                    onBlur={() => fijar(l)} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); } }}
                    className="campo w-20 h-11 text-center text-lg num font-semibold" />
                </div>
                <p className="col-span-2 text-sm num flex flex-wrap gap-x-3">
                  {ciego ? <span className="text-muted">{l.contado === null ? "Sin contar" : "Contado"}</span> : <>
                  <span className="text-muted">Sistema {l.sistema.toLocaleString("es-CO")} und</span>
                  {d === null ? <span className="text-muted">Sin contar</span>
                    : d === 0 ? <span className="text-cruz font-semibold">Cuadra</span>
                    : <span className={d < 0 ? "text-alerta font-semibold" : "text-aviso font-semibold"}>{d < 0 ? `Faltan ${(-d).toLocaleString("es-CO")}` : `Sobran ${d.toLocaleString("es-CO")}`} und{verCosto && l.costo !== null ? ` · ${pesos(d * l.costo)}` : ""}</span>}
                  </>}
                </p>
              </li>
            );
          })}
          {visibles.length === 0 && <li className="px-4 py-10 text-center text-muted">{ver === "dif" ? "Ningún lote contado tiene diferencia." : ver === "sin" ? "Ya contaste todos los lotes." : "No hay lotes que coincidan."}</li>}
        </ul>
        {visibles.length > cuantos && <button type="button" onClick={() => setCuantos(cuantos + POR_PAGINA * 2)} className="btn-borde justify-self-center">Mostrar más ({(visibles.length - cuantos).toLocaleString("es-CO")} lotes)</button>}
      </section>

      <section className="tarjeta p-4 lg:sticky lg:bottom-3 lg:shadow-lg grid gap-3" aria-labelledby="resumen-t">
        <h2 id="resumen-t" className="sr-only">Resumen del conteo</h2>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <p className="flex-1 min-w-[200px] num text-[15px]"><b>{resumen.contados.toLocaleString("es-CO")}</b> de {lineas.length.toLocaleString("es-CO")} lotes contados{!ciego && <> · <b>{resumen.dif}</b> con diferencia</>}
            {!ciego && resumen.faltan > 0 && <span className="text-alerta"> · faltan {resumen.faltan.toLocaleString("es-CO")} und</span>}{!ciego && resumen.sobran > 0 && <span className="text-aviso"> · sobran {resumen.sobran.toLocaleString("es-CO")} und</span>}
            {!ciego && verCosto && resumen.dif > 0 && <> · {pesos(resumen.valor)}{resumen.sinCosto ? "*" : ""} a costo</>}</p>
          {!cerrar && <button type="button" onClick={() => setCerrar(true)} className="btn-primario">Cerrar conteo</button>}
        </div>
        {cerrar && (
          <div className="grid gap-3 border-t border-line pt-3">
            <p className="text-[15px]">Al cerrar, Regenta ajusta las existencias de los <b>{resumen.contados.toLocaleString("es-CO")}</b> lotes contados para que queden iguales a lo contado (un solo ajuste «Diferencia de conteo»). El conteo ya no se podrá modificar.</p>
            {resumen.sinContar > 0 && (
              <label className="flex items-start gap-2.5 text-[15px]">
                <input type="checkbox" checked={enCero} onChange={(e) => setEnCero(e.target.checked)} className="mt-1 w-4 h-4 accent-[var(--ink)]" />
                <span>Los <b>{resumen.sinContar.toLocaleString("es-CO")}</b> lotes que no conté no están en la droguería: déjalos en cero.<span className="block text-sm text-muted">Si no lo marcas, los lotes sin contar quedan como están.</span></span>
              </label>
            )}
            <div><label htmlFor="obs-cierre" className="etiqueta">Observaciones (opcional)</label><input id="obs-cierre" value={obs} onChange={(e) => setObs(e.target.value)} maxLength={500} className="campo" /></div>
            {errorCierre && <p role="alert" className="text-alerta font-semibold">{errorCierre}</p>}
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={confirmarCierre} disabled={cerrando} className="btn-primario">{cerrando ? "Cerrando…" : "Cerrar y ajustar el inventario"}</button>
              <button type="button" onClick={() => setCerrar(false)} className="btn-borde">Seguir contando</button>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
