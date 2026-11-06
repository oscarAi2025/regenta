"use client";
import { useState } from "react";

type Codigo = { id: number; codigo: string; creado: string };

/** Códigos de barras alternos del producto: la caja, la búsqueda, la caja sin internet y la importación lo encuentran
 *  también por estos códigos (otra presentación, el código del distribuidor, uno interno). */
export function Codigos({ productoId, principal, inicial }: { productoId: string; principal: string | null; inicial: Codigo[] }) {
  const [lista, setLista] = useState(inicial);
  const [nuevo, setNuevo] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);

  async function enviar(metodo: "POST" | "DELETE", cuerpo: object) {
    setEnviando(true); setError("");
    const r = await fetch(`/api/productos/${productoId}/codigos`, { method: metodo, headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) }).catch(() => null);
    const j = await r?.json().catch(() => ({}));
    setEnviando(false);
    if (!r) { setError("Sin conexión: revisa internet e intenta de nuevo."); return false; }
    if (!r.ok) { setError(j?.error ?? "No se pudo guardar"); return false; }
    setLista(j.codigos ?? []); return true;
  }

  return (
    <section aria-labelledby="codigos-t" className="tarjeta p-5 grid gap-3 max-w-3xl">
      <div>
        <h2 id="codigos-t" className="titulo text-xl">Códigos de barras alternos</h2>
        <p className="text-sm text-muted mt-0.5">Si el mismo producto llega con otro código (otra presentación, otro distribuidor), agrégalo aquí: el lector de la caja lo encuentra igual, también sin internet.
          {principal ? <> Código principal: <span className="num font-semibold text-ink">{principal}</span>.</> : " Este producto no tiene código principal."}</p>
      </div>
      {lista.length > 0 ? (
        <ul aria-label="Códigos alternos" className="flex flex-wrap gap-2">
          {lista.map((c) => (
            <li key={c.id} className="inline-flex items-center gap-2 rounded-lg border border-line bg-paper pl-3 pr-1 h-9 max-w-full">
              <span className="num font-semibold truncate">{c.codigo}</span>
              <button type="button" disabled={enviando} onClick={() => void enviar("DELETE", { codigo_id: c.id })} aria-label={`Quitar el código ${c.codigo}`}
                className="h-7 w-7 rounded-md text-muted hover:text-alerta hover:bg-alerta-soft grid place-items-center shrink-0" title="Quitar">×</button>
            </li>
          ))}
        </ul>
      ) : <p className="text-sm text-muted">Todavía no tiene códigos alternos.</p>}
      <form className="flex flex-wrap gap-2 items-end" onSubmit={async (e) => { e.preventDefault(); if (await enviar("POST", { codigo: nuevo })) setNuevo(""); }}>
        <div className="grow min-w-0 basis-56">
          <label htmlFor="codigo-alterno" className="etiqueta">Agregar un código</label>
          <input id="codigo-alterno" className="campo num" value={nuevo} onChange={(e) => setNuevo(e.target.value)} placeholder="Escanéalo o escríbelo" autoComplete="off" maxLength={40} />
        </div>
        <button className="btn-borde" disabled={enviando || nuevo.trim().length < 3}>{enviando ? "Guardando…" : "Agregar código"}</button>
      </form>
      {error && <p role="alert" className="text-sm text-alerta font-semibold">{error}</p>}
    </section>
  );
}
