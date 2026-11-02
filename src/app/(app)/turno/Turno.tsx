"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { pesos, MEDIO } from "@/lib/formato";
import { imprimirRuta } from "@/lib/impresion";

type Resumen = { ventas: number; n_ventas: number; anuladas: number; iva: number; credito: number; medios: Record<string, number>; efectivo_ventas: number; abonos_efectivo: number; ingresos: number; egresos: number; base: number; efectivo_esperado: number };
type Estado = {
  caja: { id: string; nombre: string } | null; exige: boolean;
  turno: null | { id: string; base: number; abierto: string; abre: string | null; resumen: Resumen; movimientos: { tipo: string; valor: number; concepto: string; creado: string; usuario: string | null }[] };
};
const hora = (d: string) => new Date(d).toLocaleString("es-CO", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "America/Bogota" });
const entero = (v: string) => Number(v.replace(/\D/g, "") || 0);

export function Turno({ estado, dueno }: { estado: Estado; dueno: boolean }) {
  const router = useRouter();
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [base, setBase] = useState("");
  const [mov, setMov] = useState({ tipo: "egreso", valor: "", concepto: "" });
  const [contado, setContado] = useState("");
  const [obs, setObs] = useState("");
  const [cierre, setCierre] = useState<null | { turno: string; diferencia: number; esperado: number; contado: number }>(null);

  async function enviar(cuerpo: Record<string, unknown>) {
    setError(""); setOcupado(true);
    try {
      const r = await fetch("/api/turnos", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) });
      const j = await r.json();
      if (!r.ok) { setError(j.error ?? "No se pudo"); return null; }
      router.refresh();
      return j;
    } catch { setError("Sin conexión con el servidor"); return null; } finally { setOcupado(false); }
  }

  const t = estado.turno;
  if (!estado.caja) return <p className="tarjeta p-5 text-alerta">Esta empresa no tiene cajas activas.</p>;

  if (cierre) {
    const d = cierre.diferencia;
    return (
      <section className="tarjeta p-5 grid gap-3 max-w-xl" aria-live="polite">
        <h2 className="titulo text-2xl">Turno cerrado</h2>
        <dl className="grid grid-cols-2 gap-y-1 num">
          <dt className="text-muted">Efectivo esperado</dt><dd className="text-right">{pesos(cierre.esperado)}</dd>
          <dt className="text-muted">Dinero contado</dt><dd className="text-right">{pesos(cierre.contado)}</dd>
        </dl>
        <p className={`rounded-xl px-4 py-3 font-semibold ${d === 0 ? "bg-cruz text-cruz-ink" : d < 0 ? "bg-alerta-soft text-alerta" : "bg-aviso-soft text-aviso"}`}>
          {d === 0 ? "La caja cuadra exacto." : d < 0 ? `Faltan ${pesos(-d)} en la caja.` : `Sobran ${pesos(d)} en la caja.`}
        </p>
        <div className="flex gap-2">
          <button className="btn-primario h-11" onClick={() => imprimirRuta(`/tiquete/turno/${cierre.turno}`)}>Imprimir cierre</button>
          <button className="btn-borde h-11" onClick={() => setCierre(null)}>Listo</button>
        </div>
      </section>
    );
  }

  if (!t) return (
    <section className="tarjeta p-5 grid gap-4 max-w-xl">
      <h2 className="titulo text-2xl">Abrir turno · {estado.caja.nombre}</h2>
      <form className="grid gap-3" onSubmit={async (e) => { e.preventDefault(); await enviar({ accion: "abrir", base: entero(base) }); }}>
        <div><label htmlFor="base" className="etiqueta">Base en efectivo (el sencillo con que empieza la caja)</label>
          <input id="base" inputMode="numeric" className="campo num" placeholder="$ 0" value={base ? pesos(entero(base)) : ""} onChange={(e) => setBase(e.target.value)} /></div>
        <button className="btn-primario h-12" disabled={ocupado}>Abrir turno</button>
      </form>
      {dueno && (
        <label className="flex items-start gap-2 text-sm text-muted">
          <input type="checkbox" className="mt-1" checked={estado.exige} onChange={(e) => enviar({ accion: "exigir", valor: e.target.checked })} />
          <span>Exigir turno abierto para vender: sin turno, la caja no deja cobrar.</span>
        </label>
      )}
      {error && <p role="alert" className="text-alerta font-semibold">{error}</p>}
    </section>
  );

  const r = t.resumen;
  return (
    <div className="grid lg:grid-cols-[minmax(0,1fr)_380px] gap-5 items-start">
      <section className="grid gap-4">
        <div className="tarjeta p-5">
          <p className="text-sm text-muted">Turno abierto · {estado.caja.nombre} · desde {hora(t.abierto)}{t.abre ? ` · ${String(t.abre).split(" (")[0]}` : ""}</p>
          <div className="mt-3 grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div><p className="text-sm text-muted">Ventas</p><p className="num titulo text-2xl">{pesos(r.ventas)}</p><p className="text-sm text-muted">{r.n_ventas} venta{r.n_ventas === 1 ? "" : "s"}{r.anuladas ? ` · ${r.anuladas} anulada${r.anuladas === 1 ? "" : "s"}` : ""}</p></div>
            <div><p className="text-sm text-muted">Base</p><p className="num titulo text-2xl">{pesos(r.base)}</p></div>
            <div><p className="text-sm text-muted">Entradas / salidas</p><p className="num titulo text-2xl">{pesos(r.ingresos - r.egresos)}</p><p className="text-sm text-muted num">+{pesos(r.ingresos)} · −{pesos(r.egresos)}</p></div>
            <div><p className="text-sm text-muted">Efectivo esperado</p><p className="num titulo text-2xl text-cruz">{pesos(r.efectivo_esperado)}</p></div>
          </div>
          <ul className="mt-4 grid sm:grid-cols-3 gap-2 text-sm num">
            {Object.entries(r.medios).map(([m, v]) => <li key={m} className="rounded-xl bg-paper px-3 py-2 flex justify-between"><span>{MEDIO[m] ?? m}</span><span className="font-semibold">{pesos(v)}</span></li>)}
            {r.credito > 0 && <li className="rounded-xl bg-paper px-3 py-2 flex justify-between"><span>A crédito</span><span className="font-semibold">{pesos(r.credito)}</span></li>}
            {r.abonos_efectivo > 0 && <li className="rounded-xl bg-paper px-3 py-2 flex justify-between"><span>Abonos en efectivo</span><span className="font-semibold">{pesos(r.abonos_efectivo)}</span></li>}
          </ul>
          <button className="mt-4 btn-borde h-10 text-sm" onClick={() => imprimirRuta(`/tiquete/turno/${t.id}`)}>Imprimir corte parcial</button>
        </div>

        <div className="tarjeta p-5 grid gap-3">
          <h2 className="titulo text-xl">Entradas y salidas de efectivo</h2>
          <form className="grid sm:grid-cols-[auto_140px_1fr_auto] gap-2 items-end" onSubmit={async (e) => {
            e.preventDefault();
            if (await enviar({ accion: "movimiento", turno: t.id, tipo: mov.tipo, valor: entero(mov.valor), concepto: mov.concepto })) setMov({ ...mov, valor: "", concepto: "" });
          }}>
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-paper p-1" role="group" aria-label="Tipo">
              {(["egreso", "ingreso"] as const).map((k) => (
                <button type="button" key={k} onClick={() => setMov({ ...mov, tipo: k })} aria-pressed={mov.tipo === k}
                  className={`h-9 px-3 rounded-lg text-sm font-semibold ${mov.tipo === k ? "bg-ink text-white" : "text-muted"}`}>{k === "egreso" ? "Salida" : "Entrada"}</button>
              ))}
            </div>
            <div><label htmlFor="mv-valor" className="etiqueta">Valor</label><input id="mv-valor" inputMode="numeric" className="campo num" value={mov.valor ? pesos(entero(mov.valor)) : ""} onChange={(e) => setMov({ ...mov, valor: e.target.value })} /></div>
            <div><label htmlFor="mv-concepto" className="etiqueta">Concepto</label><input id="mv-concepto" className="campo" placeholder={mov.tipo === "egreso" ? "Pago domicilio, compra de bolsas…" : "Sencillo del banco…"} value={mov.concepto} onChange={(e) => setMov({ ...mov, concepto: e.target.value })} /></div>
            <button className="btn-primario h-11" disabled={ocupado || !entero(mov.valor) || mov.concepto.trim().length < 3}>Registrar</button>
          </form>
          {t.movimientos.length > 0 && (
            <ul className="divide-y divide-line text-[15px]">
              {t.movimientos.map((m, i) => (
                <li key={i} className="py-2 flex justify-between gap-3">
                  <span>{m.concepto}<span className="block text-sm text-muted">{hora(m.creado)}{m.usuario ? ` · ${String(m.usuario).split(" (")[0]}` : ""}</span></span>
                  <span className={`num font-semibold ${m.tipo === "egreso" ? "text-alerta" : "text-cruz"}`}>{m.tipo === "egreso" ? "−" : "+"}{pesos(m.valor)}</span>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      <section className="tarjeta p-5 grid gap-3" aria-label="Cerrar turno">
        <h2 className="titulo text-xl">Cerrar turno</h2>
        <p className="text-sm text-muted">Cuenta el efectivo del cajón (incluida la base) y escríbelo. Regenta lo compara con lo esperado.</p>
        <form className="grid gap-3" onSubmit={async (e) => {
          e.preventDefault();
          const j = await enviar({ accion: "cerrar", turno: t.id, contado: entero(contado), observaciones: obs || null });
          if (j) { setCierre({ turno: j.turno, diferencia: Number(j.cierre.diferencia), esperado: Number(j.cierre.efectivo_esperado), contado: Number(j.cierre.efectivo_contado) }); imprimirRuta(`/tiquete/turno/${j.turno}`); }
        }}>
          <div><label htmlFor="contado" className="etiqueta">Dinero real en caja</label>
            <input id="contado" inputMode="numeric" className="campo num" placeholder="$ 0" value={contado ? pesos(entero(contado)) : ""} onChange={(e) => setContado(e.target.value)} /></div>
          <div><label htmlFor="obs" className="etiqueta">Observaciones (opcional)</label>
            <textarea id="obs" className="campo !h-20 py-2" maxLength={500} value={obs} onChange={(e) => setObs(e.target.value)} /></div>
          <button className="btn-primario h-12" disabled={ocupado || contado === ""}>Cerrar turno e imprimir</button>
        </form>
        {error && <p role="alert" className="text-alerta font-semibold">{error}</p>}
      </section>
    </div>
  );
}
