"use client";
import { useState } from "react";
import type { Proveedor } from "@/lib/compras-datos";
import { pesosExactos } from "@/lib/compras";

const fecha = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");

/** Lista de proveedores con alta rápida. La gerencia ve el saldo y lo vencido. */
export function Proveedores({ inicial, dinero }: { inicial: Proveedor[]; dinero: boolean }) {
  const [lista, setLista] = useState(inicial);
  const [abierto, setAbierto] = useState(false);
  const [f, setF] = useState({ nombre: "", nit: "", telefono: "", plazo: "" });
  const [error, setError] = useState(""); const [aviso, setAviso] = useState(""); const [ocupado, setOcupado] = useState(false);
  const [filtro, setFiltro] = useState("");
  async function crear(e: React.FormEvent) {
    e.preventDefault(); setError(""); setOcupado(true);
    try {
      const r = await fetch("/api/proveedores", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        nombre: f.nombre, nit: f.nit || null, telefono: f.telefono || null, plazo_dias: f.plazo ? Number(f.plazo) : null }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setError(j.error ?? "No se pudo crear el proveedor"); return; }
      setLista((l) => [...l, j.proveedor].sort((a, b) => a.nombre.localeCompare(b.nombre, "es")));
      setAviso(`Proveedor «${j.proveedor.nombre}» creado.`); setF({ nombre: "", nit: "", telefono: "", plazo: "" }); setAbierto(false);
    } catch { setError("Sin conexión: revisa internet y vuelve a intentar."); } finally { setOcupado(false); }
  }
  const visibles = lista.filter((p) => !filtro.trim() || `${p.nombre} ${p.nit ?? ""}`.toLowerCase().includes(filtro.trim().toLowerCase()));
  return (
    <div className="grid gap-4 min-w-0">
      <div className="flex flex-wrap items-end gap-3">
        <div className="flex-1 min-w-[200px]"><label htmlFor="filtro-prov" className="etiqueta">Buscar</label><input id="filtro-prov" value={filtro} onChange={(e) => setFiltro(e.target.value)} className="campo" placeholder="Nombre o NIT" /></div>
        <button onClick={() => { setAbierto(!abierto); setAviso(""); }} className="btn-primario" aria-expanded={abierto}>Nuevo proveedor</button>
      </div>
      {aviso && <p role="status" className="rounded-xl bg-cruz-soft text-cruz font-semibold px-4 py-3">{aviso}</p>}
      {abierto && (
        <form onSubmit={crear} className="tarjeta p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)_120px_auto] lg:items-end" aria-label="Nuevo proveedor">
          <div><label htmlFor="p-nombre" className="etiqueta">Nombre o razón social</label><input id="p-nombre" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} className="campo" maxLength={160} /></div>
          <div><label htmlFor="p-nit" className="etiqueta">NIT (sin DV)</label><input id="p-nit" inputMode="numeric" value={f.nit} onChange={(e) => setF({ ...f, nit: e.target.value })} className="campo" /></div>
          <div><label htmlFor="p-tel" className="etiqueta">Teléfono</label><input id="p-tel" value={f.telefono} onChange={(e) => setF({ ...f, telefono: e.target.value })} className="campo" maxLength={30} /></div>
          <div><label htmlFor="p-plazo" className="etiqueta">Plazo (días)</label><input id="p-plazo" inputMode="numeric" value={f.plazo} onChange={(e) => setF({ ...f, plazo: e.target.value.replace(/\D/g, "") })} className="campo num" placeholder="0" /></div>
          <button disabled={ocupado} className="btn-oscuro">{ocupado ? "Guardando…" : "Crear proveedor"}</button>
          {error && <p role="alert" className="sm:col-span-2 lg:col-span-5 text-alerta font-semibold">{error}</p>}
        </form>
      )}
      <div className="tarjeta overflow-x-auto">
        <table className="w-full text-[15px] min-w-[680px]" aria-label="Proveedores">
          <thead className="text-left text-sm text-muted border-b border-line"><tr>
            <th className="px-4 py-3 font-semibold">Proveedor</th><th className="px-4 py-3 font-semibold">Plazo</th><th className="px-4 py-3 font-semibold text-right">Compras</th><th className="px-4 py-3 font-semibold">Última</th>
            {dinero && <th className="px-4 py-3 font-semibold text-right">Saldo</th>}
          </tr></thead>
          <tbody className="divide-y divide-line">
            {visibles.map((p) => (
              <tr key={p.id} className={`align-top ${p.activo ? "" : "text-muted"}`}>
                <td className="px-4 py-3"><a href={`/proveedores/${p.id}`} className="font-semibold hover:underline">{p.nombre}</a>{!p.activo && " · inactivo"}<p className="text-sm text-muted num">{p.nit ? `NIT ${p.nit}${p.dv ? "-" + p.dv : ""}` : "Sin NIT"}{p.telefono ? ` · ${p.telefono}` : ""}</p></td>
                <td className="px-4 py-3 num">{p.plazo_dias ? `${p.plazo_dias} días` : "Contado"}</td>
                <td className="px-4 py-3 num text-right">{p.compras}</td>
                <td className="px-4 py-3 num">{fecha(p.ultima)}</td>
                {dinero && <td className="px-4 py-3 num text-right font-semibold">{p.saldo ? pesosExactos(p.saldo) : "—"}{p.vencido ? <span className="block text-sm text-alerta">{pesosExactos(p.vencido)} vencido</span> : null}</td>}
              </tr>
            ))}
            {visibles.length === 0 && <tr><td colSpan={dinero ? 5 : 4} className="px-4 py-10 text-center text-muted">{lista.length ? "Ningún proveedor coincide." : "Aún no hay proveedores: créalos aquí o al recibir mercancía."}</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
