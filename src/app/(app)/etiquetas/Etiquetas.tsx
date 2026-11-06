"use client";
import { useEffect, useMemo, useState } from "react";
import { FORMATOS, documentoImpresion, estilosEtiquetas, hojasHtml, type DatoEtiqueta, type Formato } from "@/lib/etiquetas";
import { pesosMano } from "@/lib/precios";

type Item = DatoEtiqueta & { copias: number };
type Compra = { numero: number; proveedor: string; factura: string; anulada: boolean } | null;
const CLAVE = "regenta.etiquetas.formato";

/** Arma la lista de etiquetas (por producto o lo recibido en una compra), muestra la hoja tal como sale y la imprime. */
export function Etiquetas({ inicial, compra }: { inicial: Item[]; compra: Compra }) {
  const [lista, setLista] = useState<Item[]>(inicial);
  const [formato, setFormato] = useState<Formato>("a4");
  const [q, setQ] = useState(""); const [res, setRes] = useState<{ id: string; nombre: string; laboratorio: string | null; exacto?: boolean }[]>([]);
  const [error, setError] = useState("");

  useEffect(() => { try { const f = localStorage.getItem(CLAVE); if (f === "a4" || f === "rollo") setFormato(f); } catch {} }, []);
  const elegir = (f: Formato) => { setFormato(f); try { localStorage.setItem(CLAVE, f); } catch {} };

  useEffect(() => {
    if (q.trim().length < 2) { setRes([]); return; }
    const ctl = new AbortController();
    const t = setTimeout(() => fetch(`/api/productos?q=${encodeURIComponent(q)}`, { signal: ctl.signal }).then((r) => r.json()).then((j) => {
      const ps = j.productos ?? [];
      if (ps[0]?.exacto) { void agregar(ps[0].id); return; }
      setRes(ps.slice(0, 8));
    }).catch(() => {}), 160);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  async function agregar(id: string) {
    setQ(""); setRes([]); setError("");
    const ya = lista.find((x) => x.id === id);
    if (ya) { setLista((l) => l.map((x) => (x.id === id ? { ...x, copias: Math.min(x.copias + 1, 99) } : x))); return; }
    const r = await fetch(`/api/etiquetas?ids=${id}`).catch(() => null);
    const j = await r?.json().catch(() => ({}));
    if (!r?.ok) { setError(j?.error ?? "No se pudo traer el producto. Revisa la conexión."); return; }
    const p = j.productos?.[0];
    if (p) setLista((l) => (l.some((x) => x.id === p.id) ? l : [...l, { ...p, copias: 1 }]));
  }
  const copias = (id: string, v: number) => setLista((l) => l.map((x) => (x.id === id ? { ...x, copias: Math.max(1, Math.min(99, v || 1)) } : x)));

  const expandidas = useMemo(() => lista.flatMap((p) => Array.from({ length: p.copias }, () => p)), [lista]);
  const hojas = useMemo(() => hojasHtml(expandidas, formato), [expandidas, formato]);
  const m = FORMATOS[formato];

  function imprimir() {
    const f = document.createElement("iframe");
    f.title = "Etiquetas"; f.setAttribute("aria-hidden", "true");
    Object.assign(f.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" });
    f.onload = () => setTimeout(() => { try { f.contentWindow?.print(); } catch {} }, 250);
    f.srcdoc = documentoImpresion(expandidas, formato);
    document.body.appendChild(f);
    setTimeout(() => f.remove(), 120000);
  }

  return (
    <div className="grid gap-4 max-w-5xl">
      {compra && (
        <p role="status" className={`rounded-xl px-4 py-3 font-semibold ${compra.anulada ? "bg-aviso-soft text-aviso" : "bg-cruz-soft text-cruz"}`}>
          Lo recibido en la compra N.º {compra.numero} · {compra.proveedor} · factura {compra.factura}{compra.anulada ? " (compra anulada)" : ""}: {lista.length} producto{lista.length === 1 ? "" : "s"}.
        </p>
      )}
      <section className="tarjeta p-4 sm:p-5 grid gap-3" aria-labelledby="et-productos-t">
        <h2 id="et-productos-t" className="titulo text-xl">Productos</h2>
        <div className="relative">
          <label htmlFor="buscar-etiqueta" className="etiqueta">Agregar producto</label>
          <input id="buscar-etiqueta" className="campo" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Escanea o escribe el nombre" autoComplete="off" />
          {res.length > 0 && (
            <ul aria-label="Resultados" className="absolute z-10 mt-1 w-full tarjeta shadow-lg divide-y divide-line max-h-80 overflow-auto">
              {res.map((p) => <li key={p.id}><button type="button" onClick={() => void agregar(p.id)} className="w-full text-left px-4 py-2.5 hover:bg-paper"><span className="font-semibold">{p.nombre}</span><span className="block text-sm text-muted">{p.laboratorio ?? "Genérico"}</span></button></li>)}
            </ul>
          )}
        </div>
        {error && <p role="alert" className="text-sm text-alerta font-semibold">{error}</p>}
        {lista.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line p-6 text-center text-muted">Escanea los productos que necesitan etiqueta, o ábrela desde una compra con «Imprimir etiquetas de lo recibido».</p>
        ) : (
          <ul className="divide-y divide-line rounded-xl border border-line" aria-label="Etiquetas a imprimir">
            {lista.map((p) => (
              <li key={p.id} className="px-3 py-2.5 flex flex-wrap items-center gap-x-3 gap-y-2">
                <div className="min-w-0 flex-1 basis-56">
                  <p className="font-semibold leading-snug">{p.nombre}</p>
                  <p className="text-sm text-muted num">{pesosMano(p.precio_caja)}{p.precio_unidad !== null && p.unidades_por_caja > 1 ? ` · unidad ${pesosMano(p.precio_unidad)}` : ""}{!p.ean && !p.codigos.length ? " · sin código de barras" : ""}</p>
                </div>
                <label className="flex items-center gap-2 text-sm"><span>Copias</span>
                  <input type="number" min={1} max={99} inputMode="numeric" value={p.copias} onChange={(e) => copias(p.id, Math.floor(Number(e.target.value)))} className="campo num w-20 h-10 text-center" aria-label={`Copias de ${p.nombre}`} />
                </label>
                <button type="button" onClick={() => setLista((l) => l.filter((x) => x.id !== p.id))} className="text-sm text-alerta underline" aria-label={`Quitar ${p.nombre}`}>Quitar</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="tarjeta p-4 sm:p-5 grid gap-3" aria-labelledby="et-formato-t">
        <fieldset>
          <legend id="et-formato-t" className="titulo text-xl">Formato</legend>
          <div className="grid sm:grid-cols-2 gap-2 mt-2">
            {(Object.keys(FORMATOS) as Formato[]).map((f) => (
              <label key={f} className={`flex items-center gap-2.5 rounded-xl border-2 px-3 py-2.5 cursor-pointer font-semibold has-[:focus-visible]:outline has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-marca ${formato === f ? "border-ink bg-paper" : "border-line bg-surface hover:border-ink/50"}`}>
                <input type="radio" name="formato" value={f} checked={formato === f} onChange={() => elegir(f)} className="accent-[var(--ink)] w-4 h-4 shrink-0" />{FORMATOS[f].nombre}
              </label>
            ))}
          </div>
        </fieldset>
        <div className="flex flex-wrap items-center gap-3">
          <button type="button" onClick={imprimir} disabled={!expandidas.length} className="btn-primario">Imprimir {expandidas.length} etiqueta{expandidas.length === 1 ? "" : "s"}</button>
          <p className="text-sm text-muted">{formato === "a4" ? `${hojas.length} hoja${hojas.length === 1 ? "" : "s"} A4. Imprime al 100 % (sin «ajustar a la página»).` : "Una etiqueta por página de 50 × 25 mm: elige ese tamaño de papel en la impresora de etiquetas."}</p>
        </div>
      </section>

      {expandidas.length > 0 && (
        <section aria-labelledby="et-vista-t" className="grid gap-2">
          <h2 id="et-vista-t" className="titulo text-xl">Así salen</h2>
          <style>{estilosEtiquetas(formato)}</style>
          <div className="relative overflow-auto rounded-xl border border-line bg-paper p-3 max-h-[80vh]" data-prueba="vista-etiquetas">
            <div className={`grid gap-3 ${formato === "rollo" ? "grid-cols-[repeat(auto-fill,minmax(50mm,1fr))] justify-items-start" : "justify-items-start"}`}>
              {hojas.map((h, i) => <div key={i} className="shadow-sm ring-1 ring-line" style={formato === "rollo" ? { width: `${m.ancho}mm` } : undefined} dangerouslySetInnerHTML={{ __html: h }} />)}
            </div>
          </div>
        </section>
      )}
    </div>
  );
}
