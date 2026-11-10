"use client";
import { useState } from "react";
import { pct, pesosMano } from "@/lib/precios";
import type { LineaCambio } from "@/lib/precios-datos";

type Cambio = { id: string; numero: number; descripcion: string; productos: number; fecha: string; responsable: string | null; revertido: string | null; revertidos: number | null; lineas: LineaCambio[] };
type Conflicto = { producto_id: string; nombre: string; caja_hoy: number; caja_despues: number };

const margen = (precio: number, iva: number, costo: number | null, upc: number) => {
  if (costo === null || !precio) return null;
  const sin = precio / (1 + iva / 100);
  return Math.round(((sin - costo * upc) / sin) * 1000) / 10;
};

/** Detalle de un cambio masivo y su reversión (la API devuelve el cambio actualizado: la pantalla no depende de recargar). */
export function DetalleCambio({ inicial, aplicado }: { inicial: Cambio; aplicado: boolean }) {
  const [c, setC] = useState(inicial);
  const [confirmar, setConfirmar] = useState(false);
  const [conflictos, setConflictos] = useState<Conflicto[]>([]);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState(aplicado ? `Listo: cambió el precio de ${inicial.productos} producto${inicial.productos === 1 ? "" : "s"}. La caja ya cobra los precios nuevos.` : "");
  const [enviando, setEnviando] = useState(false);

  async function revertir(parcial: boolean) {
    setEnviando(true); setError(""); setAviso("");
    const r = await fetch(`/api/precios/${c.id}/revertir`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ parcial }) }).catch(() => null);
    const j = await r?.json().catch(() => ({}));
    setEnviando(false); setConfirmar(false);
    if (!r) { setError("Sin conexión: revisa internet e intenta de nuevo."); return; }
    if (r.status === 409 && j?.conflictos) { setConflictos(j.conflictos); setError(j.error); return; }
    if (!r.ok) { setError(j?.error ?? "No se pudo revertir"); return; }
    setConflictos([]); setC(j.cambio);
    setAviso(`Revertido: ${j.revertidos} producto${j.revertidos === 1 ? "" : "s"} volvieron a su precio anterior${j.conflictos?.length ? `; ${j.conflictos.length} se quedaron con el precio que tienen hoy` : ""}.`);
  }

  return (
    <div className="grid gap-4 max-w-5xl">
      {aviso && <p role="status" className="rounded-xl bg-cruz-soft text-cruz px-4 py-3 font-semibold">{aviso}</p>}
      <section className="tarjeta p-4 sm:p-5 grid gap-3" aria-label="Resumen del cambio">
        <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3">
          <div><dt className="text-sm text-muted">Fecha</dt><dd className="font-semibold num">{c.fecha}</dd></div>
          <div><dt className="text-sm text-muted">Responsable</dt><dd className="font-semibold">{c.responsable ?? "—"}</dd></div>
          <div><dt className="text-sm text-muted">Productos</dt><dd className="font-semibold num">{c.productos}</dd></div>
          <div><dt className="text-sm text-muted">Estado</dt><dd className={`font-semibold ${c.revertido ? "text-aviso" : "text-cruz"}`} data-prueba="estado">{c.revertido ? `Revertido el ${c.revertido}` : "Aplicado"}</dd></div>
        </dl>
        {!c.revertido && (!confirmar ? (
          <div className="flex flex-wrap gap-2 items-center">
            <button type="button" className="btn-borde" onClick={() => setConfirmar(true)} disabled={enviando}>Revertir este cambio</button>
            <p className="text-sm text-muted">Vuelve cada producto a su precio anterior, si nadie lo cambió después.</p>
          </div>
        ) : (
          <div role="alertdialog" aria-labelledby="rev-t" className="rounded-xl border-2 border-ink p-4 grid gap-3">
            <p id="rev-t" className="font-semibold">¿Volver {c.productos === 1 ? "este producto" : `estos ${c.productos} productos`} al precio anterior?</p>
            <div className="flex flex-wrap gap-2">
              <button type="button" className="btn-primario" onClick={() => void revertir(false)} disabled={enviando} autoFocus>{enviando ? "Revirtiendo…" : "Sí, revertir"}</button>
              <button type="button" className="btn-borde" onClick={() => setConfirmar(false)} disabled={enviando}>Cancelar</button>
            </div>
          </div>
        ))}
        {error && <p role="alert" className="text-sm text-alerta font-semibold">{error}</p>}
        {conflictos.length > 0 && !c.revertido && (
          <div className="rounded-xl bg-aviso-soft px-4 py-3 grid gap-2">
            <ul className="text-sm text-aviso grid gap-0.5" aria-label="Productos que cambiaron después">
              {conflictos.slice(0, 10).map((x) => <li key={x.producto_id}><b>{x.nombre}</b>: este cambio lo dejó en {pesosMano(Number(x.caja_despues))} y hoy está en {pesosMano(Number(x.caja_hoy))}</li>)}
              {conflictos.length > 10 && <li>y {conflictos.length - 10} más</li>}
            </ul>
            <div><button type="button" className="btn-borde h-10 text-sm" onClick={() => void revertir(true)} disabled={enviando}>Revertir solo los demás</button></div>
          </div>
        )}
      </section>
      <div className="relative overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full text-sm min-w-[720px]">
          <caption className="sr-only">Productos del cambio</caption>
          <thead className="bg-paper text-left text-muted"><tr>
            <th className="px-3 py-2 font-semibold">Producto</th><th className="px-3 py-2 font-semibold text-right">Caja antes → después</th>
            <th className="px-3 py-2 font-semibold text-right">Unidad antes → después</th><th className="px-3 py-2 font-semibold text-right">Margen</th><th className="px-3 py-2 font-semibold text-right">Precio hoy</th>
          </tr></thead>
          <tbody className="divide-y divide-line">
            {c.lineas.map((l) => (
              <tr key={l.producto_id} data-producto={l.producto_id}>
                <td className="px-3 py-2 max-w-[300px]"><p className="font-semibold leading-snug">{l.nombre}</p><p className="text-xs text-muted">{l.laboratorio ?? "Sin laboratorio"}{l.revertida ? " · revertido" : ""}{l.heredado ? " · costo heredado" : ""}</p></td>
                <td className="px-3 py-2 text-right num whitespace-nowrap">{pesosMano(l.caja_antes)} → <b>{pesosMano(l.caja_despues)}</b></td>
                <td className="px-3 py-2 text-right num whitespace-nowrap">{l.unidad_antes === null ? "—" : <>{pesosMano(l.unidad_antes)} → <b>{pesosMano(l.unidad_despues ?? 0)}</b></>}</td>
                <td className="px-3 py-2 text-right num whitespace-nowrap">{pct(margen(l.caja_antes, l.iva, l.costo, l.upc))} → {pct(margen(l.caja_despues, l.iva, l.costo, l.upc))}</td>
                <td className="px-3 py-2 text-right num whitespace-nowrap">{pesosMano(l.caja_hoy)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
