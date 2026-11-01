"use client";
import Link from "next/link";
import { useState } from "react";
import { Enlace } from "@/components/admin/Enlace";

type Pre = Partial<{ solicitud: number; pago: string; razon_social: string; nit: string; ciudad: string; telefono: string; email: string; plan: string; dueno_nombre: string; dueno_email: string }>;
const num = (s: string) => Number(s.replace(/\D/g, "")) || 0;

export function NuevoCliente({ pre }: { pre: Pre }) {
  const [f, setF] = useState({ razon_social: pre.razon_social ?? "", nombre_comercial: "", nit: pre.nit ?? "", ciudad: pre.ciudad ?? "", direccion: "", telefono: pre.telefono ?? "", email: pre.email ?? "", plan: pre.plan ?? "esencial", responsable_iva: false,
    dueno_nombre: pre.dueno_nombre ?? "", dueno_email: pre.dueno_email ?? "",
    pos_prefijo: "", pos_desde: "", pos_hasta: "", pos_vence: "", fac_prefijo: "", fac_desde: "", fac_hasta: "", fac_vence: "", pruebas: true });
  const [error, setError] = useState(""), [enviando, setEnviando] = useState(false);
  const [hecho, setHecho] = useState<{ empresa: string; enlace: string | null } | null>(null);
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setF({ ...f, [k]: e.target.type === "checkbox" ? (e.target as HTMLInputElement).checked : e.target.value });
  const numeracion = (p: string, d: string, h: string, v: string) => num(d) && num(h) ? { prefijo: p.trim().toUpperCase(), desde: num(d), hasta: num(h), vigente_hasta: v || null, pruebas: f.pruebas } : null;

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    if (enviando) return;
    setEnviando(true); setError("");
    try {
      const r = await fetch("/api/admin/clientes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        razon_social: f.razon_social, nombre_comercial: f.nombre_comercial || null, nit: f.nit.replace(/\D/g, ""), ciudad: f.ciudad || null, direccion: f.direccion || null, telefono: f.telefono || null, email: f.email || "",
        plan: f.plan, responsable_iva: f.responsable_iva, dueno: { nombre: f.dueno_nombre, email: f.dueno_email },
        pos: numeracion(f.pos_prefijo, f.pos_desde, f.pos_hasta, f.pos_vence), factura: numeracion(f.fac_prefijo, f.fac_desde, f.fac_hasta, f.fac_vence),
        solicitud: pre.solicitud ?? null, pago: pre.pago ?? null }) });
      const j = await r.json();
      if (!r.ok) { setError(j.error ?? "No se pudo crear"); return; }
      setHecho(j);
    } catch { setError("Sin conexión con el servidor"); } finally { setEnviando(false); }
  }

  if (hecho) return (
    <div className="tarjeta p-6 grid gap-4 max-w-2xl">
      <p className="font-cond text-3xl" style={{ fontWeight: 700 }}>Cliente creado</p>
      <p className="text-muted">{f.razon_social} ya tiene su sede, su caja y {f.pos_desde || f.fac_desde ? "sus numeraciones" : "lo básico"}. Manda al dueño el enlace para que cree su contraseña.</p>
      {hecho.enlace ? <Enlace enlace={hecho.enlace} nombre={f.dueno_nombre} /> : <p className="text-sm">El dueño ya tenía cuenta: entra con su contraseña de siempre.</p>}
      <div className="flex flex-wrap gap-2"><Link href={`/admin/clientes/${hecho.empresa}`} className="btn-oscuro">Ver el cliente</Link><Link href="/admin/clientes/nuevo" className="btn-borde">Crear otro</Link></div>
    </div>
  );

  const campo = (id: keyof typeof f, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div><label htmlFor={`n-${id}`} className="etiqueta">{label}</label><input id={`n-${id}`} className="campo" value={String(f[id])} onChange={set(id)} {...extra} /></div>
  );
  return (
    <form onSubmit={crear} className="grid gap-5 max-w-4xl">
      {(pre.solicitud || pre.pago) && <p className="rounded-xl bg-cruz-soft text-cruz px-4 py-3 font-semibold">Datos precargados desde {pre.solicitud ? "la solicitud de demo" : `el pago ${pre.pago}`}. Revísalos antes de crear.</p>}
      <fieldset className="tarjeta p-5 grid sm:grid-cols-2 gap-3">
        <legend className="titulo text-xl px-1">Empresa</legend>
        {campo("razon_social", "Razón social", { required: true })}
        {campo("nombre_comercial", "Nombre comercial")}
        {campo("nit", "NIT (sin dígito de verificación)", { required: true, inputMode: "numeric" })}
        <div><label htmlFor="n-plan" className="etiqueta">Plan</label><select id="n-plan" className="campo" value={f.plan} onChange={set("plan")}><option value="esencial">Esencial</option><option value="pro">Pro</option><option value="cadena">Cadena</option><option value="socio">Socio de Farmagenéricos</option></select></div>
        {campo("ciudad", "Ciudad")}
        {campo("direccion", "Dirección")}
        {campo("telefono", "Teléfono", { inputMode: "tel" })}
        {campo("email", "Correo de la empresa", { type: "email" })}
        <label className="sm:col-span-2 flex items-center gap-2"><input type="checkbox" className="size-5" checked={f.responsable_iva} onChange={set("responsable_iva")} /> Responsable de IVA</label>
      </fieldset>
      <fieldset className="tarjeta p-5 grid sm:grid-cols-2 gap-3">
        <legend className="titulo text-xl px-1">Dueño (recibe el enlace para crear su contraseña)</legend>
        {campo("dueno_nombre", "Nombre", { required: true })}
        {campo("dueno_email", "Correo", { required: true, type: "email" })}
      </fieldset>
      <fieldset className="tarjeta p-5 grid gap-3">
        <legend className="titulo text-xl px-1">Numeraciones DIAN (opcional: se pueden poner después)</legend>
        <div className="grid sm:grid-cols-4 gap-3">{campo("pos_prefijo", "POS: prefijo")}{campo("pos_desde", "Desde", { inputMode: "numeric" })}{campo("pos_hasta", "Hasta", { inputMode: "numeric" })}{campo("pos_vence", "Vigente hasta", { type: "date" })}</div>
        <div className="grid sm:grid-cols-4 gap-3">{campo("fac_prefijo", "Factura: prefijo")}{campo("fac_desde", "Desde", { inputMode: "numeric" })}{campo("fac_hasta", "Hasta", { inputMode: "numeric" })}{campo("fac_vence", "Vigente hasta", { type: "date" })}</div>
        <label className="flex items-center gap-2"><input type="checkbox" className="size-5" checked={f.pruebas} onChange={set("pruebas")} /> Numeración de pruebas (habilitación); desmárcalo cuando sea la de producción</label>
      </fieldset>
      {error && <p role="alert" className="text-alerta font-semibold">{error}</p>}
      <div><button disabled={enviando} className="btn-primario h-12 px-8 disabled:opacity-60">{enviando ? "Creando…" : "Crear cliente"}</button></div>
    </form>
  );
}
