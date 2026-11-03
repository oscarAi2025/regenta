"use client";
import { useState } from "react";

/** Número de la factura electrónica del servicio de un pago aprobado (el dueño la ve en su comprobante). */
export function FacturaPago({ referencia, inicial }: { referencia: string; inicial: string }) {
  const [v, setV] = useState(inicial), [msg, setMsg] = useState("");
  async function guardar() {
    setMsg("");
    const r = await fetch("/api/admin/pagos", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ referencia, factura: v }) }).catch(() => null);
    const j = await r?.json().catch(() => ({}));
    setMsg(r?.ok ? "Anotada" : j?.error ?? "No se pudo");
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <input aria-label={`Factura del pago ${referencia}`} value={v} onChange={(e) => setV(e.target.value)} placeholder="N.º factura" className="campo h-9 w-32 text-sm" />
      <button onClick={guardar} className="btn-borde h-9 text-sm">Guardar</button>
      {msg && <span role="status" className="text-sm text-muted">{msg}</span>}
    </span>
  );
}
