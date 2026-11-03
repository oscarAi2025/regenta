"use client";
import { useEffect, useRef, useState } from "react";

type Prod = { id: string; nombre: string; laboratorio: string | null; ean: string | null; unidades_por_caja: number; unidades: number };
type Linea = { key: number; p: Prod; lote: string; vence: string; cajas: string; sueltas: string; costo: string };

const n = (s: string) => Number(String(s).replace(/\D/g, "")) || 0;
const fmt = (s: string) => (s.replace(/\D/g, "") ? Number(s.replace(/\D/g, "")).toLocaleString("es-CO") : "");

export function Recibir({ verCosto, proveedores = [] }: { verCosto: boolean; proveedores?: string[] }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Prod[]>([]);
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [proveedor, setProveedor] = useState("");
  const [factura, setFactura] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [hecho, setHecho] = useState<number | null>(null);
  const buscar = useRef<HTMLInputElement>(null);
  const clave = useRef(0);
  const idem = useRef(crypto.randomUUID()); // misma clave si se reintenta tras un corte; nueva tras guardar

  useEffect(() => {
    if (q.trim().length < 2) { setRes([]); return; }
    const ctl = new AbortController();
    const t = setTimeout(() => fetch(`/api/productos?q=${encodeURIComponent(q)}`, { signal: ctl.signal }).then((r) => r.json()).then((j) => {
      const ps: (Prod & { exacto: boolean })[] = j.productos ?? [];
      if (ps[0]?.exacto) { agregar(ps[0]); return; } // lector de código de barras: entra directo
      setRes(ps.slice(0, 8));
    }).catch(() => {}), 160);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  function agregar(p: Prod) {
    const key = ++clave.current;
    setLineas((ls) => [...ls, { key, p, lote: "", vence: "", cajas: "", sueltas: "", costo: "" }]);
    setQ(""); setRes([]); setHecho(null);
    setTimeout(() => document.getElementById(`lote-${key}`)?.focus(), 0);
  }
  const cambiar = (key: number, k: keyof Linea, v: string) => setLineas((ls) => ls.map((l) => (l.key === key ? { ...l, [k]: v } : l)));
  const unidades = (l: Linea) => n(l.cajas) * l.p.unidades_por_caja + n(l.sueltas);

  async function guardar() {
    setError("");
    const mal = lineas.find((l) => !l.lote.trim() || unidades(l) <= 0);
    if (mal) { setError(`Falta ${!mal.lote.trim() ? "el lote" : "la cantidad"} de ${mal.p.nombre}.`); document.getElementById(`lote-${mal.key}`)?.focus(); return; }
    const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });
    const vencida = lineas.find((l) => l.vence && l.vence < hoy);
    if (vencida) { setError(`${vencida.p.nombre}: el lote ${vencida.lote.trim()} ya está vencido. La mercancía vencida no se recibe para la venta.`); document.getElementById(`vence-${vencida.key}`)?.focus(); return; }
    setEnviando(true);
    let r: Response;
    try {
    r = await fetch("/api/inventario", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
      tipo: "compra", proveedor: proveedor.trim() || null, factura: factura.trim() || null, idem_key: idem.current,
      lineas: lineas.map((l) => ({ producto_id: l.p.id, lote: l.lote.trim(), vence: l.vence || null, unidades: unidades(l),
        ...(verCosto && n(l.costo) ? { costo_unidad: Math.round((n(l.costo) / (n(l.cajas) && !n(l.sueltas) && l.p.unidades_por_caja > 1 ? l.p.unidades_por_caja : 1)) * 10000) / 10000 } : {}) })) }) });
    } catch { setEnviando(false); setError("Sin conexión: revisa internet y vuelve a guardar (no se duplicará)."); return; }
    setEnviando(false);
    if (!r.ok) { setError((await r.json().catch(() => ({}))).error ?? "No se pudo guardar la entrada"); return; }
    setHecho(lineas.reduce((a, l) => a + unidades(l), 0)); setLineas([]); setProveedor(""); setFactura(""); idem.current = crypto.randomUUID();
    buscar.current?.focus();
  }

  const total = lineas.reduce((a, l) => a + unidades(l), 0);

  return (
    <div className="grid gap-4 max-w-5xl">
      {hecho !== null && <p role="status" className="rounded-xl bg-cruz-soft text-cruz font-semibold px-4 py-3">Entrada guardada: {hecho.toLocaleString("es-CO")} unidades ya están disponibles para vender.</p>}
      <section className="tarjeta p-4 sm:p-5 grid sm:grid-cols-[1fr_360px] gap-3">
        <div className="relative">
          <label htmlFor="buscar-recibir" className="etiqueta">Producto</label>
          <input id="buscar-recibir" ref={buscar} autoFocus value={q} onChange={(e) => setQ(e.target.value)} className="campo h-12 text-lg" placeholder="Escanea o escribe el nombre" autoComplete="off" />
          {res.length > 0 && (
            <ul className="absolute z-10 mt-1 w-full tarjeta shadow-lg divide-y divide-line max-h-80 overflow-auto">
              {res.map((p) => <li key={p.id}><button onClick={() => agregar(p)} className="w-full text-left px-4 py-2.5 hover:bg-paper"><span className="font-semibold">{p.nombre}</span><span className="block text-sm text-muted">{p.laboratorio ?? "Genérico"} · hay {p.unidades} und</span></button></li>)}
            </ul>
          )}
          {q.trim().length >= 2 && res.length === 0 && <p className="text-sm text-muted mt-2">¿No aparece? Créalo primero en <a href="/productos/nuevo" className="underline">Productos → Agregar</a>.</p>}
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_110px] gap-2">
          <div><label htmlFor="proveedor" className="etiqueta">Proveedor</label><input id="proveedor" list="proveedores-lista" value={proveedor} onChange={(e) => setProveedor(e.target.value)} className="campo h-12" placeholder="Elige o escribe" autoComplete="off" />
            <datalist id="proveedores-lista">{proveedores.map((x) => <option key={x} value={x} />)}</datalist></div>
          <div><label htmlFor="factura" className="etiqueta">Factura</label><input id="factura" value={factura} onChange={(e) => setFactura(e.target.value)} className="campo h-12" placeholder="N.º" autoComplete="off" /></div>
        </div>
      </section>

      {lineas.length === 0 ? (
        <p className="tarjeta p-8 text-center text-muted">Cada producto que escanees aparece aquí para ponerle lote, vencimiento y cantidad.</p>
      ) : (
        <section className="grid gap-3">
          {lineas.map((l) => (
            <article key={l.key} className="tarjeta p-4 grid gap-3">
              <div className="flex items-start gap-3"><div className="flex-1"><p className="font-semibold">{l.p.nombre}</p><p className="text-sm text-muted">{l.p.laboratorio ?? "Genérico"}{l.p.unidades_por_caja > 1 ? ` · caja x ${l.p.unidades_por_caja}` : ""}</p></div>
                <button onClick={() => setLineas((ls) => ls.filter((x) => x.key !== l.key))} className="text-sm text-alerta underline" aria-label={`Quitar ${l.p.nombre}`}>Quitar</button></div>
              <div className={`grid grid-cols-2 ${verCosto ? "md:grid-cols-5" : "md:grid-cols-4"} gap-3`}>
                <div><label htmlFor={`lote-${l.key}`} className="etiqueta">Lote</label><input id={`lote-${l.key}`} value={l.lote} onChange={(e) => cambiar(l.key, "lote", e.target.value.toUpperCase())} className="campo" /></div>
                <div><label htmlFor={`vence-${l.key}`} className="etiqueta">Vence</label><input id={`vence-${l.key}`} type="date" value={l.vence} onChange={(e) => cambiar(l.key, "vence", e.target.value)} className="campo" /></div>
                {l.p.unidades_por_caja > 1 && <div><label htmlFor={`cajas-${l.key}`} className="etiqueta">Cajas</label><input id={`cajas-${l.key}`} inputMode="numeric" value={l.cajas} onChange={(e) => cambiar(l.key, "cajas", e.target.value.replace(/\D/g, ""))} className="campo num" /></div>}
                <div><label htmlFor={`sueltas-${l.key}`} className="etiqueta">{l.p.unidades_por_caja > 1 ? "Unidades sueltas" : "Unidades"}</label><input id={`sueltas-${l.key}`} inputMode="numeric" value={l.sueltas} onChange={(e) => cambiar(l.key, "sueltas", e.target.value.replace(/\D/g, ""))} className="campo num" /></div>
                {verCosto && <div><label htmlFor={`costo-${l.key}`} className="etiqueta">Costo {l.p.unidades_por_caja > 1 && n(l.cajas) && !n(l.sueltas) ? "por caja" : "por unidad"}</label><input id={`costo-${l.key}`} inputMode="numeric" value={fmt(l.costo)} onChange={(e) => cambiar(l.key, "costo", e.target.value)} className="campo num" placeholder="$" /></div>}
              </div>
              <p className="text-sm text-muted num">Entran {unidades(l).toLocaleString("es-CO")} unidades{l.vence && Date.parse(l.vence) < Date.now() - 864e5 ? <span className="text-alerta font-semibold"> · ya está vencido: no se puede recibir</span> : l.vence && Date.parse(l.vence) < Date.now() + 90 * 864e5 ? <span className="text-aviso font-semibold"> · vence en menos de 90 días</span> : null}</p>
            </article>
          ))}
          {error && <p role="alert" className="text-alerta">{error}</p>}
          <div className="tarjeta p-4 flex flex-wrap items-center gap-3 sticky bottom-3">
            <p className="flex-1 font-semibold num">{lineas.length} producto{lineas.length === 1 ? "" : "s"} · {total.toLocaleString("es-CO")} unidades</p>
            <button onClick={guardar} disabled={enviando} className="btn-primario">{enviando ? "Guardando…" : "Guardar entrada"}</button>
          </div>
        </section>
      )}
    </div>
  );
}
