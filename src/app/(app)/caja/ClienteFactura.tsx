"use client";
import { useEffect, useRef, useState } from "react";
import { pesos } from "@/lib/formato";

export type Cliente = { id: string; tipo_doc: string; numero_doc: string; dv: string | null; nombre: string; email: string | null; telefono: string | null };
const TIPOS = [["NIT", "NIT"], ["CC", "Cédula"], ["CE", "Cédula de extranjería"], ["PP", "Pasaporte"], ["PEP", "PEP"]] as const;

export const documento = (c: Cliente) => `${c.tipo_doc} ${c.numero_doc}${c.dv ? `-${c.dv}` : ""}`;

/** Respuesta de GET /api/clientes/[id]/credito (contrato con la caja). */
export type CreditoCaja = { id: string; bloqueado: boolean; puede_fiar: boolean; requiere_motivo: boolean; motivo: string | null; aviso: string | null; cupo: number | null; cupo_disponible: number | null; saldo: number; dias_mora: number; plazo_dias: number | null };

/** Cupo disponible y motivo cuando no se le puede fiar. Con `total`, evalúa la venta en curso (supera el cupo…). */
function CreditoDelCliente({ id, total, onCredito, gerencia }: { id: string; total?: number; onCredito?: (c: CreditoCaja | null) => void; gerencia?: boolean }) {
  const [c, setC] = useState<CreditoCaja | null>(null);
  useEffect(() => {
    const ctl = new AbortController();
    const h = setTimeout(async () => {
      try {
        const r = await fetch(`/api/clientes/${id}/credito${total ? `?valor=${Math.round(total)}` : ""}`, { signal: ctl.signal });
        const j: CreditoCaja | null = r.ok ? { ...(await r.json()), id } : null;
        setC(j); onCredito?.(j);
      } catch { /* cancelada o sin conexión: no se muestra */ }
    }, total === undefined ? 0 : 250);
    return () => { clearTimeout(h); ctl.abort(); };
  }, [id, total, onCredito]);
  if (!c) return null;
  if (c.cupo === null && c.puede_fiar && c.saldo === 0) return null; // gerencia, cliente sin cupo ni deuda: nada que avisar
  // Cajera y cliente sin cupo asignado (sin deuda, bloqueo ni mora): no es una alerta, solo que la venta va de contado.
  if (!gerencia && c.cupo === null && c.saldo === 0 && !c.bloqueado && !c.dias_mora) return <p className="mt-2 text-sm text-muted">Sin cupo de crédito asignado: se factura de contado.</p>;
  return (
    <div className="mt-2 text-sm" aria-live="polite">
      {c.cupo !== null && <p className="num">Cupo disponible <b className={c.cupo_disponible ? "text-cruz" : "text-alerta"}>{pesos(c.cupo_disponible ?? 0)}</b> de {pesos(c.cupo)}{c.saldo > 0 ? ` · debe ${pesos(c.saldo)}` : ""}</p>}
      {c.cupo === null && c.saldo > 0 && <p className="num">Debe {pesos(c.saldo)}</p>}
      {!c.puede_fiar && c.motivo && <p role="status" className="mt-1 rounded-lg bg-aviso-soft text-aviso px-2.5 py-1.5 font-semibold">No se le puede fiar: {c.motivo}{c.requiere_motivo ? ". Puedes autorizarlo con un motivo." : "."}</p>}
    </div>
  );
}

/** Cliente de la factura electrónica: buscar por NIT, cédula o nombre, o crearlo sin salir de la venta. */
export function ClienteFactura({ cliente, onCambio, total, onCredito, gerencia }: { cliente: Cliente | null; onCambio: (c: Cliente | null) => void;
  /** Dueño o administrador (pueden autorizar con un motivo). */ gerencia?: boolean;
  /** Total de la venta en curso, para saber si cabe en el cupo (opcional). */ total?: number;
  /** Recibe el estado de crédito del cliente elegido (para que la caja decida si muestra «Crédito» o pide el motivo). */ onCredito?: (c: CreditoCaja | null) => void }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Cliente[]>([]);
  const [buscado, setBuscado] = useState(false);
  const [recientes, setRecientes] = useState<Cliente[] | null>(null);
  async function cargarRecientes() {
    if (recientes) return;
    try { const r = await fetch("/api/clientes?recientes=1"); const j = await r.json(); setRecientes(j.clientes ?? []); } catch { setRecientes([]); }
  }
  const [nuevo, setNuevo] = useState(false);
  const [f, setF] = useState({ tipo_doc: "NIT", numero_doc: "", nombre: "", email: "", telefono: "", autoriza_datos: false });
  const [error, setError] = useState("");
  const [guardando, setGuardando] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = q.trim();
    if (t.length < 2) { setRes([]); setBuscado(false); return; }
    const ctl = new AbortController();
    const h = setTimeout(async () => {
      try {
        const r = await fetch(`/api/clientes?q=${encodeURIComponent(t)}`, { signal: ctl.signal });
        const j = await r.json();
        setRes(j.clientes ?? []); setBuscado(true);
      } catch { /* cancelada */ }
    }, 200);
    return () => { clearTimeout(h); ctl.abort(); };
  }, [q]);

  async function crear(e: React.FormEvent) {
    e.preventDefault();
    if (guardando) return;
    setGuardando(true); setError("");
    try {
      const r = await fetch("/api/clientes", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(f) });
      const j = await r.json();
      if (!r.ok) { setError(j.error ?? "No se pudo guardar el cliente"); return; }
      onCambio(j.cliente); setNuevo(false); setQ("");
    } catch { setError("Sin conexión con el servidor: vuelve a intentarlo"); } finally { setGuardando(false); }
  }

  if (cliente) return (
    <div className="mx-6 mt-3 rounded-xl border border-line bg-paper px-4 py-3 flex items-start justify-between gap-3">
      <div className="min-w-0">
        <p className="text-xs text-muted">Facturar a</p>
        <p className="font-semibold leading-snug">{cliente.nombre}</p>
        <p className="text-sm text-muted num">{documento(cliente)}{cliente.email ? ` · ${cliente.email}` : ""}</p>
        {!cliente.email && <CorreoFaltante id={cliente.id} onListo={(email) => onCambio({ ...cliente, email })} />}
        <CreditoDelCliente id={cliente.id} total={total} onCredito={onCredito} gerencia={gerencia} />
      </div>
      <button onClick={() => { onCambio(null); setTimeout(() => input.current?.focus(), 0); }} className="text-sm font-semibold underline shrink-0">Cambiar</button>
    </div>
  );

  if (nuevo) return (
    <form onSubmit={crear} className="mx-6 mt-3 rounded-xl border border-line bg-paper p-4 grid gap-3" aria-label="Nuevo cliente">
      <div className="flex items-baseline justify-between"><p className="font-semibold">Nuevo cliente</p><button type="button" onClick={() => setNuevo(false)} className="text-sm text-muted">Cancelar</button></div>
      <div className="grid grid-cols-[110px_1fr] gap-2">
        <div><label htmlFor="cf-tipo" className="text-xs font-semibold">Documento</label>
          <select id="cf-tipo" className="campo mt-1" value={f.tipo_doc} onChange={(e) => setF({ ...f, tipo_doc: e.target.value })}>{TIPOS.map(([v, t]) => <option key={v} value={v}>{t}</option>)}</select></div>
        <div><label htmlFor="cf-num" className="text-xs font-semibold">Número {f.tipo_doc === "NIT" && <span className="font-normal text-muted">(sin DV: lo calculamos)</span>}</label>
          <input id="cf-num" className="campo mt-1 num" inputMode={f.tipo_doc === "PP" ? "text" : "numeric"} required value={f.numero_doc} onChange={(e) => setF({ ...f, numero_doc: e.target.value.replace(/[.\s-]/g, "") })} /></div>
      </div>
      <div><label htmlFor="cf-nom" className="text-xs font-semibold">{f.tipo_doc === "NIT" ? "Razón social" : "Nombre completo"}</label>
        <input id="cf-nom" className="campo mt-1" required value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></div>
      <div className="grid grid-cols-2 gap-2">
        <div><label htmlFor="cf-mail" className="text-xs font-semibold">Correo para la factura</label>
          <input id="cf-mail" type="email" required className="campo mt-1" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        <div><label htmlFor="cf-tel" className="text-xs font-semibold">Teléfono</label>
          <input id="cf-tel" inputMode="tel" className="campo mt-1" value={f.telefono} onChange={(e) => setF({ ...f, telefono: e.target.value })} /></div>
      </div>
      <label className="flex items-start gap-2 text-sm"><input type="checkbox" className="mt-1" checked={f.autoriza_datos} onChange={(e) => setF({ ...f, autoriza_datos: e.target.checked })} />
        El cliente autoriza el tratamiento de sus datos (Ley 1581 de 2012)</label>
      {error && <p role="alert" className="text-alerta text-sm">{error}</p>}
      <button disabled={guardando} className="h-11 rounded-xl bg-ink text-white font-semibold disabled:opacity-60">{guardando ? "Guardando…" : "Guardar y facturar a este cliente"}</button>
    </form>
  );

  return (
    <div className="mx-6 mt-3">
      <label htmlFor="cf-buscar" className="text-sm font-semibold">Cliente de la factura</label>
      <input id="cf-buscar" ref={input} value={q} onChange={(e) => setQ(e.target.value)} onFocus={cargarRecientes} placeholder="NIT, cédula o nombre" autoComplete="off" className="campo mt-1" />
      {!q.trim() && recientes && recientes.length > 0 && (
        <div className="mt-2">
          <p className="text-xs text-muted">Clientes recientes</p>
          <ul className="mt-1 rounded-xl border border-line divide-y divide-line bg-surface overflow-hidden">
            {recientes.map((c) => (
              <li key={c.id}><button onClick={() => onCambio(c)} className="w-full text-left px-3 py-2.5 hover:bg-paper">
                <span className="block font-semibold leading-snug">{c.nombre}</span><span className="block text-sm text-muted num">{documento(c)}</span>
              </button></li>
            ))}
          </ul>
        </div>
      )}
      {res.length > 0 && (
        <ul className="mt-2 rounded-xl border border-line divide-y divide-line bg-surface overflow-hidden">
          {res.map((c) => (
            <li key={c.id}><button onClick={() => { onCambio(c); setQ(""); }} className="w-full text-left px-3 py-2 hover:bg-paper">
              <span className="block font-semibold leading-snug">{c.nombre}</span><span className="block text-sm text-muted num">{documento(c)}</span>
            </button></li>
          ))}
        </ul>
      )}
      {buscado && res.length === 0 && <p className="mt-2 text-sm text-muted">No hay clientes con «{q.trim()}».</p>}
      <button onClick={() => { setNuevo(true); setError(""); const t = q.trim(); if (/^\d{5,}$/.test(t)) setF((x) => ({ ...x, numero_doc: t })); else if (t) setF((x) => ({ ...x, nombre: t })); }}
        className="mt-2 text-sm font-semibold underline">+ Crear cliente nuevo</button>
    </div>
  );
}

/** La factura electrónica necesita el correo del cliente: si no lo tiene, se escribe aquí mismo (sin salir de la caja). */
function CorreoFaltante({ id, onListo }: { id: string; onListo: (email: string) => void }) {
  const [email, setEmail] = useState(""), [error, setError] = useState(""), [guardando, setGuardando] = useState(false);
  async function guardar() {
    if (guardando) return;
    setGuardando(true); setError("");
    const r = await fetch(`/api/clientes/${id}/correo`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setGuardando(false);
    if (!r?.ok) { setError(r ? (j.error ?? "No se pudo guardar") : "Sin conexión con el servidor"); return; }
    onListo(j.email);
  }
  return (
    <div className="mt-2 grid gap-1.5">
      <label htmlFor="cf-correo-falta" className="text-xs font-semibold text-alerta">Falta el correo: la factura electrónica lo necesita</label>
      <div className="flex gap-2">
        <input id="cf-correo-falta" type="email" inputMode="email" className="campo h-10 min-w-0" value={email} placeholder="correo@ejemplo.com"
          onChange={(e) => { setEmail(e.target.value); setError(""); }} onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); void guardar(); } }} />
        <button type="button" onClick={() => void guardar()} disabled={guardando || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email.trim())} className="h-10 px-3 rounded-lg bg-ink text-white text-sm font-semibold disabled:opacity-40 shrink-0">{guardando ? "…" : "Guardar"}</button>
      </div>
      {error && <p role="alert" className="text-xs text-alerta">{error}</p>}
    </div>
  );
}
