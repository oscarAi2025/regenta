"use client";
import { useState } from "react";

/** Eliminar una droguería de prueba: solo suspendida y sin numeración DIAN en producción. Se confirma escribiendo su NIT. */
export function Eliminar({ id, nit, dv, nombre }: { id: string; nit: string; dv: string; nombre: string }) {
  const [abierto, setAbierto] = useState(false);
  const [escrito, setEscrito] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [msg, setMsg] = useState("");
  const digitos = escrito.replace(/\D/g, ""), coincide = digitos === nit || digitos === nit + dv; // con o sin dígito de verificación

  async function eliminar() {
    setEnviando(true); setMsg("");
    try {
      const r = await fetch(`/api/admin/clientes/${id}`, { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ nit: escrito }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(j.error ?? "No se pudo eliminar"); setEnviando(false); return; }
      location.href = "/admin/clientes?eliminado=1";
    } catch { setMsg("Sin conexión"); setEnviando(false); }
  }

  if (!abierto) return <button onClick={() => setAbierto(true)} className="btn-borde h-10 text-sm text-alerta">Eliminar droguería de prueba</button>;
  return (
    <div className="tarjeta p-4 grid gap-3 max-w-md border-alerta">
      <p className="text-sm">Se borran para siempre <b>{nombre}</b>, sus ventas, inventario, turnos y las cuentas que solo eran de ella. Los pagos recibidos y la bitácora se conservan.</p>
      <label className="grid gap-1 text-sm font-semibold">Escribe el NIT {nit} para confirmar
        <input value={escrito} onChange={(e) => setEscrito(e.target.value)} inputMode="numeric" autoComplete="off" className="campo" />
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <button onClick={eliminar} disabled={!coincide || enviando} className="btn-peligro h-10 text-sm disabled:opacity-50">{enviando ? "Eliminando…" : "Eliminar para siempre"}</button>
        <button onClick={() => { setAbierto(false); setEscrito(""); setMsg(""); }} className="text-sm text-muted">Cancelar</button>
      </div>
      {msg && <p role="alert" className="text-sm text-alerta">{msg}</p>}
    </div>
  );
}
