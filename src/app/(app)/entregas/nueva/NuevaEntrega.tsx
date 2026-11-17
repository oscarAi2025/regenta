"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { existenciasTexto } from "@/lib/formato";
import { DESTINATARIOS, ENTREGA_VACIA, errorEntrega, type DatosEntrega, type TipoDestinatario } from "@/lib/entregas";
import { FORMULA_VACIA, errorFormula, exigencia, pideFormula, type ConfigFormula, type DatosFormula } from "@/lib/control-especial";
import { PanelFormula } from "../../caja/PanelFormula";
import { MarcaFormula, Ubicacion, Vence } from "../../caja/Productos";
import type { Producto } from "../../caja/tipos";

type Linea = { p: Producto; presentacion: "caja" | "unidad"; cantidad: number };
const unidadesDe = (l: Linea) => l.cantidad * (l.presentacion === "caja" ? l.p.unidades_por_caja : 1);
const nuevaClave = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
const ETIQUETA_NOMBRE: Record<TipoDestinatario, string> = { servicio: "Servicio o área que recibe", paciente: "Nombre del paciente", empleado: "Nombre del empleado", sede: "Sede que recibe", otro: "Quién recibe" };

/** Formulario de la entrega interna: productos (con existencias y vencimiento a la vista), a quién se entrega, quién
 *  autoriza y, si algún producto lo pide, la fórmula médica (mismas reglas que la caja). */
export function NuevaEntrega({ cfg }: { cfg: ConfigFormula }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Producto[]>([]);
  const [buscando, setBuscando] = useState(false);
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [datos, setDatos] = useState<DatosEntrega>(ENTREGA_VACIA);
  const [formula, setFormula] = useState<DatosFormula>(FORMULA_VACIA);
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const clave = useRef(nuevaClave());
  const buscador = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) { setRes([]); return; }
    const ctl = new AbortController();
    const id = setTimeout(async () => {
      setBuscando(true);
      try {
        const r = await fetch(`/api/productos?q=${encodeURIComponent(t)}`, { signal: ctl.signal });
        setRes(r.ok ? ((await r.json()).productos ?? []) : []);
      } catch { /* búsqueda reemplazada o sin red */ } finally { setBuscando(false); }
    }, 220);
    return () => { clearTimeout(id); ctl.abort(); };
  }, [q]);

  const ex = useMemo(() => exigencia(lineas.map((l) => l.p), cfg), [lineas, cfg]);
  const faltaFormula = errorFormula(formula, ex, cfg);
  const total = lineas.reduce((a, l) => a + unidadesDe(l), 0);
  const set = <K extends keyof DatosEntrega>(k: K, v: DatosEntrega[K]) => { setDatos((d) => ({ ...d, [k]: v })); setError(""); };

  function agregar(p: Producto, presentacion: "caja" | "unidad") {
    setLineas((ls) => {
      const i = ls.findIndex((l) => l.p.id === p.id && l.presentacion === presentacion);
      if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, cantidad: l.cantidad + 1 } : l));
      return [...ls, { p, presentacion, cantidad: 1 }];
    });
    setQ(""); setRes([]); setError("");
    buscador.current?.focus();
  }
  const cambiar = (i: number, cantidad: number) => setLineas((ls) => ls.map((l, j) => (j === i ? { ...l, cantidad: Math.max(1, Math.min(100000, Math.floor(cantidad) || 1)) } : l)));
  const quitar = (i: number) => setLineas((ls) => ls.filter((_, j) => j !== i));

  async function entregar(e: React.FormEvent) {
    e.preventDefault();
    const falta = errorEntrega(datos, lineas.length) ?? faltaFormula;
    if (falta) { setError(falta); return; }
    const pasado = lineas.find((l) => unidadesDe(l) > l.p.unidades);
    if (pasado) { setError(`No hay existencias suficientes de ${pasado.p.nombre}: hay ${existenciasTexto(pasado.p.unidades, pasado.p.unidades_por_caja)}`); return; }
    setEnviando(true); setError("");
    try {
      const r = await fetch("/api/entregas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        idem_key: clave.current, ...datos, lineas: lineas.map((l) => ({ producto_id: l.p.id, presentacion: l.presentacion, cantidad: l.cantidad })),
        formula: pideFormula(ex) ? formula : undefined }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setError(j.error ?? "No se pudo registrar la entrega"); setEnviando(false); return; }
      router.push(`/entregas/${j.entrega_id}?nueva=1`);
    } catch { setError("Sin conexión: la entrega no se registró. Intenta de nuevo."); setEnviando(false); }
  }

  const tipo = datos.destinatario_tipo;
  return (
    <form onSubmit={entregar} className="grid grid-cols-[minmax(0,1fr)] xl:grid-cols-[minmax(0,1fr)_400px] gap-5 items-start" aria-label="Nueva entrega interna">
      <div className="grid gap-5 min-w-0">
        <section className="tarjeta p-5 min-w-0" aria-labelledby="productos-titulo">
          <h2 id="productos-titulo" className="titulo text-xl">Productos</h2>
          <label htmlFor="buscar" className="sr-only">Buscar producto por nombre, laboratorio o código de barras</label>
          <input id="buscar" ref={buscador} type="search" autoFocus autoComplete="off" className="campo mt-3" placeholder="Buscar por nombre, laboratorio o código de barras"
            value={q} onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); const p = res.find((x) => x.unidades > 0); if (p) agregar(p, "caja"); } }} />
          {q.trim().length >= 2 && (
            <ul className="mt-2 rounded-xl border border-line divide-y divide-line max-h-80 overflow-y-auto" aria-label="Resultados" aria-busy={buscando}>
              {res.length === 0 && <li className="px-4 py-3 text-sm text-muted">{buscando ? "Buscando…" : "Sin resultados"}</li>}
              {res.map((p) => {
                const agotado = p.unidades <= 0;
                return (
                  <li key={p.id} className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 ${agotado ? "opacity-55" : ""}`}>
                    <div className="min-w-0 flex-1 basis-56">
                      <p className="font-semibold leading-snug">{p.nombre}</p>
                      <p className="text-sm text-muted flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span>{p.laboratorio ?? "Sin laboratorio"}</span><span aria-hidden>·</span>
                        <span className={agotado ? "text-alerta font-semibold" : ""}>{existenciasTexto(p.unidades, p.unidades_por_caja)}</span>
                        <Vence fecha={p.proximo_vence} /><MarcaFormula p={p} /><Ubicacion u={p.ubicacion} />
                      </p>
                    </div>
                    <div className="flex gap-2">
                      <button type="button" disabled={agotado} onClick={() => agregar(p, "caja")} className="btn-borde h-10 text-sm disabled:opacity-40">+ {p.unidades_por_caja > 1 ? "Caja" : "Unidad"}</button>
                      {p.unidades_por_caja > 1 && <button type="button" disabled={agotado} onClick={() => agregar(p, "unidad")} className="btn-borde h-10 text-sm disabled:opacity-40">+ Unidad</button>}
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
          {lineas.length ? (
            <ul className="mt-4 divide-y divide-line" aria-label="Productos de la entrega">
              {lineas.map((l, i) => {
                const pasa = unidadesDe(l) > l.p.unidades;
                return (
                  <li key={l.p.id + l.presentacion} className="py-3 flex flex-wrap items-center gap-3">
                    <div className="min-w-0 flex-1 basis-56">
                      <p className="font-semibold leading-snug">{l.p.nombre}</p>
                      <p className={`text-sm ${pasa ? "text-alerta font-semibold" : "text-muted"}`}>{unidadesDe(l)} unidad{unidadesDe(l) === 1 ? "" : "es"} · hay {existenciasTexto(l.p.unidades, l.p.unidades_por_caja)}{l.p.ubicacion ? ` · ubicación ${l.p.ubicacion}` : ""}</p>
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                      <span className="sr-only">Cantidad de {l.p.nombre}</span>
                      <input type="number" min={1} max={100000} inputMode="numeric" className="campo !h-10 w-24 num" value={l.cantidad} onChange={(e) => cambiar(i, Number(e.target.value))} />
                      <span className="text-muted">{l.presentacion === "caja" && l.p.unidades_por_caja > 1 ? `caja${l.cantidad === 1 ? "" : "s"}` : "und"}</span>
                    </label>
                    <button type="button" onClick={() => quitar(i)} className="text-sm font-semibold text-alerta" aria-label={`Quitar ${l.p.nombre}`}>Quitar</button>
                  </li>
                );
              })}
            </ul>
          ) : <p className="mt-3 text-muted text-sm">Busca y agrega los productos que salen. Puedes usar el lector de código de barras.</p>}
        </section>
        {pideFormula(ex) && (
          <div className="-mx-4 sm:-mx-6"><PanelFormula ex={ex} cfg={cfg} datos={formula} onCambio={(d) => { setFormula(d); setError(""); }} falta={faltaFormula} sinRed={false} doc="entrega" verbo="entregar" /></div>
        )}
      </div>

      <section className="tarjeta p-5 grid gap-3 xl:sticky xl:top-4" aria-labelledby="destino-titulo">
        <h2 id="destino-titulo" className="titulo text-xl">A quién se entrega</h2>
        <div>
          <label htmlFor="e-tipo" className="etiqueta">Se entrega a</label>
          <select id="e-tipo" className="campo" value={tipo} onChange={(e) => set("destinatario_tipo", e.target.value as TipoDestinatario)}>
            {Object.entries(DESTINATARIOS).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
          </select>
        </div>
        <div>
          <label htmlFor="e-nombre" className="etiqueta">{ETIQUETA_NOMBRE[tipo]}</label>
          <input id="e-nombre" className="campo" autoComplete="off" maxLength={120} value={datos.destinatario} onChange={(e) => set("destinatario", e.target.value)} />
        </div>
        {(tipo === "paciente" || tipo === "empleado" || tipo === "otro") && (
          <div>
            <label htmlFor="e-doc" className="etiqueta">Documento (opcional)</label>
            <input id="e-doc" className="campo num" autoComplete="off" maxLength={30} value={datos.documento} onChange={(e) => set("documento", e.target.value.toUpperCase())} />
          </div>
        )}
        {tipo !== "servicio" && (
          <div>
            <label htmlFor="e-servicio" className="etiqueta">Servicio o área (opcional)</label>
            <input id="e-servicio" className="campo" autoComplete="off" maxLength={80} placeholder="Urgencias, hospitalización, cirugía…" value={datos.servicio} onChange={(e) => set("servicio", e.target.value)} />
          </div>
        )}
        <div>
          <label htmlFor="e-autoriza" className="etiqueta">Autoriza</label>
          <input id="e-autoriza" className="campo" autoComplete="off" maxLength={120} placeholder="Nombre y cargo" value={datos.autoriza} onChange={(e) => set("autoriza", e.target.value)} />
        </div>
        <div>
          <label htmlFor="e-obs" className="etiqueta">Observación (opcional)</label>
          <textarea id="e-obs" className="campo !h-20 py-2" maxLength={300} value={datos.observacion} onChange={(e) => set("observacion", e.target.value)} />
        </div>
        <p className="text-sm text-muted">{lineas.length} producto{lineas.length === 1 ? "" : "s"} · <span className="num font-semibold text-ink">{total.toLocaleString("es-CO")}</span> unidad{total === 1 ? "" : "es"}</p>
        {error && <p role="alert" className="rounded-lg bg-alerta-soft px-3 py-2 text-sm font-semibold text-alerta">{error}</p>}
        <button disabled={enviando} className="btn-primario h-12 disabled:opacity-60">{enviando ? "Registrando…" : "Registrar la entrega"}</button>
        <p className="text-[13px] text-muted">Es una salida interna de inventario: no es una factura de venta y no va a la DIAN.</p>
      </section>
    </form>
  );
}
