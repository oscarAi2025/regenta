"use client";
import { useEffect, useRef, useState } from "react";
import type { DocSoporte, EstadoSoporte } from "@/lib/dian/soporte";
import { leerNumero, pesosExactos } from "@/lib/compras";

// Documento soporte de la compra (proveedores no obligados a facturar): por operación o semanal, su estado ante la DIAN,
// descarga del XML y la nota de ajuste que lo anula o corrige. Solo el dueño o el administrador (la página no lo muestra a
// la bodega y la API responde 403). Tras cada acción la API devuelve el estado actualizado y la pantalla lo aplica.

const fecha = (d: string | null | undefined) => (d ? d.split("-").reverse().join("/") : "—");
const ESTADO: Record<string, [string, string]> = {
  aceptado: ["Aceptado", "bg-cruz-soft text-cruz"], simulado: ["Simulado", "bg-sky-100 text-sky-900"], pendiente: ["Enviando", "bg-aviso-soft text-aviso"],
  rechazado: ["Rechazado", "bg-alerta-soft text-alerta"], anulado: ["No emitido", "bg-paper text-muted"],
};
const enlace = "font-semibold text-cruz underline-offset-2 hover:underline";

function Estado({ e }: { e: string }) {
  const [t, c] = ESTADO[e] ?? [e, "bg-paper text-muted"];
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[13px] font-semibold whitespace-nowrap ${c}`}>{t}</span>;
}

async function llamar(url: string, body?: unknown) {
  try {
    const r = await fetch(url, body === undefined ? undefined : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    return r.ok ? { ok: true as const, j } : { ok: false as const, error: (j.error as string) ?? "No se pudo guardar" };
  } catch { return { ok: false as const, error: "Sin conexión: revisa internet y vuelve a intentar." }; }
}

function Archivos({ d }: { d: DocSoporte }) {
  return (
    <span className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
      {d.xml && <a href={`/api/documentos/${d.id}/xml`} download className={enlace} aria-label={`Descargar el XML de ${d.numero}`}>XML</a>}
      {d.pdf && <a href={d.pdf} target="_blank" rel="noopener noreferrer" className={enlace}>PDF</a>}
      {d.cufe && (
        <details className="basis-full">
          <summary className="cursor-pointer font-semibold text-ink/80 hover:text-ink w-fit">CUDS</summary>
          <span className="mt-1 block max-w-[min(100%,420px)] rounded-xl border border-line bg-paper/60 p-2.5 text-xs">
            <span className="block break-all num">{d.cufe}</span>
            {d.simulado && <span className="block mt-1 text-muted">Emisión simulada (demostración o numeración de pruebas): no se consulta en la DIAN.</span>}
          </span>
        </details>
      )}
    </span>
  );
}

export function Soporte({ compraId, inicial }: { compraId: string; inicial: EstadoSoporte | null }) {
  const [e, setE] = useState(inicial);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const [elegidas, setElegidas] = useState<string[]>(() => inicial?.candidatas.map((k) => k.id) ?? []);
  const [ajuste, setAjuste] = useState<null | "anulacion" | "correccion">(null);
  const [motivo, setMotivo] = useState(""); const [concepto, setConcepto] = useState(""); const [valor, setValor] = useState(""); const [iva, setIva] = useState(0);
  const idem = useRef<string | null>(null);

  // Mientras la compra espera sus costos, se revisa cada pocos segundos (los costos se guardan en otra parte de la ficha).
  const porCostear = e?.compra.estado === "por_costear";
  useEffect(() => {
    if (!porCostear) return;
    const t = setInterval(async () => {
      if (document.hidden) return;
      const r = await llamar(`/api/dian/soporte?compra=${compraId}`);
      if (r.ok && r.j.compra?.estado !== "por_costear") { setE(r.j); setElegidas(r.j.candidatas.map((k: { id: string }) => k.id)); }
    }, 4000);
    return () => clearInterval(t);
  }, [porCostear, compraId]);

  if (!e || e.compra.obligado) return null;
  const { compra, vigente, numeracion } = e;
  const sinNumeracion = !numeracion.existe ? "Tu droguería aún no tiene numeración de documento soporte: pídela a soporte de Regenta (se carga con la resolución que autoriza la DIAN)."
    : numeracion.pruebas && !numeracion.demo ? "La numeración de documento soporte de tu droguería es de pruebas: podrás generarlo cuando quede cargada la resolución autorizada por la DIAN." : null;
  const impedimento = sinNumeracion ?? e.bloqueo;

  async function enviar(url: string, body: Record<string, unknown>, mensaje: (j: { numero: string; estado: EstadoSoporte }) => string) {
    setOcupado(true); setError(""); setAviso("");
    idem.current ??= crypto.randomUUID();
    const r = await llamar(url, { ...body, idem_key: idem.current });
    setOcupado(false);
    if (!r.ok) { setError(r.error); return; }
    idem.current = null;
    setE(r.j.estado); setElegidas(r.j.estado.candidatas.map((k: { id: string }) => k.id)); setAjuste(null); setMotivo(""); setConcepto(""); setValor("");
    setAviso(mensaje(r.j));
  }
  const estadoDe = (x: EstadoSoporte, numero: string) => {
    const d = x.vigente?.numero === numero ? x.vigente : x.vigente?.ajustes.find((a) => a.numero === numero);
    return d ? (d.estado === "rechazado" ? `rechazado: ${d.ultimo_error ?? ""}` : (ESTADO[d.estado]?.[0] ?? d.estado).toLowerCase()) : "generado";
  };
  const generar = (semanal: boolean) => enviar("/api/dian/soporte", { compras: semanal ? elegidas : [compra.id], semanal },
    (j) => `Documento soporte ${j.numero} generado (${estadoDe(j.estado, j.numero)}).`);
  function guardarAjuste(ev: React.FormEvent) {
    ev.preventDefault();
    if (!vigente || !ajuste) return;
    if (motivo.trim().length < 4) { setError("Escribe el motivo de la nota de ajuste."); return; }
    const body: Record<string, unknown> = { concepto: ajuste, motivo };
    if (ajuste === "correccion") {
      const v = leerNumero(valor);
      if (concepto.trim().length < 2) { setError("Escribe qué se corrige."); return; }
      if (!v) { setError("Escribe el valor sin IVA que se descuenta."); return; }
      Object.assign(body, { descripcion: concepto, valor: v, iva_pct: iva });
    }
    enviar(`/api/dian/soporte/${vigente.id}/ajuste`, body, (j) => `Nota de ajuste ${j.numero} generada (${estadoDe(j.estado, j.numero)}).`);
  }
  async function reenviar(id: string) {
    setOcupado(true); setError(""); setAviso("");
    const r = await fetch(`/api/documentos/${id}/reenviar`, { method: "POST" }).then(async (x) => ({ ok: x.ok, j: await x.json().catch(() => ({})) })).catch(() => null);
    if (!r?.ok) { setOcupado(false); setError(r?.j?.error ?? "Sin conexión: revisa internet y vuelve a intentar."); return; }
    const g = await llamar(`/api/dian/soporte?compra=${compraId}`);
    setOcupado(false);
    if (g.ok) setE(g.j);
    setAviso("Documento reenviado a la DIAN.");
  }

  const totalElegidas = e.candidatas.filter((k) => elegidas.includes(k.id)).reduce((s, k) => s + k.total, 0);
  const puedeGenerar = !vigente && compra.estado === "registrada" && !impedimento;
  return (
    <section className="tarjeta p-4 grid gap-3" aria-labelledby="soporte-t">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 id="soporte-t" className="titulo text-xl">Documento soporte</h2>
        {vigente && <Estado e={vigente.anulado ? "anulado" : vigente.estado} />}
      </div>
      <p className="text-sm text-muted max-w-3xl">
        {compra.proveedor} no está obligado a facturar: para compras a proveedores no obligados a facturar, el soporte ante la DIAN es el documento soporte que
        genera tu droguería. Puedes generarlo por cada compra o uno semanal con las compras de la semana de este proveedor, a más tardar el último día hábil de esa semana.
      </p>
      {aviso && <p role="status" className="rounded-xl bg-cruz-soft text-cruz font-semibold px-4 py-3 break-words">{aviso}</p>}

      {vigente ? (
        <div className="rounded-xl border border-line p-3 grid gap-2">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <p><b className="num">{vigente.numero}</b> · {vigente.semanal ? `semanal (${fecha(vigente.periodo_desde)} al ${fecha(vigente.periodo_hasta)})` : "por operación"}</p>
            <p className="num font-semibold">{pesosExactos(vigente.total)}</p>
          </div>
          <p className="text-sm text-muted">Generado el <span className="num">{vigente.fecha}</span>{vigente.compras.length > 1 && <> · compras {vigente.compras.map((k, i) => <span key={k.id}>{i ? ", " : ""}{k.id === compraId ? <b>N.º {k.numero}</b> : <a href={`/compras/${k.id}`} className={enlace}>N.º {k.numero}</a>}</span>)}</>}</p>
          {vigente.estado === "rechazado" && <p className="text-sm text-alerta break-words">{vigente.ultimo_error}</p>}
          {vigente.estado === "pendiente" && <p className="text-sm text-muted">Se está enviando a la DIAN: la cola lo reintenta sola.{vigente.ultimo_error ? ` Último intento: ${vigente.ultimo_error}` : ""}</p>}
          <Archivos d={vigente} />
          {vigente.estado === "rechazado" && <div><button onClick={() => reenviar(vigente.id)} disabled={ocupado} className="btn-primario h-9 px-3 text-sm">Reenviar a la DIAN</button></div>}
          {compra.estado === "anulada" && !vigente.anulado && <p className="rounded-xl bg-aviso-soft text-aviso px-3 py-2 text-sm font-semibold">La compra se anuló: anula también su documento soporte con una nota de ajuste.</p>}

          {vigente.ajustes.length > 0 && (
            <ul className="grid gap-2 border-t border-line pt-2" aria-label="Notas de ajuste">
              {vigente.ajustes.map((a) => (
                <li key={a.id} className="grid gap-1">
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                    <p className="flex-1 min-w-0 break-words"><b className="num">{a.numero}</b> · nota de ajuste · {a.concepto === "anulacion" ? "anulación" : "corrección"} · <span className="num">−{pesosExactos(a.total)}</span></p>
                    <Estado e={a.estado} />
                  </div>
                  <p className="text-sm text-muted break-words">Motivo: {a.motivo}</p>
                  {a.estado === "rechazado" && <p className="text-sm text-alerta break-words">{a.ultimo_error} <button onClick={() => reenviar(a.id)} disabled={ocupado} className="ml-1 underline font-semibold">Reenviar</button></p>}
                  <Archivos d={a} />
                </li>
              ))}
            </ul>
          )}

          {!vigente.anulado && vigente.disponible > 0 && vigente.estado !== "rechazado" && (ajuste === null ? (
            <div className="flex flex-wrap gap-2 pt-1">
              <button onClick={() => { setAjuste("anulacion"); setError(""); setAviso(""); }} className="btn-borde h-10 text-sm">Nota de ajuste</button>
            </div>
          ) : (
            <form onSubmit={guardarAjuste} className="grid gap-3 rounded-xl bg-paper p-3" aria-label="Nota de ajuste">
              <fieldset className="flex flex-wrap gap-1 rounded-xl border-2 border-line p-1 w-fit max-w-full"><legend className="sr-only">Qué hace la nota</legend>
                {(["anulacion", "correccion"] as const).map((k) => (
                  <label key={k} className={`px-3.5 h-9 inline-flex items-center rounded-lg text-sm font-semibold cursor-pointer ${ajuste === k ? "bg-ink text-white" : "text-muted"}`}>
                    <input type="radio" name="concepto-ajuste" checked={ajuste === k} onChange={() => setAjuste(k)} className="sr-only" />{k === "anulacion" ? "Anular el documento" : "Corregir el valor"}</label>
                ))}
              </fieldset>
              <p className="text-sm text-muted">{ajuste === "anulacion"
                ? `Anula lo que queda del documento (${pesosExactos(vigente.disponible)}). Sus compras quedan libres para un documento soporte nuevo.`
                : `Descuenta un valor del documento (queda ${pesosExactos(vigente.disponible)}).`}</p>
              {ajuste === "correccion" && (
                <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_160px_130px]">
                  <div><label htmlFor="ajuste-concepto" className="etiqueta">Qué se corrige</label><input id="ajuste-concepto" value={concepto} onChange={(x) => setConcepto(x.target.value)} maxLength={300} className="campo" placeholder="Por ejemplo: precio mal liquidado" /></div>
                  <div><label htmlFor="ajuste-valor" className="etiqueta">Valor sin IVA</label><input id="ajuste-valor" inputMode="decimal" value={valor} onChange={(x) => setValor(x.target.value.replace(/[^\d.,]/g, ""))} className="campo num" /></div>
                  <div><label htmlFor="ajuste-iva" className="etiqueta">IVA</label><select id="ajuste-iva" value={iva} onChange={(x) => setIva(Number(x.target.value))} className="campo">{(vigente.tarifas.length ? vigente.tarifas : [0]).map((t) => <option key={t} value={t}>{t} %</option>)}</select></div>
                </div>
              )}
              <div><label htmlFor="ajuste-motivo" className="etiqueta">Motivo</label><input id="ajuste-motivo" value={motivo} onChange={(x) => setMotivo(x.target.value)} maxLength={300} className="campo" placeholder="Por ejemplo: la compra se registró dos veces" /></div>
              {error && <p role="alert" className="text-alerta font-semibold break-words">{error}</p>}
              <div className="flex flex-wrap gap-2">
                <button disabled={ocupado} className={ajuste === "anulacion" ? "btn-peligro" : "btn-primario"}>{ocupado ? "Generando…" : ajuste === "anulacion" ? "Generar nota de anulación" : "Generar nota de corrección"}</button>
                <button type="button" onClick={() => { setAjuste(null); setError(""); }} className="btn-borde">Cancelar</button>
              </div>
            </form>
          ))}
        </div>
      ) : compra.estado === "por_costear" ? (
        <p className="rounded-xl bg-paper px-4 py-3 text-sm">Completa los costos de la compra para generar su documento soporte.</p>
      ) : compra.estado === "anulada" ? (
        <p className="rounded-xl bg-paper px-4 py-3 text-sm">La compra está anulada: no lleva documento soporte.</p>
      ) : impedimento ? (
        <p role="note" className="rounded-xl bg-aviso-soft text-aviso px-4 py-3 text-sm font-semibold break-words">{impedimento}</p>
      ) : null}

      {puedeGenerar && (
        <div className="grid gap-3">
          <div className="flex flex-wrap items-center gap-3">
            <button onClick={() => generar(false)} disabled={ocupado} className="btn-primario">{ocupado ? "Generando…" : "Generar documento soporte"}</button>
            <span className="text-sm text-muted">Solo de esta compra · <span className="num">{pesosExactos(compra.total)}</span></span>
          </div>
          {e.candidatas.length > 1 && (
            <fieldset className="rounded-xl border border-line p-3 grid gap-2 min-w-0">
              <legend className="px-1 font-semibold">Documento soporte semanal</legend>
              <p className="text-sm text-muted">Compras de {compra.proveedor} de la semana del {fecha(e.semana.desde)} al {fecha(e.semana.hasta)} que aún no tienen documento soporte.</p>
              <ul className="grid gap-1.5">
                {e.candidatas.map((k) => (
                  <li key={k.id}>
                    <label className="flex flex-wrap items-center gap-x-3 gap-y-0.5 text-sm cursor-pointer">
                      <input type="checkbox" className="w-4 h-4" checked={elegidas.includes(k.id)} onChange={(x) => setElegidas(x.target.checked ? [...elegidas, k.id] : elegidas.filter((y) => y !== k.id))} />
                      <span className="flex-1 min-w-0">Compra N.º {k.numero} · factura <span className="num">{k.numero_factura}</span> · <span className="num">{fecha(k.fecha_factura)}</span></span>
                      <span className="num font-semibold">{pesosExactos(k.total)}</span>
                    </label>
                  </li>
                ))}
              </ul>
              <div><button onClick={() => generar(true)} disabled={ocupado || elegidas.length === 0} className="btn-oscuro">
                {`Documento soporte semanal (${elegidas.length} compra${elegidas.length === 1 ? "" : "s"} · ${pesosExactos(totalElegidas)})`}</button></div>
            </fieldset>
          )}
        </div>
      )}
      {error && ajuste === null && <p role="alert" className="text-alerta font-semibold break-words">{error}</p>}
      {e.historial.length > 0 && (
        <p className="text-sm text-muted">Documentos soporte anteriores de esta compra (anulados con nota de ajuste): {e.historial.map((h) => h.numero).join(", ")}.</p>
      )}
    </section>
  );
}
