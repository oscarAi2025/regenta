"use client";
import { useState } from "react";

/** Nota interna sobre el cliente (solo la ve la consola). */
export function Nota({ empresa, inicial }: { empresa: string; inicial: string }) {
  const [t, setT] = useState(inicial), [msg, setMsg] = useState("");
  async function guardar() {
    setMsg("");
    const r = await fetch(`/api/admin/clientes/${empresa}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ nota: t }) }).catch(() => null);
    setMsg(r?.ok ? "Guardada" : "No se pudo guardar");
  }
  return (
    <section className="tarjeta p-5 grid gap-2">
      <label htmlFor="nota" className="titulo text-xl">Nota interna</label>
      <textarea id="nota" rows={5} className="campo h-auto py-2" placeholder="Acuerdos, asesor, condiciones especiales…" value={t} onChange={(e) => setT(e.target.value)} />
      <div className="flex items-center gap-3"><button onClick={guardar} className="btn-oscuro h-10 text-sm">Guardar nota</button>{msg && <span role="status" className="text-sm text-muted">{msg}</span>}</div>
    </section>
  );
}
