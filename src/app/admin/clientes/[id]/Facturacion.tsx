"use client";
import { useState } from "react";

type Res = { tipo: "pos" | "factura" | "nota_credito"; prefijo: string; numero: string; pruebas: boolean };
const NOMBRE = { pos: "POS electrónico", factura: "Factura electrónica", nota_credito: "Nota crédito" } as const;

/** Conexión del cliente con MATIAS: su UUID en la casa de software y el número de resolución DIAN de cada numeración. */
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
        <input id="matias-uuid" className="campo num" placeholder="Vacío = la propia cuenta de MATIAS (NIT de Regenta)" value={uuid} onChange={(e) => setUuid(e.target.value)} />
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
    </section>
  );
}
