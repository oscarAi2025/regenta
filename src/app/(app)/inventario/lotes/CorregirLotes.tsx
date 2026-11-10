"use client";
import { useEffect, useState } from "react";
import { useRefrescar } from "@/lib/refrescar";

type Prod = { id: string; nombre: string; laboratorio: string | null; exacto?: boolean };
type Lote = { lote_id: string; lote: string; vence: string | null; unidades: number; bloqueado: boolean; vencido: boolean };

const fecha = (d: string | null) => (d ? new Date(d + "T00:00:00").toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" }) : "sin fecha");

/** Buscar un producto, ver sus lotes y corregir el código o la fecha de vencimiento de uno (con motivo). */
export function CorregirLotes({ inicial }: { inicial?: Prod | null }) {
  const refrescar = useRefrescar();
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Prod[]>([]);
  const [prod, setProd] = useState<Prod | null>(null);
  const [lotes, setLotes] = useState<Lote[]>([]);
  const [editando, setEditando] = useState<string | null>(null);
  const [codigo, setCodigo] = useState("");
  const [vence, setVence] = useState("");
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [guardando, setGuardando] = useState(false);

  useEffect(() => { if (inicial) void elegir(inicial); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (q.trim().length < 2) { setRes([]); return; }
    const ctl = new AbortController();
    const t = setTimeout(() => {
      fetch(`/api/productos?q=${encodeURIComponent(q)}`, { signal: ctl.signal }).then((r) => r.json()).then((j) => {
        const ps: Prod[] = j.productos ?? [];
        if (ps[0]?.exacto) { void elegir(ps[0]); return; }
        setRes(ps.slice(0, 8));
      }).catch(() => {});
    }, 160);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  async function cargar(p: Prod) {
    const r = await fetch(`/api/inventario/lotes?producto=${p.id}`).catch(() => null);
    const j = await r?.json().catch(() => ({}));
    if (!r?.ok) { setError(j?.error ?? "No se pudieron traer los lotes. Revisa la conexión."); return; }
    setLotes(j.lotes ?? []);
  }

  async function elegir(p: Prod) {
    setQ(""); setRes([]); setError(""); setAviso(""); setEditando(null); setProd(p); setLotes([]);
    await cargar(p);
  }

  function abrir(l: Lote) {
    setEditando(l.lote_id); setCodigo(l.lote); setVence(l.vence ?? ""); setMotivo(""); setError(""); setAviso("");
    setTimeout(() => document.getElementById("corregir-vence")?.focus(), 0);
  }

  async function guardar(l: Lote) {
    setError("");
    if (!codigo.trim()) { setError("Escribe el código del lote."); return; }
    if (!vence) { setError("Escribe la fecha de vencimiento."); return; }
    if (motivo.trim().length < 4) { setError("Escribe por qué corriges el lote (por ejemplo: «fecha mal digitada, se revisó la caja»)."); document.getElementById("corregir-motivo")?.focus(); return; }
    setGuardando(true);
    const r = await fetch(`/api/inventario/lotes/${l.lote_id}`, { method: "PATCH", headers: { "content-type": "application/json" },
      body: JSON.stringify({ lote: codigo.trim(), vence, motivo: motivo.trim() }) }).catch(() => null);
    setGuardando(false);
    const j = await r?.json().catch(() => ({}));
    if (!r?.ok) { setError(j?.error ?? "Sin conexión: revisa internet y vuelve a guardar."); return; }
    // Primero la lista al día; después el aviso (que nunca anuncie algo que la lista todavía no muestra).
    if (prod) await cargar(prod);
    setEditando(null);
    setAviso(`Lote ${j.lote.lote} corregido: vence ${fecha(j.lote.vence)}. Quedó registrado en la auditoría.`);
    void refrescar();
  }

  return (
    <div className="grid gap-4 max-w-4xl">
      <section className="tarjeta p-4 sm:p-5 grid gap-3">
        <div className="relative">
          <label htmlFor="buscar-lote" className="etiqueta">Producto</label>
          <input id="buscar-lote" value={q} onChange={(e) => setQ(e.target.value)} className="campo h-12 text-lg" placeholder="Escanea o escribe el nombre" autoComplete="off" />
          {res.length > 0 && (
            <ul aria-label="Resultados" className="absolute z-10 mt-1 w-full tarjeta shadow-lg divide-y divide-line max-h-80 overflow-auto">
              {res.map((p) => <li key={p.id}><button type="button" onClick={() => void elegir(p)} className="w-full text-left px-4 py-2.5 hover:bg-paper"><span className="font-semibold">{p.nombre}</span><span className="block text-sm text-muted">{p.laboratorio ?? "Sin laboratorio"}</span></button></li>)}
            </ul>
          )}
        </div>
      </section>

      {aviso && <p role="status" className="rounded-xl bg-cruz-soft text-cruz px-4 py-3 font-semibold">{aviso}</p>}
      {error && !editando && <p role="alert" className="text-alerta font-semibold">{error}</p>}

      {prod && (
        <section className="tarjeta p-4 sm:p-5 grid gap-3" aria-label={`Lotes de ${prod.nombre}`}>
          <h2 className="titulo text-xl">{prod.nombre}</h2>
          {lotes.length === 0 ? <p className="text-muted">Este producto no tiene lotes registrados.</p> : (
            <ul className="grid gap-2">
              {lotes.map((l) => (
                <li key={l.lote_id} className="rounded-xl border border-line p-3 grid gap-3">
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                    <p className="flex-1 min-w-[200px]"><span className="font-semibold">Lote {l.lote}</span>
                      <span className={`block text-sm ${l.vencido ? "text-alerta font-semibold" : "text-muted"}`}>Vence {fecha(l.vence)}{l.vencido ? " · vencido" : ""} · {l.unidades.toLocaleString("es-CO")} und{l.bloqueado ? " · separado" : ""}</span></p>
                    {editando !== l.lote_id && <button type="button" onClick={() => abrir(l)} className="btn-borde h-10 text-sm" aria-label={`Corregir el lote ${l.lote}`}>Corregir</button>}
                  </div>
                  {editando === l.lote_id && (
                    <form onSubmit={(e) => { e.preventDefault(); void guardar(l); }} className="grid gap-3 sm:grid-cols-2">
                      <div><label htmlFor="corregir-codigo" className="etiqueta">Código del lote</label>
                        <input id="corregir-codigo" value={codigo} onChange={(e) => setCodigo(e.target.value.toUpperCase())} maxLength={60} className="campo" /></div>
                      <div><label htmlFor="corregir-vence" className="etiqueta">Fecha de vencimiento</label>
                        <input id="corregir-vence" type="date" value={vence} onChange={(e) => setVence(e.target.value)} className="campo" /></div>
                      <div className="sm:col-span-2"><label htmlFor="corregir-motivo" className="etiqueta">Motivo de la corrección</label>
                        <input id="corregir-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={200} className="campo" placeholder="Por ejemplo: fecha mal digitada, se revisó la caja" /></div>
                      {error && <p role="alert" className="sm:col-span-2 text-alerta font-semibold">{error}</p>}
                      <div className="sm:col-span-2 flex flex-wrap gap-2">
                        <button type="submit" disabled={guardando} className="btn-primario">{guardando ? "Guardando…" : "Guardar corrección"}</button>
                        <button type="button" onClick={() => { setEditando(null); setError(""); }} className="btn-borde">Cancelar</button>
                      </div>
                    </form>
                  )}
                </li>
              ))}
            </ul>
          )}
          <p className="text-sm text-muted">Las existencias no cambian al corregir un lote: para sumar o restar unidades usa «Ajustar o dar de baja».</p>
        </section>
      )}
    </div>
  );
}
