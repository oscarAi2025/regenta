"use client";
import { useRef, useState } from "react";
import type { DocSoporte } from "@/lib/dian/soporte";
import { calcularLinea, leerNumero, pesosExactos } from "@/lib/compras";

// Nota débito de una factura electrónica: aumenta su valor (intereses, fletes, un ajuste de precio). Un concepto con su
// valor o un mayor valor sobre líneas de la factura. No mueve caja, cartera ni inventario. Solo dueño o administrador.

type Datos = {
  factura: { id: string; numero: string; estado: string; simulado: boolean; venta_id: string; venta: string; venta_estado: string; total: number; fecha: string; cliente: string | null; cliente_doc: string | null };
  lineas: { descripcion: string; cantidad: number; iva_pct: number; base: number; total: number }[];
  notas: DocSoporte[];
  bloqueo: string | null;
};
const ESTADO: Record<string, [string, string]> = {
  aceptado: ["Aceptado", "bg-cruz-soft text-cruz"], simulado: ["Simulado", "bg-sky-100 text-sky-900"], pendiente: ["Enviando", "bg-aviso-soft text-aviso"],
  rechazado: ["Rechazado", "bg-alerta-soft text-alerta"], anulado: ["No emitido", "bg-paper text-muted"],
};
const enlace = "font-semibold text-cruz underline-offset-2 hover:underline";
const decimal = (s: string) => s.replace(/[^\d.,]/g, "");

export function NotaDebito({ inicial }: { inicial: Datos }) {
  const [d, setD] = useState(inicial);
  const [modo, setModo] = useState<"concepto" | "lineas">("concepto");
  const [concepto, setConcepto] = useState(""); const [valor, setValor] = useState(""); const [iva, setIva] = useState(0);
  const [extra, setExtra] = useState<Record<number, string>>({});
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState(""); const [aviso, setAviso] = useState(""); const [ocupado, setOcupado] = useState(false);
  const idem = useRef<string | null>(null);
  const f = d.factura;
  const valida = f.venta_estado !== "anulada" && f.estado !== "rechazado" && f.estado !== "anulado";

  const lineas = modo === "concepto"
    ? (leerNumero(valor) ? [{ descripcion: concepto.trim(), cantidad: 1, valor: leerNumero(valor)!, iva_pct: iva }] : [])
    : d.lineas.flatMap((l, i) => { const v = leerNumero(extra[i] ?? ""); return v ? [{ descripcion: `Mayor valor · ${l.descripcion}`.slice(0, 300), cantidad: 1, valor: v, iva_pct: l.iva_pct }] : []; });
  const total = Math.round(lineas.reduce((s, l) => s + calcularLinea(l.valor, 1, 1, 0, l.iva_pct).total, 0) * 100) / 100;

  async function guardar(ev: React.FormEvent) {
    ev.preventDefault();
    setError(""); setAviso("");
    if (modo === "concepto" && concepto.trim().length < 2) { setError("Escribe el concepto de la nota débito."); return; }
    if (!lineas.length) { setError(modo === "concepto" ? "Escribe el valor sin IVA." : "Pon el mayor valor de al menos una línea."); return; }
    if (motivo.trim().length < 4) { setError("Escribe el motivo de la nota débito."); return; }
    setOcupado(true);
    idem.current ??= crypto.randomUUID();
    try {
      const r = await fetch("/api/dian/nota-debito", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ documento_id: f.id, motivo, lineas, idem_key: idem.current }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setError(j.error ?? "No se pudo generar la nota débito"); return; }
      idem.current = null;
      setD({ factura: j.factura, lineas: j.lineas, notas: j.notas, bloqueo: j.bloqueo });
      const n = (j.notas as DocSoporte[]).find((x) => x.numero === j.numero);
      setAviso(`Nota débito ${j.numero} por ${pesosExactos(j.total)} generada (${n ? (ESTADO[n.estado]?.[0] ?? n.estado).toLowerCase() : "en cola"}).`);
      setConcepto(""); setValor(""); setExtra({}); setMotivo("");
    } catch { setError("Sin conexión: revisa internet y vuelve a intentar."); } finally { setOcupado(false); }
  }

  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="titulo text-[32px] leading-tight">Nota débito</h1>
          <p className="text-muted mt-0.5 break-words">Factura <b className="num text-ink">{f.numero}</b> del <span className="num">{f.fecha}</span> · {f.cliente ?? "Consumidor final"}{f.cliente_doc ? ` · ${f.cliente_doc}` : ""} · <span className="num">{pesosExactos(f.total)}</span></p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={`/ventas/${f.venta_id}`} className="btn-borde">Ver venta {f.venta}</a>
          <a href="/documentos?tipo=nota_debito" className="btn-borde">Volver a documentos</a>
        </div>
      </div>
      <p className="text-sm text-muted max-w-3xl">La nota débito aumenta el valor de una factura ya emitida (intereses, fletes, un ajuste de precio) y se envía a la DIAN con referencia a la factura. No cambia la caja, la cartera ni el inventario: cobra la diferencia aparte.</p>
      {aviso && <p role="status" className="rounded-xl bg-cruz-soft text-cruz font-semibold px-4 py-3 break-words">{aviso}</p>}

      {!valida ? (
        <p role="note" className="rounded-xl bg-aviso-soft text-aviso px-4 py-3 font-semibold">{f.venta_estado === "anulada" ? "La venta de esta factura está anulada: no admite nota débito." : "Esta factura no está aceptada por la DIAN: corrígela y reenvíala antes de hacer una nota débito."}</p>
      ) : d.bloqueo ? (
        <p role="note" className="rounded-xl bg-aviso-soft text-aviso px-4 py-3 font-semibold break-words">{d.bloqueo}</p>
      ) : (
        <form onSubmit={guardar} className="tarjeta p-4 grid gap-4" aria-label="Nueva nota débito">
          <fieldset className="flex flex-wrap gap-1 rounded-xl border-2 border-line p-1 w-fit max-w-full"><legend className="sr-only">Cómo se arma</legend>
            {(["concepto", "lineas"] as const).map((k) => (
              <label key={k} className={`px-3.5 h-9 inline-flex items-center rounded-lg text-sm font-semibold cursor-pointer ${modo === k ? "bg-ink text-white" : "text-muted"}`}>
                <input type="radio" name="modo-nd" checked={modo === k} onChange={() => { setModo(k); setError(""); }} className="sr-only" />{k === "concepto" ? "Un concepto" : "Sobre las líneas de la factura"}</label>
            ))}
          </fieldset>
          {modo === "concepto" ? (
            <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_170px_130px]">
              <div><label htmlFor="nd-concepto" className="etiqueta">Concepto</label><input id="nd-concepto" value={concepto} onChange={(e) => setConcepto(e.target.value)} maxLength={300} className="campo" placeholder="Por ejemplo: flete del domicilio" /></div>
              <div><label htmlFor="nd-valor" className="etiqueta">Valor sin IVA</label><input id="nd-valor" inputMode="decimal" value={valor} onChange={(e) => setValor(decimal(e.target.value))} className="campo num" /></div>
              <div><label htmlFor="nd-iva" className="etiqueta">IVA</label><select id="nd-iva" value={iva} onChange={(e) => setIva(Number(e.target.value))} className="campo">{[0, 5, 19].map((t) => <option key={t} value={t}>{t} %</option>)}</select></div>
            </div>
          ) : (
            <ul className="grid gap-2" aria-label="Líneas de la factura">
              {d.lineas.map((l, i) => (
                <li key={i} className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <label htmlFor={`nd-linea-${i}`} className="flex-1 min-w-[200px] break-words"><b>{l.descripcion}</b> <span className="text-sm text-muted num">· {l.cantidad} · {pesosExactos(l.total)} · IVA {l.iva_pct} %</span></label>
                  <input id={`nd-linea-${i}`} inputMode="decimal" value={extra[i] ?? ""} onChange={(e) => setExtra({ ...extra, [i]: decimal(e.target.value) })} className="campo h-10 w-40 num" placeholder="Mayor valor sin IVA" />
                </li>
              ))}
            </ul>
          )}
          <div><label htmlFor="nd-motivo" className="etiqueta">Motivo</label><input id="nd-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} className="campo" placeholder="Por qué aumenta el valor de la factura" /></div>
          <p className="num font-semibold">Total de la nota (con IVA): {pesosExactos(total)}</p>
          {error && <p role="alert" className="text-alerta font-semibold break-words">{error}</p>}
          <div><button disabled={ocupado} className="btn-primario">{ocupado ? "Generando…" : "Generar nota débito"}</button></div>
        </form>
      )}

      <section className="tarjeta p-4 grid gap-2" aria-labelledby="nd-hechas">
        <h2 id="nd-hechas" className="titulo text-xl">Notas débito de esta factura</h2>
        {d.notas.length === 0 ? <p className="text-muted">Ninguna todavía.</p> : (
          <ul className="divide-y divide-line">
            {d.notas.map((n) => (
              <li key={n.id} className="py-2.5 grid gap-1">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <p className="flex-1 min-w-0"><b className="num">{n.numero}</b> · <span className="num">{n.fecha}</span> · <span className="num font-semibold">{pesosExactos(n.total)}</span></p>
                  <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[13px] font-semibold ${ESTADO[n.estado]?.[1] ?? ""}`}>{ESTADO[n.estado]?.[0] ?? n.estado}</span>
                </div>
                <p className="text-sm text-muted break-words">Motivo: {n.motivo}</p>
                {n.estado === "rechazado" && <p className="text-sm text-alerta break-words">{n.ultimo_error}</p>}
                <p className="flex flex-wrap gap-x-3 text-sm">
                  {n.xml && <a href={`/api/documentos/${n.id}/xml`} download className={enlace} aria-label={`Descargar el XML de ${n.numero}`}>XML</a>}
                  {n.pdf && <a href={n.pdf} target="_blank" rel="noopener noreferrer" className={enlace}>PDF</a>}
                  {n.cufe && <span className="text-muted break-all num">CUDE {n.cufe.slice(0, 24)}…</span>}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}
