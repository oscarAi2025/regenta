"use client";
import { useState } from "react";
import type { FilaCxP } from "@/lib/compras-datos";
import { MEDIOS_PAGO, leerNumero, numeroTexto, pesosExactos } from "@/lib/compras";

/** Formulario de pago a un proveedor: a una factura (compra) o, sin ella, de la que vence primero a la última.
 *  Al guardar devuelve las cuentas por pagar actualizadas de ese proveedor. */
export function Pagar({ proveedor, compra, saldo, etiqueta, onListo, onCerrar }: {
  proveedor: string; compra?: string; saldo: number; etiqueta: string; onListo: (cuentas: FilaCxP[], mensaje: string) => void; onCerrar: () => void;
}) {
  const [valor, setValor] = useState(numeroTexto(saldo));
  const [medio, setMedio] = useState("transferencia");
  const [ref, setRef] = useState("");
  const [fueraCaja, setFueraCaja] = useState(false);
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [idem] = useState(() => crypto.randomUUID());
  async function enviar(e: React.FormEvent) {
    e.preventDefault(); setError("");
    const v = leerNumero(valor);
    if (!v) { setError("Escribe el valor del pago."); return; }
    setOcupado(true);
    try {
      const r = await fetch("/api/compras/pagos", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        proveedor_id: proveedor, ...(compra ? { compras: [compra] } : {}), valor: v, medio, referencia: ref || null, desde_caja: medio === "efectivo" && !fueraCaja, idem_key: idem }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setError(j.error ?? "No se pudo registrar el pago"); return; }
      onListo(j.cuentas ?? [], `Pago de ${pesosExactos(v)} registrado${j.egreso_caja ? " (salió de la caja como egreso del turno)" : ""}.`);
    } catch { setError("Sin conexión: revisa internet y vuelve a intentar (no se duplicará)."); } finally { setOcupado(false); }
  }
  return (
    <form onSubmit={enviar} aria-label={etiqueta} className="grid gap-3 sm:grid-cols-[150px_170px_minmax(0,1fr)_auto] sm:items-end rounded-xl bg-paper p-3">
      <div><label htmlFor={`valor-${compra ?? proveedor}`} className="etiqueta">Valor</label><input id={`valor-${compra ?? proveedor}`} inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value.replace(/[^\d.,]/g, ""))} className="campo num" /></div>
      <div><label htmlFor={`medio-${compra ?? proveedor}`} className="etiqueta">Medio</label><select id={`medio-${compra ?? proveedor}`} value={medio} onChange={(e) => setMedio(e.target.value)} className="campo">{MEDIOS_PAGO.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></div>
      <div><label htmlFor={`ref-${compra ?? proveedor}`} className="etiqueta">Referencia (opcional)</label><input id={`ref-${compra ?? proveedor}`} value={ref} onChange={(e) => setRef(e.target.value)} maxLength={60} className="campo" /></div>
      <div className="flex gap-2"><button disabled={ocupado} className="btn-primario">{ocupado ? "Guardando…" : "Confirmar pago"}</button><button type="button" onClick={onCerrar} className="btn-borde">Cancelar</button></div>
      {medio === "efectivo" && <label className="sm:col-span-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={fueraCaja} onChange={(e) => setFueraCaja(e.target.checked)} className="w-4 h-4" />No sale de la caja (si sale, queda como egreso del turno abierto)</label>}
      {error && <p role="alert" className="sm:col-span-4 text-alerta font-semibold">{error}</p>}
    </form>
  );
}
