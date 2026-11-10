"use client";
import { useState } from "react";
import { useRefrescar } from "@/lib/refrescar";

type Datos = { razon_social: string; nombre_comercial: string; nit: string; responsable_iva: boolean; direccion: string; ciudad: string; telefono: string; email: string; calidades_tributarias: string };

/** Datos fiscales del cliente (salen en sus facturas). El NIT se bloquea cuando ya factura en producción ante la DIAN. */
export function Fiscal({ empresa, inicial, nitFijo }: { empresa: string; inicial: Datos; nitFijo: boolean }) {
  const [d, setD] = useState(inicial), [msg, setMsg] = useState(""), [enviando, setEnviando] = useState(false);
  const refrescar = useRefrescar();
  const campo = (k: keyof Datos, etiqueta: string, extra: Record<string, unknown> = {}) => (
    <label className="grid gap-1 text-sm font-semibold">{etiqueta}
      <input className="campo font-normal" value={String(d[k])} onChange={(e) => setD({ ...d, [k]: e.target.value })} {...extra} />
    </label>
  );
  async function guardar() {
    setEnviando(true); setMsg("");
    const r = await fetch(`/api/admin/clientes/${empresa}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ fiscal: d }) }).catch(() => null);
    const j = await r?.json().catch(() => ({}));
    setMsg(r?.ok ? j.mensaje ?? "Guardado" : j?.error ?? "No se pudo guardar"); setEnviando(false);
    if (r?.ok) void refrescar();
  }
  return (
    <section className="tarjeta p-5 grid gap-3" aria-labelledby="fiscal-t">
      <h2 id="fiscal-t" className="titulo text-xl">Datos fiscales</h2>
      <p className="text-sm text-muted">Salen en las facturas del cliente. Corrígelos con el RUT a la vista.</p>
      <div className="grid sm:grid-cols-2 gap-3">
        {campo("razon_social", "Razón social", { autoComplete: "off" })}
        {campo("nombre_comercial", "Nombre comercial", { autoComplete: "off" })}
        {campo("nit", nitFijo ? "NIT (ya factura en producción: no se cambia)" : "NIT sin dígito de verificación", { inputMode: "numeric", disabled: nitFijo })}
        <label className="grid gap-1 text-sm font-semibold">Régimen de IVA
          <select className="campo font-normal" value={d.responsable_iva ? "si" : "no"} onChange={(e) => setD({ ...d, responsable_iva: e.target.value === "si" })}>
            <option value="no">No responsable de IVA</option><option value="si">Responsable de IVA</option>
          </select>
        </label>
        {campo("direccion", "Dirección")}
        {campo("ciudad", "Ciudad")}
        {campo("telefono", "Teléfono", { inputMode: "tel" })}
        {campo("email", "Correo de la droguería", { type: "email" })}
        <div className="sm:col-span-2">{campo("calidades_tributarias", "Calidades tributarias (salen en la factura si corresponden)", { placeholder: "Ej.: Agente retenedor de IVA · Gran contribuyente · Régimen SIMPLE", maxLength: 200 })}</div>
      </div>
      <div className="flex items-center gap-3"><button onClick={guardar} disabled={enviando} className="btn-oscuro h-10 text-sm disabled:opacity-60">{enviando ? "Guardando…" : "Guardar datos fiscales"}</button>{msg && <span role="status" className="text-sm text-muted">{msg}</span>}</div>
    </section>
  );
}
