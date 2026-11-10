"use client";
import { useState } from "react";
import { useRefrescar } from "@/lib/refrescar";

type C = { id: string; tipo_doc: string; numero_doc: string; nombre: string; email: string; telefono: string; autoriza_datos: boolean };

export function EditarCliente({ c }: { c: C }) {
  const [abierto, setAbierto] = useState(false), [d, setD] = useState(c), [msg, setMsg] = useState(""), [enviando, setEnviando] = useState(false);
  const refrescar = useRefrescar();
  async function enviar(cuerpo: unknown) {
    setEnviando(true); setMsg("");
    const r = await fetch(`/api/clientes/${c.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) }).catch(() => null);
    const j = await r?.json().catch(() => ({}));
    setMsg(r?.ok ? j.mensaje : j?.error ?? "Sin conexión"); setEnviando(false);
    if (r?.ok) { setAbierto(false); void refrescar(); }
  }
  if (!abierto) return <span className="inline-flex flex-wrap gap-2 items-center"><button onClick={() => setAbierto(true)} className="btn-borde h-9 text-sm">Corregir</button>{msg && <span role="status" className="text-sm text-muted">{msg}</span>}</span>;
  const id = (k: string) => `cl-${c.id.slice(0, 8)}-${k}`;
  return (
    <form onSubmit={(e) => { e.preventDefault(); enviar({ ...d, email: d.email || null, telefono: d.telefono || null }); }} className="grid gap-2 min-w-[260px]">
      <div className="flex gap-2">
        <label htmlFor={id("t")} className="sr-only">Tipo de documento</label>
        <select id={id("t")} className="campo h-10 w-24" value={d.tipo_doc} onChange={(e) => setD({ ...d, tipo_doc: e.target.value })}>{["CC", "NIT", "CE", "PP", "PEP"].map((x) => <option key={x}>{x}</option>)}</select>
        <label htmlFor={id("n")} className="sr-only">Número de documento</label>
        <input id={id("n")} className="campo h-10" value={d.numero_doc} onChange={(e) => setD({ ...d, numero_doc: e.target.value })} />
      </div>
      <label className="text-sm font-semibold">Nombre<input className="campo h-10 font-normal" value={d.nombre} onChange={(e) => setD({ ...d, nombre: e.target.value })} /></label>
      <label className="text-sm font-semibold">Correo<input type="email" className="campo h-10 font-normal" value={d.email} onChange={(e) => setD({ ...d, email: e.target.value })} /></label>
      <label className="text-sm font-semibold">Teléfono<input className="campo h-10 font-normal" value={d.telefono} onChange={(e) => setD({ ...d, telefono: e.target.value })} /></label>
      <label className="text-sm flex gap-2 items-center"><input type="checkbox" checked={d.autoriza_datos} onChange={(e) => setD({ ...d, autoriza_datos: e.target.checked })} />Autoriza tratamiento de datos</label>
      <div className="flex flex-wrap gap-2">
        <button disabled={enviando} className="btn-oscuro h-9 text-sm disabled:opacity-60">Guardar</button>
        <button type="button" onClick={() => setAbierto(false)} className="text-sm text-muted">Cancelar</button>
        <button type="button" disabled={enviando} onClick={() => enviar({ quitar_contacto: true })} className="text-sm text-alerta ml-auto">Quitar sus datos de contacto</button>
      </div>
      {msg && <p role="alert" className="text-sm text-alerta">{msg}</p>}
    </form>
  );
}
