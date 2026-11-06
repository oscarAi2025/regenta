"use client";
import { useState } from "react";
import type { FilaCxP, Proveedor } from "@/lib/compras-datos";
import { pesosExactos } from "@/lib/compras";
import { Pagar } from "../../cuentas-por-pagar/Pagar";

const fecha = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");
type Campos = { nombre: string; nit: string; telefono: string; email: string; contacto: string; direccion: string; ciudad: string; plazo: string; responsable_iva: boolean; obligado_facturar: boolean };
const aCampos = (p: Proveedor): Campos => ({ nombre: p.nombre, nit: p.nit ?? "", telefono: p.telefono ?? "", email: p.email ?? "", contacto: p.contacto ?? "", direccion: p.direccion ?? "",
  ciudad: p.ciudad ?? "", plazo: p.plazo_dias === null ? "" : String(p.plazo_dias), responsable_iva: p.responsable_iva, obligado_facturar: p.obligado_facturar });

/** Ficha del proveedor: datos (la gerencia los corrige), saldo con sus facturas pendientes y botón para pagar. */
export function Ficha({ inicial, cuentas: c0, dinero }: { inicial: Proveedor; cuentas: FilaCxP[]; dinero: boolean }) {
  const [p, setP] = useState(inicial);
  const [cuentas, setCuentas] = useState(c0);
  const [editar, setEditar] = useState(false);
  const [f, setF] = useState(aCampos(inicial));
  const [pagar, setPagar] = useState(false);
  const [error, setError] = useState(""); const [aviso, setAviso] = useState(""); const [ocupado, setOcupado] = useState(false);
  const saldo = cuentas.reduce((a, x) => a + x.saldo, 0), vencido = cuentas.filter((x) => x.dias < 0).reduce((a, x) => a + x.saldo, 0);
  async function guardar(e: React.FormEvent, extra?: { activo: boolean }) {
    e.preventDefault(); setError(""); setOcupado(true);
    try {
      const r = await fetch("/api/proveedores", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(extra ? { id: p.id, ...extra } : {
        id: p.id, nombre: f.nombre, nit: f.nit || null, telefono: f.telefono || null, email: f.email || null, contacto: f.contacto || null, direccion: f.direccion || null,
        ciudad: f.ciudad || null, plazo_dias: f.plazo ? Number(f.plazo) : null, responsable_iva: f.responsable_iva, obligado_facturar: f.obligado_facturar }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setError(j.error ?? "No se pudo guardar"); return; }
      setP(j.proveedor); setF(aCampos(j.proveedor)); setEditar(false); setAviso(extra ? (extra.activo ? "Proveedor activado." : "Proveedor desactivado: ya no sale al recibir mercancía.") : "Datos guardados.");
    } catch { setError("Sin conexión: revisa internet y vuelve a intentar."); } finally { setOcupado(false); }
  }
  const campo = (k: keyof Campos, t: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div><label htmlFor={`f-${k}`} className="etiqueta">{t}</label><input id={`f-${k}`} value={f[k] as string} onChange={(e) => setF({ ...f, [k]: e.target.value })} className="campo" {...extra} /></div>);
  return (
    <div className="grid gap-4 min-w-0">
      {aviso && <p role="status" className="rounded-xl bg-cruz-soft text-cruz font-semibold px-4 py-3">{aviso}</p>}
      {dinero && (
        <section className="grid grid-cols-2 lg:grid-cols-3 gap-3" aria-label="Saldo">
          <div className="tarjeta px-4 py-3.5"><p className="text-sm text-muted">Saldo por pagar</p><p className="num titulo text-[28px] leading-tight">{pesosExactos(saldo)}</p><p className="text-[13px] text-muted">{cuentas.length} factura{cuentas.length === 1 ? "" : "s"}</p></div>
          <div className="tarjeta px-4 py-3.5"><p className="text-sm text-muted">Vencido</p><p className={`num titulo text-[28px] leading-tight ${vencido ? "text-alerta" : ""}`}>{pesosExactos(vencido)}</p></div>
          <div className="tarjeta px-4 py-3.5 col-span-2 lg:col-span-1 flex items-center">{saldo > 0 ? <button onClick={() => { setPagar(!pagar); setAviso(""); }} className="btn-oscuro w-full" aria-expanded={pagar}>Pagar a este proveedor</button> : <p className="text-muted">Sin saldo pendiente.</p>}</div>
        </section>
      )}
      {pagar && <Pagar proveedor={p.id} saldo={saldo} etiqueta={`Pago a ${p.nombre}`} onCerrar={() => setPagar(false)}
        onListo={(cs, m) => { setCuentas(cs); setPagar(false); setAviso(`${m} Se aplicó de la factura que vence primero a la última.`); }} />}
      {dinero && cuentas.length > 0 && (
        <section className="tarjeta overflow-x-auto" aria-labelledby="pend-t">
          <h2 id="pend-t" className="titulo text-xl px-4 pt-4">Facturas pendientes</h2>
          <table className="w-full text-[15px] min-w-[560px]"><thead className="text-left text-sm text-muted border-b border-line"><tr>
            <th className="px-4 py-2.5 font-semibold">Factura</th><th className="px-4 py-2.5 font-semibold">Vence</th><th className="px-4 py-2.5 font-semibold text-right">Total</th><th className="px-4 py-2.5 font-semibold text-right">Saldo</th></tr></thead>
            <tbody className="divide-y divide-line">{cuentas.map((x) => (
              <tr key={x.compra_id}><td className="px-4 py-2.5"><a href={`/compras/${x.compra_id}`} className="num font-semibold hover:underline">{x.numero_factura}</a> <span className="text-sm text-muted">· {fecha(x.fecha_factura)}</span></td>
                <td className={`px-4 py-2.5 num ${x.dias < 0 ? "text-alerta font-semibold" : ""}`}>{fecha(x.vence_pago)}</td><td className="px-4 py-2.5 num text-right">{pesosExactos(x.total)}</td><td className="px-4 py-2.5 num text-right font-semibold">{pesosExactos(x.saldo)}</td></tr>
            ))}</tbody></table>
        </section>
      )}
      <section className="tarjeta p-4 grid gap-3" aria-labelledby="datos-t">
        <div className="flex flex-wrap items-center justify-between gap-2"><h2 id="datos-t" className="titulo text-xl">Datos del proveedor</h2>
          {dinero && !editar && <div className="flex gap-2"><button onClick={() => setEditar(true)} className="btn-borde h-9 px-3 text-sm">Corregir datos</button>
            <button onClick={(e) => guardar(e, { activo: !p.activo })} disabled={ocupado} className="btn-borde h-9 px-3 text-sm">{p.activo ? "Desactivar" : "Activar"}</button></div>}</div>
        {editar ? (
          <form onSubmit={(e) => guardar(e)} className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {campo("nombre", "Nombre o razón social", { maxLength: 160 })}{campo("nit", "NIT (sin DV)", { inputMode: "numeric" })}{campo("telefono", "Teléfono", { maxLength: 30 })}
            {campo("email", "Correo", { type: "email", maxLength: 160 })}{campo("contacto", "Contacto (asesor)", { maxLength: 120 })}{campo("plazo", "Plazo de pago (días)", { inputMode: "numeric" })}
            {campo("direccion", "Dirección", { maxLength: 160 })}{campo("ciudad", "Ciudad", { maxLength: 80 })}
            <div className="grid gap-1.5 content-end">
              <label className="flex items-center gap-2"><input type="checkbox" checked={f.responsable_iva} onChange={(e) => setF({ ...f, responsable_iva: e.target.checked })} className="w-4 h-4" />Responsable de IVA</label>
              <label className="flex items-center gap-2"><input type="checkbox" checked={f.obligado_facturar} onChange={(e) => setF({ ...f, obligado_facturar: e.target.checked })} className="w-4 h-4" />Obligado a facturar</label>
            </div>
            {error && <p role="alert" className="sm:col-span-2 lg:col-span-3 text-alerta font-semibold">{error}</p>}
            <div className="flex gap-2 sm:col-span-2 lg:col-span-3"><button disabled={ocupado} className="btn-primario">Guardar datos</button><button type="button" onClick={() => { setEditar(false); setF(aCampos(p)); }} className="btn-borde">Cancelar</button></div>
          </form>
        ) : (
          <dl className="grid grid-cols-2 sm:grid-cols-3 gap-x-4 gap-y-3 text-[15px]">
            {[["NIT", p.nit ? `${p.nit}${p.dv ? "-" + p.dv : ""}` : "—"], ["Teléfono", p.telefono ?? "—"], ["Correo", p.email ?? "—"], ["Contacto", p.contacto ?? "—"],
              ["Dirección", [p.direccion, p.ciudad].filter(Boolean).join(", ") || "—"], ["Plazo de pago", p.plazo_dias ? `${p.plazo_dias} días` : "Contado"],
              ["IVA", p.responsable_iva ? "Responsable de IVA" : "No responsable"], ["Facturación", p.obligado_facturar ? "Obligado a facturar" : "No obligado a facturar"], ["Estado", p.activo ? "Activo" : "Inactivo"]].map(([t, v]) => (
              <div key={t} className="min-w-0"><dt className="text-sm text-muted">{t}</dt><dd className="font-semibold break-words">{v}</dd></div>
            ))}
          </dl>
        )}
        {error && !editar && <p role="alert" className="text-alerta font-semibold">{error}</p>}
      </section>
    </div>
  );
}
