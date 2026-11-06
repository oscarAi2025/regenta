"use client";
import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { MEDIO, pesos } from "@/lib/formato";
import { imprimirRuta } from "@/lib/impresion";

type Deudor = { id: string; nombre: string; documento: string; saldo: number; facturas: number; dias_mora: number };
type Hecho = { id: number; numero: number; valor: number; saldo: number; aplicado: { factura: string; valor: number; saldo: number }[] };
const entero = (v: string) => Number(v.replace(/\D/g, "") || 0);
const conPuntos = (n: number) => (n ? pesos(n).slice(1) : "");

/** Recibir un pago de un cliente que debe: buscarlo, ver su saldo, valor y medio. Emite el recibo de caja (tirilla) y el
 *  pago se reparte solo entre sus facturas, la que vence antes primero. Con `cliente` fijo (ficha) no se busca. */
export function RecibirAbono({ cliente, abierto: abiertoInicial = false }: { cliente?: Deudor; abierto?: boolean }) {
  const [abierto, setAbierto] = useState(abiertoInicial);
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Deudor[] | null>(null);
  const [elegido, setElegido] = useState<Deudor | null>(cliente ?? null);
  const [valor, setValor] = useState("");
  const [medio, setMedio] = useState("efectivo");
  const [ref, setRef] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [hecho, setHecho] = useState<Hecho | null>(null);
  const buscar = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    if (!abierto || elegido) return;
    const ctl = new AbortController();
    const h = setTimeout(async () => {
      try {
        const r = await fetch(`/api/recibos?q=${encodeURIComponent(q.trim())}`, { signal: ctl.signal });
        const j = await r.json();
        setRes(r.ok ? j.clientes ?? [] : []);
        if (!r.ok) setError(j.error ?? "No se pudo buscar");
      } catch { /* cancelada */ }
    }, 200);
    return () => { clearTimeout(h); ctl.abort(); };
  }, [q, abierto, elegido]);

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (enviando || !elegido) return;
    setEnviando(true); setError("");
    try {
      const r = await fetch("/api/recibos", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ cliente_id: elegido.id, medio, valor: entero(valor), referencia: ref.trim() || null }) });
      const j = await r.json();
      if (!r.ok) { setError(j.error ?? "No se pudo registrar el pago"); return; }
      const rc: Hecho = { ...j.recibo, aplicado: (j.recibo.aplicado ?? []).map((a: { factura: string; valor: unknown; saldo: unknown }) => ({ factura: a.factura, valor: Number(a.valor), saldo: Number(a.saldo) })) };
      setHecho(rc);
      imprimirRuta(`/tiquete/recibo/${rc.id}`);
      router.refresh(); // el resto de la pantalla (turno, estado de cuenta); lo guardado ya se ve aquí
    } catch { setError("Sin conexión con el servidor: vuelve a intentarlo"); } finally { setEnviando(false); }
  }

  function otro() {
    setHecho(null); setValor(""); setRef(""); setMedio("efectivo"); setError("");
    if (!cliente) { setElegido(null); setQ(""); setTimeout(() => buscar.current?.focus(), 0); }
  }

  if (cliente && cliente.saldo <= 0 && !hecho) return null;
  if (!abierto) return (
    <button className="btn-primario h-11" onClick={() => { setAbierto(true); setTimeout(() => buscar.current?.focus(), 0); }}>Recibir abono</button>
  );

  if (hecho) return (
    <section className="tarjeta p-5 grid gap-3" aria-live="polite" aria-label="Recibo registrado">
      <h2 className="titulo text-xl">Recibo de caja RC-{hecho.numero}</h2>
      <p className="rounded-xl bg-cruz text-cruz-ink px-4 py-3 font-semibold">Recibiste {pesos(hecho.valor)}. {hecho.saldo > 0 ? `Queda debiendo ${pesos(hecho.saldo)}.` : "Quedó a paz y salvo."}</p>
      <ul className="text-sm num divide-y divide-line">
        {hecho.aplicado.map((a) => <li key={a.factura} className="py-1.5 flex justify-between gap-3"><span>{a.factura}</span><span>{pesos(a.valor)}{a.saldo > 0 ? ` · queda ${pesos(a.saldo)}` : " · pagada"}</span></li>)}
      </ul>
      <div className="flex flex-wrap gap-2">
        <button className="btn-borde h-10 text-sm" onClick={() => imprimirRuta(`/tiquete/recibo/${hecho.id}`)}>Imprimir otra vez</button>
        <a className="btn-borde h-10 text-sm inline-flex items-center" href={`/tiquete/recibo/${hecho.id}`} target="_blank" rel="noopener">Ver recibo</a>
        <button className="btn-primario h-10 text-sm" onClick={otro}>{cliente ? "Recibir otro pago" : "Recibir otro abono"}</button>
      </div>
    </section>
  );

  return (
    <section className="tarjeta p-5 grid gap-3 min-w-0" aria-label="Recibir abono">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="titulo text-xl">Recibir abono</h2>
        {!abiertoInicial && <button type="button" className="text-sm text-muted" onClick={() => { setAbierto(false); setError(""); }}>Cerrar</button>}
      </div>
      {!elegido ? (
        <div className="grid gap-2">
          <label htmlFor="ra-buscar" className="etiqueta">Cliente que paga</label>
          <input id="ra-buscar" ref={buscar} className="campo" placeholder="Nombre, cédula o NIT" autoComplete="off" value={q} onChange={(e) => setQ(e.target.value)} />
          {res && res.length > 0 && (
            <ul className="rounded-xl border border-line divide-y divide-line bg-surface overflow-hidden" aria-label="Clientes con saldo">
              {res.map((c) => (
                <li key={c.id}><button type="button" onClick={() => { setElegido(c); setError(""); }} className="w-full text-left px-3 py-2.5 hover:bg-paper flex justify-between gap-3">
                  <span className="min-w-0"><span className="block font-semibold leading-snug">{c.nombre}</span><span className="block text-sm text-muted num">{c.documento}</span></span>
                  <span className="text-right shrink-0"><span className="block num font-semibold">{pesos(c.saldo)}</span>{c.dias_mora > 0 && <span className="block text-xs text-alerta">{c.dias_mora} días de mora</span>}</span>
                </button></li>
              ))}
            </ul>
          )}
          {res && res.length === 0 && <p className="text-sm text-muted">{q.trim() ? `Nadie con saldo pendiente coincide con «${q.trim()}».` : "Ningún cliente tiene saldo pendiente."}</p>}
        </div>
      ) : (
        <form className="grid gap-3" onSubmit={guardar} aria-label="Pago del cliente">
          <div className="rounded-xl bg-paper px-4 py-3 flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="font-semibold leading-snug">{elegido.nombre}</p>
              <p className="text-sm text-muted num">{elegido.documento} · {elegido.facturas} factura{elegido.facturas === 1 ? "" : "s"}</p>
              <p className="mt-1 num">Debe <b>{pesos(elegido.saldo)}</b>{elegido.dias_mora > 0 && <span className="text-alerta text-sm"> · {elegido.dias_mora} días de mora</span>}</p>
            </div>
            {!cliente && <button type="button" className="text-sm font-semibold underline shrink-0" onClick={() => { setElegido(null); setValor(""); }}>Cambiar</button>}
          </div>
          <div className="grid sm:grid-cols-2 gap-3">
            <div>
              <label htmlFor="ra-valor" className="etiqueta">Valor que paga</label>
              <input id="ra-valor" inputMode="numeric" required className="campo num" placeholder="$ 0" value={valor ? `$ ${conPuntos(entero(valor))}` : ""} onChange={(e) => setValor(e.target.value)} />
              <button type="button" className="mt-1 text-sm underline" onClick={() => setValor(String(Math.round(elegido.saldo)))}>Todo el saldo</button>
            </div>
            <div>
              <label htmlFor="ra-medio" className="etiqueta">Medio de pago</label>
              <select id="ra-medio" className="campo" value={medio} onChange={(e) => setMedio(e.target.value)}>
                {Object.entries(MEDIO).map(([k, t]) => <option key={k} value={k}>{t}</option>)}
              </select>
            </div>
          </div>
          <div>
            <label htmlFor="ra-ref" className="etiqueta">Referencia (opcional)</label>
            <input id="ra-ref" className="campo" maxLength={60} placeholder="N.º de transferencia, comprobante…" value={ref} onChange={(e) => setRef(e.target.value)} />
          </div>
          {entero(valor) > elegido.saldo && <p className="text-sm text-alerta">El valor pasa lo que debe ({pesos(elegido.saldo)}): recibe como máximo el saldo.</p>}
          {error && <p role="alert" className="text-sm text-alerta font-semibold">{error}</p>}
          <button className="btn-primario h-12" disabled={enviando || entero(valor) <= 0 || entero(valor) > elegido.saldo}>{enviando ? "Guardando…" : `Recibir ${entero(valor) ? pesos(entero(valor)) : "pago"} e imprimir recibo`}</button>
        </form>
      )}
      {!elegido && error && <p role="alert" className="text-sm text-alerta font-semibold">{error}</p>}
    </section>
  );
}
