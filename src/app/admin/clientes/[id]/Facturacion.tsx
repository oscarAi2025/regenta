"use client";
import { useState } from "react";

type Res = { tipo: "pos" | "factura" | "nota_credito"; prefijo: string; numero: string; pruebas: boolean };
const NOMBRE = { pos: "POS electrónico", factura: "Factura electrónica", nota_credito: "Nota crédito" } as const;

/** Conexión del cliente con MATIAS: su UUID en la casa de software y el número de resolución DIAN de cada numeración. */
/** Cargar la numeración que autorizó la DIAN (reemplaza la vigente del mismo tipo). */
function NuevaNumeracion({ empresa }: { empresa: string }) {
  const [f, setF] = useState({ tipo: "pos", prefijo: "", desde: "", hasta: "", numero_resolucion: "", vigente_desde: "", vigente_hasta: "", pruebas: false });
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const campo = (k: keyof typeof f, etiqueta: string, extra: Record<string, unknown> = {}) => (
    <label className="grid text-sm"><span className="etiqueta">{etiqueta}</span>
      <input className="campo num" value={String(f[k])} onChange={(e) => setF({ ...f, [k]: e.target.value })} {...extra} /></label>
  );
  async function guardar() {
    setEnviando(true); setMsg(null);
    const r = await fetch(`/api/admin/clientes/${empresa}/numeraciones`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...f, desde: Number(f.desde), hasta: Number(f.hasta) }) }).catch(() => null);
    const j = await r?.json().catch(() => ({}));
    setEnviando(false);
    if (r?.ok) { setMsg({ ok: true, t: j.mensaje }); setTimeout(() => location.reload(), 900); } else setMsg({ ok: false, t: j?.error ?? "No se pudo guardar" });
  }
  return (
    <details className="rounded-xl border border-line p-4">
      <summary className="cursor-pointer font-semibold">Cargar numeración autorizada por la DIAN</summary>
      <p className="text-sm text-muted mt-2">Los datos de la resolución de numeración (MUISCA). Reemplaza la numeración vigente de ese tipo; la siguiente venta usa la nueva.</p>
      <div className="mt-3 grid sm:grid-cols-4 gap-3">
        <label className="grid text-sm"><span className="etiqueta">Documento</span>
          <select className="campo" value={f.tipo} onChange={(e) => setF({ ...f, tipo: e.target.value })} aria-label="Tipo de documento">
            <option value="pos">POS electrónico</option><option value="factura">Factura electrónica</option><option value="nota_credito">Nota crédito</option>
          </select></label>
        {campo("prefijo", "Prefijo", { placeholder: "POS1", maxLength: 4 })}
        {campo("desde", "Desde", { inputMode: "numeric", placeholder: "1" })}
        {campo("hasta", "Hasta", { inputMode: "numeric", placeholder: "5000" })}
        {campo("numero_resolucion", "Número de resolución", { inputMode: "numeric", placeholder: "18764…" })}
        {campo("vigente_desde", "Vigente desde", { type: "date" })}
        {campo("vigente_hasta", "Vigente hasta", { type: "date" })}
        <label className="flex items-center gap-2 text-sm self-end h-11"><input type="checkbox" className="size-5 accent-teal-600" checked={f.pruebas} onChange={(e) => setF({ ...f, pruebas: e.target.checked })} />Es de pruebas (habilitación)</label>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <button onClick={guardar} disabled={enviando} className="btn-oscuro h-10 text-sm">{enviando ? "Guardando…" : "Guardar numeración"}</button>
        {msg && <span role="status" className={`text-sm font-semibold ${msg.ok ? "text-cruz" : "text-alerta"}`}>{msg.t}</span>}
      </div>
    </details>
  );
}

export function Facturacion({ empresa, cliente, resoluciones, emisor }: { empresa: string; cliente: string; resoluciones: Res[]; emisor: string }) {
  const [uuid, setUuid] = useState(cliente);
  const [res, setRes] = useState(resoluciones);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const cambiar = (i: number, x: Partial<Res>) => setRes(res.map((r, j) => (j === i ? { ...r, ...x } : r)));
  async function guardar() {
    setEnviando(true); setMsg(null);
    const r = await fetch(`/api/admin/clientes/${empresa}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ matias: { cliente: uuid.trim(), resoluciones: res } }) }).catch(() => null);
    const j = await r?.json().catch(() => ({}));
    setMsg(r?.ok ? { ok: true, t: j.mensaje ?? "Guardado" } : { ok: false, t: j?.error ?? "No se pudo guardar" }); setEnviando(false);
  }
  const listo = res.some((r) => !r.pruebas && r.numero);
  return (
    <section className="tarjeta p-5 grid gap-4" aria-label="Facturación electrónica">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <h2 className="titulo text-xl">Facturación electrónica (MATIAS)</h2>
        <span className={`pastilla h-8 text-[13px] ${emisor === "matias" && listo ? "bg-cruz-soft text-cruz" : "bg-aviso-soft text-aviso"}`}>{emisor !== "matias" ? "Servidor en modo simulado" : listo ? "Emite ante la DIAN" : "Falta la resolución de producción"}</span>
      </div>
      <div>
        <label htmlFor="matias-uuid" className="etiqueta">UUID del cliente en MATIAS</label>
        <input id="matias-uuid" className="campo num" placeholder="ac8ccdf4-…  (obligatorio para producción)" value={uuid} onChange={(e) => setUuid(e.target.value)} />
        <p className="text-sm text-muted mt-1">Está en MATIAS → Clientes, en la ficha de la droguería.</p>
      </div>
      {res.length ? (
        <ul className="grid gap-3">
          {res.map((r, i) => (
            <li key={r.tipo + r.prefijo} className="grid sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
              <div><p className="etiqueta">{NOMBRE[r.tipo]} · prefijo {r.prefijo || "(sin prefijo)"}</p>
                <input aria-label={`Número de resolución DIAN de ${NOMBRE[r.tipo]}`} className="campo num" inputMode="numeric" placeholder="Número de resolución DIAN" value={r.numero} onChange={(e) => cambiar(i, { numero: e.target.value.replace(/\D/g, "") })} /></div>
              <label className="flex items-center gap-2 h-11 text-sm"><input type="checkbox" className="size-5 accent-teal-600" checked={!r.pruebas} onChange={(e) => cambiar(i, { pruebas: !e.target.checked })} />Producción</label>
            </li>
          ))}
        </ul>
      ) : <p className="text-muted">Primero crea las numeraciones del cliente.</p>}
      <div className="flex items-center gap-3">
        <button onClick={guardar} disabled={enviando} className="btn-oscuro h-10 text-sm">{enviando ? "Guardando…" : "Guardar facturación electrónica"}</button>
        {msg && <span role="status" className={`text-sm font-semibold ${msg.ok ? "text-cruz" : "text-alerta"}`}>{msg.t}</span>}
      </div>
      <NuevaNumeracion empresa={empresa} />
    </section>
  );
}
