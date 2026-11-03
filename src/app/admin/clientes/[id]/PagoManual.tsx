"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

const PRECIO: Record<string, Record<string, number>> = { esencial: { mes: 89900, anio: 899000 }, pro: { mes: 139900, anio: 1399000 } };

/** Registrar un pago recibido por transferencia, consignación o efectivo: aplica plan, vencimiento y reactivación. */
export function PagoManual({ empresa, plan }: { empresa: string; plan: string }) {
  const [abierto, setAbierto] = useState(false);
  const [f, setF] = useState({ plan: plan === "pro" ? "pro" : "esencial", periodo: "mes", monto: String(PRECIO[plan === "pro" ? "pro" : "esencial"].mes), medio: "Transferencia", soporte: "" });
  const [msg, setMsg] = useState(""), [enviando, setEnviando] = useState(false);
  const router = useRouter();
  const cambiar = (k: string, v: string) => { const n = { ...f, [k]: v }; if (k === "plan" || k === "periodo") n.monto = String(PRECIO[n.plan][n.periodo]); setF(n); };
  async function guardar(e: React.FormEvent) {
    e.preventDefault(); setEnviando(true); setMsg("");
    const r = await fetch(`/api/admin/clientes/${empresa}/pagos`, { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...f, monto: Number(f.monto.replace(/\D/g, "")), soporte: f.soporte || undefined }) }).catch(() => null);
    const j = await r?.json().catch(() => ({}));
    setMsg(r?.ok ? j.mensaje : j?.error ?? "Sin conexión"); setEnviando(false);
    if (r?.ok) { setAbierto(false); router.refresh(); }
  }
  if (!abierto) return <div className="flex flex-wrap items-center gap-2"><button onClick={() => setAbierto(true)} className="btn-borde h-10 text-sm">Registrar pago manual</button>{msg && <span role="status" className="text-sm text-muted">{msg}</span>}</div>;
  return (
    <form onSubmit={guardar} className="grid sm:grid-cols-3 gap-2 items-end border-t border-line pt-3">
      <label className="text-sm font-semibold">Plan<select className="campo font-normal" value={f.plan} onChange={(e) => cambiar("plan", e.target.value)}><option value="esencial">Esencial</option><option value="pro">Pro</option></select></label>
      <label className="text-sm font-semibold">Periodo<select className="campo font-normal" value={f.periodo} onChange={(e) => cambiar("periodo", e.target.value)}><option value="mes">Mensual</option><option value="anio">Anual</option></select></label>
      <label className="text-sm font-semibold">Valor recibido<input inputMode="numeric" className="campo num font-normal" value={Number(f.monto.replace(/\D/g, "") || 0).toLocaleString("es-CO")} onChange={(e) => setF({ ...f, monto: e.target.value })} /></label>
      <label className="text-sm font-semibold">Medio<select className="campo font-normal" value={f.medio} onChange={(e) => setF({ ...f, medio: e.target.value })}>{["Transferencia", "Consignación", "Efectivo", "Otro"].map((m) => <option key={m}>{m}</option>)}</select></label>
      <label className="text-sm font-semibold sm:col-span-2">Soporte (n.º de transacción o nota)<input className="campo font-normal" value={f.soporte} onChange={(e) => setF({ ...f, soporte: e.target.value })} maxLength={80} /></label>
      <div className="flex gap-2 sm:col-span-3"><button disabled={enviando} className="btn-primario h-10 text-sm disabled:opacity-60">{enviando ? "Guardando…" : "Registrar pago"}</button><button type="button" onClick={() => setAbierto(false)} className="text-sm text-muted">Cancelar</button></div>
      {msg && <p role="alert" className="text-sm text-alerta sm:col-span-3">{msg}</p>}
    </form>
  );
}
