"use client";
import { useEffect, useState } from "react";
import { pesos } from "@/lib/formato";
import { imprimirRuta } from "@/lib/impresion";

type Linea = { producto_id: string; presentacion: string; descripcion: string; disponible: number; unitario: number };
const MEDIOS = [["efectivo", "Efectivo"], ["nequi", "Nequi"], ["daviplata", "Daviplata"], ["transferencia", "Transferencia"], ["tarjeta", "Tarjeta"], ["bre_b", "Bre-B"]] as const;

/** Devolución parcial: el cliente devuelve parte de lo que compró. Las unidades vuelven a su lote, se reembolsa (o se
 *  descuenta del saldo si fue a crédito) y, si la venta tiene documento electrónico, se genera la nota crédito. */
export function Devolver({ id, lineas, credito }: { id: string; lineas: Linea[]; credito: boolean }) {
  const [abierto, setAbierto] = useState(false);
  const [cant, setCant] = useState<Record<number, number>>({});
  const [motivo, setMotivo] = useState("");
  const [medio, setMedio] = useState("efectivo");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  // A dónde vuelve lo devuelto: a la venta o a cuarentena (se revisa antes de venderlo). Arranca con lo que configuró la droguería.
  const [destino, setDestino] = useState<"vendible" | "cuarentena">("vendible");
  const [destinoListo, setDestinoListo] = useState(false);
  useEffect(() => {
    if (!abierto || destinoListo) return;
    fetch(`/api/ventas/${id}/devolucion`).then((r) => (r.ok ? r.json() : null)).then((j) => { if (j?.destino === "cuarentena") setDestino("cuarentena"); }).catch(() => {}).finally(() => setDestinoListo(true));
  }, [abierto, destinoListo, id]);
  const total = lineas.reduce((s, l, i) => s + Math.round((cant[i] ?? 0) * l.unitario), 0);
  const elegidas = lineas.map((l, i) => ({ l, q: cant[i] ?? 0 })).filter((x) => x.q > 0);

  async function devolver() {
    setEnviando(true); setError("");
    const r = await fetch(`/api/ventas/${id}/devolucion`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ motivo, medio, destino, lineas: elegidas.map(({ l, q }) => ({ producto_id: l.producto_id, presentacion: l.presentacion, cantidad: q })) }) }).catch(() => null);
    if (!r) { setError("Sin conexión: revisa internet e intenta de nuevo."); setEnviando(false); return; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setError(j.error ?? "No se pudo registrar la devolución"); setEnviando(false); return; }
    imprimirRuta(`/tiquete/devolucion/${j.devolucion.id}`);
    location.reload();
  }

  if (!abierto) return <div><button onClick={() => setAbierto(true)} className="btn-borde">Devolver productos</button></div>;
  return (
    <div className="tarjeta p-5 grid gap-4" aria-label="Devolución">
      <div>
        <h2 className="titulo text-xl">Devolver productos</h2>
        <p className="text-sm text-muted mt-1">Elige cuánto devuelve el cliente. Las unidades vuelven a su lote (a la venta o a cuarentena) y, si la venta ya tiene documento electrónico, se genera la nota crédito por lo devuelto.</p>
      </div>
      <ul className="grid gap-3">
        {lineas.map((l, i) => (
          <li key={l.producto_id + l.presentacion} className="flex items-center justify-between gap-3">
            <div className="min-w-0"><p className="leading-snug">{l.descripcion}</p><p className="text-sm text-muted num">Hasta {l.disponible} {l.presentacion === "caja" ? "caja" : "und"} · {pesos(l.unitario)} c/u</p></div>
            <input type="number" min={0} max={l.disponible} step={1} inputMode="numeric" aria-label={`Cantidad a devolver de ${l.descripcion}`} className="campo num w-24 text-center"
              value={cant[i] ?? 0} onChange={(e) => setCant({ ...cant, [i]: Math.max(0, Math.min(l.disponible, Math.floor(Number(e.target.value) || 0))) })} />
          </li>
        ))}
      </ul>
      <div className="grid sm:grid-cols-2 gap-3">
        <div><label htmlFor="dev-motivo" className="etiqueta">Motivo</label>
          <input id="dev-motivo" className="campo" value={motivo} onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: no lo necesitó, producto equivocado" /></div>
        <div><label htmlFor="dev-medio" className="etiqueta">{credito ? "Si ya había abonado, se reembolsa en" : "Se reembolsa en"}</label>
          <select id="dev-medio" className="campo" value={medio} onChange={(e) => setMedio(e.target.value)}>{MEDIOS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></div>
      </div>
      <fieldset className="grid gap-2">
        <legend className="etiqueta">¿A dónde va lo devuelto?</legend>
        <div className="grid sm:grid-cols-2 gap-2">
          {([["vendible", "Vuelve a la venta", "Está en buen estado: se puede vender de nuevo."], ["cuarentena", "A cuarentena", "Se revisa antes: el lote no se vende hasta liberarlo o darlo de baja."]] as const).map(([k, t, d]) => (
            <label key={k} className={`rounded-xl border-2 px-3.5 py-2.5 cursor-pointer ${destino === k ? "border-ink bg-paper" : "border-line"}`}>
              <span className="flex items-center gap-2 font-semibold"><input type="radio" name="dev-destino" value={k} checked={destino === k} onChange={() => setDestino(k)} />{t}</span>
              <span className="block text-sm text-muted mt-0.5">{d}</span>
            </label>
          ))}
        </div>
        {destino === "cuarentena" && <p className="text-sm text-aviso font-semibold">Todo el lote al que vuelven estas unidades queda separado de la venta hasta que lo revises en Inventario › Cuarentena.</p>}
      </fieldset>
      {credito && <p className="text-sm text-muted">Venta a crédito: lo devuelto se descuenta primero del saldo pendiente.</p>}
      <p className="flex justify-between items-baseline"><span>Total a devolver</span><span className="num titulo text-3xl">{pesos(total)}</span></p>
      {error && <p role="alert" className="text-sm text-alerta font-semibold">{error}</p>}
      <div className="flex gap-2">
        <button onClick={devolver} disabled={enviando || !elegidas.length || motivo.trim().length < 4} className="btn-primario">{enviando ? "Registrando…" : "Registrar devolución"}</button>
        <button onClick={() => setAbierto(false)} className="btn-borde">Cancelar</button>
      </div>
    </div>
  );
}
