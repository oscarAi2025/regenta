"use client";
import { useState } from "react";

type Caja = { id: string; nombre: string; activa: boolean; turno_abierto: boolean };

async function enviar(metodo: string, cuerpo: unknown) {
  const r = await fetch("/api/cajas", { method: metodo, headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) }).catch(() => null);
  if (!r) return { error: "Sin conexión: revisa internet e intenta de nuevo." };
  const j = await r.json().catch(() => ({}));
  return r.ok ? j : { error: j.error ?? "No se pudo guardar" };
}

/** Cajas de la droguería: cada una con su turno y su cajón; comparten inventario y numeración DIAN. */
export function Cajas({ cajas, tope, plan, demo }: { cajas: Caja[]; tope: number | null; plan: string; demo: boolean }) {
  const [nueva, setNueva] = useState(""), [abierto, setAbierto] = useState(false);
  const [editando, setEditando] = useState<string | null>(null), [nombre, setNombre] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null), [enviando, setEnviando] = useState(false);
  const activas = cajas.filter((c) => c.activa).length;
  const lleno = tope !== null && activas >= tope;
  async function hacer(metodo: string, cuerpo: unknown, ok?: string) {
    setEnviando(true); setMsg(null);
    const r = await enviar(metodo, cuerpo);
    setEnviando(false);
    if (r.error) { setMsg({ ok: false, t: r.error }); return false; }
    setMsg({ ok: true, t: r.mensaje ?? ok ?? "Guardado" });
    setTimeout(() => location.reload(), 1200);
    return true;
  }
  return (
    <section className="tarjeta p-5" aria-label="Cajas">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="titulo text-xl">Cajas</h2>
          <p className="text-sm text-muted">
            {activas} caja{activas === 1 ? "" : "s"} activa{activas === 1 ? "" : "s"}{tope !== null ? ` de ${tope} en tu plan` : ""}. Cada caja tiene su turno y su cajón; todas venden del mismo inventario.
            {plan === "esencial" && " Con Pro tienes hasta 3 cajas."}
          </p>
        </div>
        {!abierto && (
          lleno && !demo
            ? <a href="/contratar?plan=pro" className="btn-borde">Pasar a Pro para más cajas</a>
            : <button onClick={() => setAbierto(true)} className="btn-primario">Agregar caja</button>
        )}
      </div>
      {abierto && (
        <form onSubmit={async (e) => { e.preventDefault(); if (await hacer("POST", { nombre: nueva })) { setNueva(""); setAbierto(false); } }} className="mt-4 flex flex-wrap gap-2 items-end" aria-label="Agregar caja">
          <div className="flex-1 min-w-48"><label htmlFor="cj-nombre" className="etiqueta">Nombre de la caja</label><input id="cj-nombre" className="campo" required maxLength={40} placeholder={`Caja ${activas + 1}`} value={nueva} onChange={(e) => setNueva(e.target.value)} /></div>
          <button disabled={enviando} className="btn-primario">{enviando ? "Creando…" : "Crear caja"}</button>
          <button type="button" onClick={() => setAbierto(false)} className="btn-borde">Cancelar</button>
        </form>
      )}
      {msg && <p role={msg.ok ? "status" : "alert"} className={`mt-3 text-sm font-semibold ${msg.ok ? "text-cruz" : "text-alerta"}`}>{msg.t}</p>}
      <ul className="mt-4 divide-y divide-line">
        {cajas.map((c) => (
          <li key={c.id} className="py-2.5 flex flex-wrap items-center gap-3">
            {editando === c.id ? (
              <form onSubmit={async (e) => { e.preventDefault(); if (await hacer("PATCH", { id: c.id, nombre }, "Nombre cambiado")) setEditando(null); }} className="flex flex-1 gap-2">
                <label htmlFor={`cj-${c.id}`} className="sr-only">Nuevo nombre</label>
                <input id={`cj-${c.id}`} className="campo h-9 py-1 flex-1" value={nombre} maxLength={40} onChange={(e) => setNombre(e.target.value)} autoFocus />
                <button className="btn-primario h-9 text-sm">Guardar</button>
                <button type="button" onClick={() => setEditando(null)} className="btn-borde h-9 text-sm">Cancelar</button>
              </form>
            ) : (
              <>
                <span className={`flex-1 font-semibold ${c.activa ? "" : "text-muted line-through"}`}>{c.nombre}</span>
                {c.turno_abierto && <span className="text-sm text-cruz font-semibold">Turno abierto</span>}
                {!c.activa && <span className="text-sm text-muted">Desactivada</span>}
                <button onClick={() => { setEditando(c.id); setNombre(c.nombre); }} className="text-sm font-semibold text-cruz">Renombrar</button>
                <button onClick={() => hacer("PATCH", { id: c.id, activa: !c.activa }, c.activa ? "Caja desactivada" : "Caja activada")} disabled={enviando} className="text-sm font-semibold text-muted hover:text-ink">{c.activa ? "Desactivar" : "Activar"}</button>
              </>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
