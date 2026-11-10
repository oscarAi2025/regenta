"use client";
import { useRef, useState } from "react";
import { useRefrescar } from "@/lib/refrescar";
import { MEDIO, pesos } from "@/lib/formato";
import { imprimirRuta } from "@/lib/impresion";

/** Recibir un pago a una factura a crédito, en la misma fila: deja recibo de caja numerado (como desde la ficha del cliente). */
export function Abonar({ venta, cliente, saldo, numero }: { venta: string; cliente: string; saldo: number; numero: string }) {
  const [abierto, setAbierto] = useState(false);
  const [valor, setValor] = useState("");
  const [medio, setMedio] = useState("efectivo");
  const [ref, setRef] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const refrescar = useRefrescar();
  const idem = useRef(crypto.randomUUID()); // un doble clic no registra dos abonos
  const n = Number(valor.replace(/\D/g, "")) || 0;

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (enviando) return;
    if (n > Math.round(saldo)) { setError(`El abono supera el saldo de la factura (${pesos(saldo)})`); return; }
    setEnviando(true); setError("");
    try {
      const r = await fetch("/api/recibos", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ cliente_id: cliente, venta_id: venta, medio, valor: n, referencia: ref || null, idem_key: idem.current }) });
      const j = await r.json();
      if (!r.ok) { setError(j.error ?? "No se pudo registrar el pago"); return; }
      const aplicado = (j.recibo?.aplicado ?? []).find((a: { venta_id: string }) => a.venta_id === venta);
      window.dispatchEvent(new CustomEvent("regenta:abono", { detail: { venta, abonado: Math.round(saldo) - Number(aplicado?.saldo ?? 0), saldo: Number(aplicado?.saldo ?? 0) } }));
      if (j.recibo?.id) imprimirRuta(`/tiquete/recibo/${j.recibo.id}`);
      idem.current = crypto.randomUUID();
      setAbierto(false); setValor(""); setRef(""); void refrescar();
    } catch { setError("Sin conexión con el servidor: vuelve a intentarlo"); } finally { setEnviando(false); }
  }

  if (!abierto) return <button onClick={() => setAbierto(true)} className="btn-borde text-sm" aria-label={`Recibir pago de ${numero}`}>Recibir pago</button>;
  return (
    <form onSubmit={guardar} className="grid gap-2 w-60" aria-label={`Pago de ${numero}`}>
      <input aria-label="Valor del pago" inputMode="numeric" required className="campo num" placeholder={Math.round(saldo).toLocaleString("es-CO")}
        value={valor} onChange={(e) => { const d = e.target.value.replace(/\D/g, ""); setValor(d ? Number(d).toLocaleString("es-CO") : ""); }} />
      <div className="flex gap-2">
        <button type="button" onClick={() => setValor(Math.round(saldo).toLocaleString("es-CO"))} className="text-sm underline">Todo el saldo</button>
      </div>
      <select aria-label="Medio de pago" className="campo" value={medio} onChange={(e) => setMedio(e.target.value)}>
        {Object.entries(MEDIO).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
      </select>
      <input aria-label="Referencia (opcional)" className="campo" placeholder="Referencia (opcional)" maxLength={60} value={ref} onChange={(e) => setRef(e.target.value)} />
      {error && <p role="alert" className="text-sm text-alerta">{error}</p>}
      <div className="flex gap-2">
        <button disabled={enviando || n <= 0} className="flex-1 h-10 rounded-xl bg-ink text-white text-sm font-semibold disabled:opacity-50">{enviando ? "Guardando…" : "Recibir pago e imprimir recibo"}</button>
        <button type="button" onClick={() => { setAbierto(false); setError(""); }} className="h-10 px-3 text-sm text-muted">Cancelar</button>
      </div>
    </form>
  );
}
