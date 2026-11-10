"use client";
import { useState } from "react";
import type { DetalleCompra, LineaCompra } from "@/lib/compras-datos";
import { ESTADOS, MEDIOS_PAGO, calcularLinea, leerNumero, miles, nombreMedio, numeroTexto, pesosExactos } from "@/lib/compras";

type Costo = { costo: string; por: "caja" | "unidad"; desc: string; iva: number };
const fecha = (d: string | null | undefined) => (d ? d.split("-").reverse().join("/") : "—");
const decimal = (s: string) => s.replace(/[^\d.,]/g, "");
const nombre = (x: string | null | undefined) => String(x ?? "").split(" (")[0] || "—";
const tono: Record<string, string> = { por_costear: "bg-aviso-soft text-aviso", registrada: "bg-cruz-soft text-cruz", anulada: "bg-alerta-soft text-alerta" };

async function llamar(url: string, method: string, body: unknown) {
  try {
    const r = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const j = await r.json().catch(() => ({}));
    return r.ok ? { ok: true as const, j } : { ok: false as const, error: (j.error as string) ?? "No se pudo guardar" };
  } catch { return { ok: false as const, error: "Sin conexión: revisa internet y vuelve a intentar." }; }
}

export function Compra({ inicial, dinero }: { inicial: DetalleCompra; dinero: boolean }) {
  const [d, setD] = useState(inicial);
  const [accion, setAccion] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [aviso, setAviso] = useState("");
  const [ocupado, setOcupado] = useState(false);
  const { compra: c, lineas } = d;
  const porCostear = c.estado === "por_costear", anulada = c.estado === "anulada";

  async function hacer(url: string, method: string, body: unknown, mensaje: string, recargar = false) {
    setOcupado(true); setError(""); setAviso("");
    const r = await llamar(url, method, body);
    if (r.ok && (recargar || !r.j.detalle)) {
      const g = await fetch(`/api/compras/${c.id}`).then((x) => x.json()).catch(() => null);
      if (g?.compra) setD(g);
    } else if (r.ok) setD(r.j.detalle);
    setOcupado(false);
    if (!r.ok) { setError(r.error); return false; }
    setAccion(null); setAviso(mensaje);
    return true;
  }

  // ── Completar costos
  const [costos, setCostos] = useState<Record<number, Costo>>(() => Object.fromEntries(lineas.map((l) => [l.id, { costo: "", por: l.unidades_por_caja > 1 ? "caja" : "unidad", desc: "", iva: l.iva_producto }])));
  const [papel, setPapel] = useState("");
  const [condicion, setCondicion] = useState<"contado" | "credito">(c.condicion === "credito" ? "credito" : "contado");
  const [vence, setVence] = useState(c.condicion === "credito" ? c.vence_pago ?? "" : "");
  const calc = (l: LineaCompra) => { const k = costos[l.id]; const v = leerNumero(k?.costo ?? ""); const ds = leerNumero(k?.desc ?? "") ?? 0;
    return v === null || ds >= 100 ? null : calcularLinea(v, k.por === "caja" ? l.unidades_por_caja : 1, l.unidades, ds, k.iva); };
  const totalCosteo = Math.round(lineas.reduce((a, l) => a + (calc(l)?.total ?? 0), 0) * 100) / 100;
  const papelN = leerNumero(papel), difCosteo = papelN === null ? null : Math.round((papelN - totalCosteo) * 100) / 100;
  async function guardarCostos() {
    const falta = lineas.find((l) => leerNumero(costos[l.id]?.costo ?? "") === null);
    if (falta) { setError(`Falta el costo de ${falta.nombre}.`); document.getElementById(`costo-${falta.id}`)?.focus(); return; }
    if (condicion === "credito" && !vence) { setError("Pon la fecha en que vence el pago."); return; }
    await hacer(`/api/compras/${c.id}`, "PATCH", { total_papel: papelN, condicion, vence_pago: condicion === "credito" ? vence : null,
      lineas: lineas.map((l) => ({ linea_id: l.id, costo: leerNumero(costos[l.id].costo), costo_por: costos[l.id].por, descuento_pct: leerNumero(costos[l.id].desc) ?? 0, iva_pct: costos[l.id].iva })) },
      "Costos guardados: la compra quedó registrada y su saldo está en Cuentas por pagar.");
  }

  // ── Pago, devolución, nota crédito, anulaciones
  const [valor, setValor] = useState(""); const [medio, setMedio] = useState("transferencia"); const [ref, setRef] = useState(""); const [fueraCaja, setFueraCaja] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [devolver, setDevolver] = useState<Record<number, string>>({});
  const [nc, setNc] = useState(""); const [valorNc, setValorNc] = useState("");
  const abrir = (a: string) => { setAccion(accion === a ? null : a); setError(""); setAviso(""); setMotivo(""); if (a === "pagar") setValor(numeroTexto(c.saldo ?? 0)); };

  const saldo = Number(c.saldo ?? 0), cantidad = (l: LineaCompra) => l.unidades + l.bonificadas;
  return (
    <>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="titulo text-[32px] leading-tight">Compra N.º {c.numero} <span className={`align-middle rounded-md px-2 py-0.5 text-base font-semibold ${tono[c.estado]}`}>{ESTADOS[c.estado]}</span></h1>
          <p className="text-muted mt-0.5">{c.proveedor}{c.proveedor_nit ? ` · NIT ${c.proveedor_nit}${c.proveedor_dv ? "-" + c.proveedor_dv : ""}` : ""} · factura <span className="num font-semibold text-ink">{c.numero_factura}</span> del {fecha(c.fecha_factura)}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <a href={`/tiquete/recepcion/${c.id}`} className="btn-borde">Acta de recepción</a>
          <a href="/compras" className="btn-borde">Volver a compras</a>
        </div>
      </div>
      {aviso && <p role="status" className="rounded-xl bg-cruz-soft text-cruz font-semibold px-4 py-3">{aviso}</p>}
      {anulada && <p className="rounded-xl bg-alerta-soft text-alerta px-4 py-3"><b>Compra anulada</b>{c.anulada ? ` el ${c.anulada}` : ""}: {c.motivo_anulacion}. Las unidades salieron del inventario.</p>}

      <dl className="tarjeta p-4 grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-3 text-[15px]">
        <div><dt className="text-sm text-muted">Recibió</dt><dd className="font-semibold">{nombre(c.recibe)}</dd></div>
        <div><dt className="text-sm text-muted">Registrada</dt><dd className="font-semibold num">{c.creado}</dd></div>
        <div><dt className="text-sm text-muted">Sede</dt><dd className="font-semibold">{c.sede}</dd></div>
        {dinero && !porCostear && <div><dt className="text-sm text-muted">Condición</dt><dd className="font-semibold">{c.condicion === "credito" ? `Crédito · vence ${fecha(c.vence_pago)}` : "Contado"}</dd></div>}
      </dl>

      {dinero && !porCostear && (
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-3" aria-label="Valores de la compra">
          {[["Total", c.total, ""], ["Pagado", c.pagado, ""], ["Notas crédito", c.notas_credito, ""], ["Saldo", anulada ? 0 : saldo, saldo > 0 && !anulada ? (c.dias !== null && c.dias < 0 ? "text-alerta" : "text-ink") : "text-cruz"]].map(([t, v, k]) => (
            <div key={t as string} className="tarjeta px-4 py-3"><p className="text-sm text-muted">{t}</p><p className={`num titulo text-[26px] leading-tight ${k}`}>{pesosExactos(Number(v ?? 0))}</p>
              {t === "Saldo" && saldo > 0 && !anulada && c.dias !== null && <p className="text-[13px] text-muted">{c.dias < 0 ? `vencida hace ${-c.dias} día${c.dias === -1 ? "" : "s"}` : c.dias === 0 ? "vence hoy" : `vence en ${c.dias} día${c.dias === 1 ? "" : "s"}`}</p>}
              {t === "Total" && c.diferencia !== null && <p className={`text-[13px] ${c.diferencia ? "text-aviso font-semibold" : "text-muted"}`}>{c.diferencia ? `diferencia con la factura ${pesosExactos(c.diferencia)}` : "cuadra con la factura"}</p>}</div>
          ))}
        </section>
      )}

      <section className="tarjeta overflow-x-auto" aria-labelledby="lineas-t">
        <h2 id="lineas-t" className="titulo text-xl px-4 pt-4">Productos</h2>
        <table className="w-full text-sm min-w-[720px]">
          <thead className="text-left text-muted border-b border-line"><tr>
            <th className="px-4 py-2.5 font-semibold">Producto</th><th className="px-3 py-2.5 font-semibold">Lote · vence</th><th className="px-3 py-2.5 font-semibold text-right">Cantidad</th>
            {dinero && !porCostear && <><th className="px-3 py-2.5 font-semibold text-right">Costo sin IVA</th><th className="px-3 py-2.5 font-semibold text-right">Desc.</th><th className="px-3 py-2.5 font-semibold text-right">IVA</th>
              <th className="px-3 py-2.5 font-semibold text-right">Total</th><th className="px-4 py-2.5 font-semibold text-right">Costo por und</th></>}
            {dinero && porCostear && <th className="px-4 py-2.5 font-semibold">Costo de la compra</th>}
          </tr></thead>
          <tbody className="divide-y divide-line">
            {lineas.map((l) => {
              const k = costos[l.id], x = calc(l);
              return (
                <tr key={l.id} className="align-top">
                  <td className="px-4 py-3"><p className="font-semibold">{l.nombre}</p><p className="text-muted">{l.laboratorio ?? "Sin laboratorio"}{l.registro_sanitario ? ` · Reg. ${l.registro_sanitario}` : ""}</p></td>
                  <td className="px-3 py-3 num"><b>{l.lote}</b><br />{fecha(l.vence)}</td>
                  <td className="px-3 py-3 num text-right whitespace-nowrap">{miles(cantidad(l))} und{l.bonificadas ? <span className="block text-muted">{l.bonificadas} bonificadas</span> : null}{l.devueltas ? <span className="block text-alerta">{l.devueltas} devueltas</span> : null}</td>
                  {dinero && !porCostear && <>
                    <td className="px-3 py-3 num text-right">{pesosExactos(l.costo ?? 0)}<span className="block text-muted">por {l.costo_por === "caja" ? "caja" : "und"}</span></td>
                    <td className="px-3 py-3 num text-right">{l.descuento_pct ? `${String(l.descuento_pct).replace(".", ",")} %` : "—"}</td>
                    <td className="px-3 py-3 num text-right">{l.iva_pct} %</td>
                    <td className="px-3 py-3 num text-right font-semibold">{pesosExactos(l.total ?? 0)}</td>
                    <td className="px-4 py-3 num text-right">{pesosExactos(Math.round((l.costo_lote ?? 0) * 100) / 100)}{l.precio_venta_nuevo ? <span className="block text-muted">precio nuevo {pesosExactos(l.precio_venta_nuevo)}</span> : null}</td>
                  </>}
                  {dinero && porCostear && k && (
                    <td className="px-4 py-3">
                      <div className="grid grid-cols-[minmax(0,1fr)_96px] gap-1.5 w-[300px]">
                        <label htmlFor={`costo-${l.id}`} className="sr-only">Costo sin IVA de {l.nombre}</label>
                        <input id={`costo-${l.id}`} inputMode="decimal" value={k.costo} onChange={(e) => setCostos({ ...costos, [l.id]: { ...k, costo: decimal(e.target.value) } })} className="campo h-10 num" placeholder="Costo sin IVA" />
                        <label htmlFor={`costo-por-${l.id}`} className="sr-only">El costo es</label>
                        <select id={`costo-por-${l.id}`} value={k.por} onChange={(e) => setCostos({ ...costos, [l.id]: { ...k, por: e.target.value as Costo["por"] } })} className="campo h-10 px-2" disabled={l.unidades_por_caja <= 1}>
                          <option value="caja">por caja</option><option value="unidad">por und</option></select>
                        <label htmlFor={`desc-${l.id}`} className="sr-only">Descuento % de {l.nombre}</label>
                        <input id={`desc-${l.id}`} inputMode="decimal" value={k.desc} onChange={(e) => setCostos({ ...costos, [l.id]: { ...k, desc: decimal(e.target.value) } })} className="campo h-10 num" placeholder="Descuento %" />
                        <label htmlFor={`iva-${l.id}`} className="sr-only">IVA de {l.nombre}</label>
                        <select id={`iva-${l.id}`} value={k.iva} onChange={(e) => setCostos({ ...costos, [l.id]: { ...k, iva: Number(e.target.value) } })} className="campo h-10 px-2">{[0, 5, 19].map((v) => <option key={v} value={v}>IVA {v} %</option>)}</select>
                      </div>
                      {x && <p className="text-muted num mt-1">Total {pesosExactos(x.total)}</p>}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
        {dinero && !porCostear && (
          <dl className="flex flex-wrap justify-end gap-x-6 gap-y-1 px-4 py-3 border-t border-line num text-[15px]">
            <div className="flex gap-2"><dt className="text-muted">Subtotal</dt><dd>{pesosExactos(c.subtotal)}</dd></div>
            <div className="flex gap-2"><dt className="text-muted">Descuento</dt><dd>{pesosExactos(c.descuento)}</dd></div>
            <div className="flex gap-2"><dt className="text-muted">IVA</dt><dd>{pesosExactos(c.iva)}</dd></div>
            <div className="flex gap-2 font-semibold"><dt>Total</dt><dd>{pesosExactos(c.total)}</dd></div>
          </dl>
        )}
      </section>

      {dinero && porCostear && (
        <section className="tarjeta p-4 grid gap-3" aria-labelledby="costear-t">
          <h2 id="costear-t" className="titulo text-xl">Completar costos</h2>
          <p className="text-sm text-muted">La bodega recibió esta mercancía sin costos. Pon el costo sin IVA de cada línea como dice la factura: al guardar queda la cuenta por pagar.</p>
          <div className="flex flex-wrap items-end gap-3">
            <fieldset className="flex gap-1 rounded-xl border-2 border-line p-1"><legend className="sr-only">Condición de pago</legend>
              {(["contado", "credito"] as const).map((k) => <label key={k} className={`px-3.5 h-9 inline-flex items-center rounded-lg text-sm font-semibold cursor-pointer ${condicion === k ? "bg-ink text-white" : "text-muted"}`}>
                <input type="radio" name="condicion" checked={condicion === k} onChange={() => setCondicion(k)} className="sr-only" />{k === "contado" ? "De contado" : "A crédito"}</label>)}
            </fieldset>
            {condicion === "credito" && <div><label htmlFor="vence-pago" className="etiqueta">Vence el pago</label><input id="vence-pago" type="date" min={c.fecha_factura} value={vence} onChange={(e) => setVence(e.target.value)} className="campo w-44" /></div>}
            <div><label htmlFor="total-papel" className="etiqueta">Total de la factura (papel)</label><input id="total-papel" inputMode="decimal" value={papel} onChange={(e) => setPapel(decimal(e.target.value))} className="campo w-48 num" /></div>
            <p className="num font-semibold h-11 flex items-center">Total calculado {pesosExactos(totalCosteo)}</p>
          </div>
          {difCosteo !== null && <p role="note" className={`rounded-xl px-4 py-2.5 font-semibold ${difCosteo === 0 ? "bg-cruz-soft text-cruz" : "bg-aviso-soft text-aviso"}`}>{difCosteo === 0 ? "Cuadra con la factura." : `Diferencia con la factura: ${pesosExactos(difCosteo)}.`}</p>}
          {error && <p role="alert" className="text-alerta font-semibold">{error}</p>}
          <div><button onClick={guardarCostos} disabled={ocupado} className="btn-primario">{ocupado ? "Guardando…" : "Guardar costos"}</button></div>
        </section>
      )}

      {dinero && !porCostear && (
        <section className="tarjeta p-4 grid gap-3" aria-labelledby="pagos-t">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="pagos-t" className="titulo text-xl">Pagos</h2>
            {!anulada && saldo > 0 && <button onClick={() => abrir("pagar")} className="btn-oscuro" aria-expanded={accion === "pagar"}>Registrar pago</button>}
          </div>
          {accion === "pagar" && (
            <form onSubmit={(e) => { e.preventDefault(); const v = leerNumero(valor); if (!v) { setError("Escribe el valor del pago."); return; }
              hacer("/api/compras/pagos", "POST", { proveedor_id: c.proveedor_id, compras: [c.id], valor: v, medio, referencia: ref || null, desde_caja: medio === "efectivo" && !fueraCaja, idem_key: crypto.randomUUID() }, `Pago de ${pesosExactos(v)} registrado.`, true); }}
              className="grid gap-3 sm:grid-cols-[160px_180px_minmax(0,1fr)_auto] sm:items-end rounded-xl bg-paper p-3">
              <div><label htmlFor="pago-valor" className="etiqueta">Valor</label><input id="pago-valor" inputMode="decimal" value={valor} onChange={(e) => setValor(decimal(e.target.value))} className="campo num" /></div>
              <div><label htmlFor="pago-medio" className="etiqueta">Medio</label><select id="pago-medio" value={medio} onChange={(e) => setMedio(e.target.value)} className="campo">{MEDIOS_PAGO.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></div>
              <div><label htmlFor="pago-ref" className="etiqueta">Referencia (opcional)</label><input id="pago-ref" value={ref} onChange={(e) => setRef(e.target.value)} className="campo" maxLength={60} /></div>
              <button disabled={ocupado} className="btn-primario">Confirmar pago</button>
              {medio === "efectivo" && <label className="sm:col-span-4 flex items-center gap-2 text-sm"><input type="checkbox" checked={fueraCaja} onChange={(e) => setFueraCaja(e.target.checked)} className="w-4 h-4" />No sale de la caja (si sale, queda como egreso del turno abierto)</label>}
            </form>
          )}
          {error && accion !== null && accion !== "anular" && <p role="alert" className="text-alerta font-semibold">{error}</p>}
          {d.pagos.length === 0 ? <p className="text-muted">Sin pagos.</p> : (
            <ul className="divide-y divide-line" aria-label="Pagos de la compra">{d.pagos.map((g) => (
              <li key={g.id} className="py-2.5 flex flex-wrap items-center gap-x-4 gap-y-1">
                <p className={`flex-1 min-w-0 ${g.anulado ? "line-through text-muted" : ""}`}><b className="num">{pesosExactos(g.aplicado)}</b> · {nombreMedio(g.medio)}{g.desde_caja ? " desde la caja" : ""}{g.referencia ? ` · ${g.referencia}` : ""}<span className="block text-sm text-muted num no-underline">{g.fecha} · {nombre(g.usuario)}{g.valor !== g.aplicado ? ` · pago de ${pesosExactos(g.valor)} repartido en varias facturas` : ""}</span></p>
                {g.anulado ? <span className="text-sm text-alerta">Anulado: {g.motivo}</span> : accion === `anular-pago-${g.id}` ? (
                  <form onSubmit={(e) => { e.preventDefault(); hacer("/api/compras/pagos", "DELETE", { id: g.id, motivo }, "Pago anulado.", true); }} className="flex flex-wrap gap-2 w-full">
                    <label htmlFor={`motivo-pago-${g.id}`} className="sr-only">Motivo</label>
                    <input id={`motivo-pago-${g.id}`} value={motivo} onChange={(e) => setMotivo(e.target.value)} className="campo h-10 flex-1 min-w-[180px]" placeholder="Motivo de la anulación" />
                    <button disabled={ocupado} className="btn-peligro h-10">Anular este pago</button>
                  </form>
                ) : !anulada && <button onClick={() => abrir(`anular-pago-${g.id}`)} className="text-sm text-alerta underline">Anular pago</button>}
              </li>
            ))}</ul>
          )}
        </section>
      )}

      {dinero && !porCostear && (
        <section className="tarjeta p-4 grid gap-3" aria-labelledby="dev-t">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 id="dev-t" className="titulo text-xl">Devoluciones al proveedor</h2>
            {!anulada && <button onClick={() => { abrir("devolver"); setDevolver({}); }} className="btn-borde" aria-expanded={accion === "devolver"}>Devolver al proveedor</button>}
          </div>
          {accion === "devolver" && (
            <form onSubmit={(e) => { e.preventDefault(); const ls = lineas.filter((l) => Number(devolver[l.id] || 0) > 0).map((l) => ({ compra_linea_id: l.id, unidades: Number(devolver[l.id]) }));
              if (!ls.length) { setError("Pon cuántas unidades devuelves."); return; }
              hacer("/api/compras/devoluciones", "POST", { compra_id: c.id, motivo, lineas: ls, idem_key: crypto.randomUUID() }, "Devolución registrada: las unidades salieron del inventario. Cuando llegue la nota crédito del proveedor, regístrala aquí."); }}
              className="grid gap-3 rounded-xl bg-paper p-3">
              <ul className="grid gap-2">{lineas.map((l) => (
                <li key={l.id} className="flex flex-wrap items-center gap-3">
                  <label htmlFor={`devolver-${l.id}`} className="flex-1 min-w-[200px]"><b>{l.nombre}</b> <span className="text-sm text-muted num">· lote {l.lote} · puedes devolver {Math.min(cantidad(l) - l.devueltas, l.existencias)} und</span></label>
                  <input id={`devolver-${l.id}`} inputMode="numeric" value={devolver[l.id] ?? ""} onChange={(e) => setDevolver({ ...devolver, [l.id]: e.target.value.replace(/\D/g, "") })} className="campo h-10 w-24 num" placeholder="und" />
                </li>
              ))}</ul>
              <div className="flex flex-wrap gap-2"><label htmlFor="motivo-dev" className="sr-only">Motivo de la devolución</label>
                <input id="motivo-dev" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={200} className="campo flex-1 min-w-[200px]" placeholder="Motivo (avería, vencimiento corto, error de pedido…)" />
                <button disabled={ocupado} className="btn-primario">Registrar devolución</button></div>
            </form>
          )}
          {d.devoluciones.length === 0 ? <p className="text-muted">Sin devoluciones.</p> : (
            <ul className="divide-y divide-line" aria-label="Devoluciones de la compra">{d.devoluciones.map((v) => (
              <li key={v.id} className="py-2.5 grid gap-1.5">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <p className="flex-1 min-w-0"><b>Devolución N.º {v.numero}</b> · <span className="num">{pesosExactos(v.valor)}</span> · {v.motivo}<span className="block text-sm text-muted num">{v.fecha} · {(v.lineas ?? []).map((x: { nombre: string; lote: string; unidades: number }) => `${x.unidades} und de ${x.nombre} (lote ${x.lote})`).join("; ")}</span></p>
                  {v.estado === "aplicada" ? <span className="rounded-md px-2 py-0.5 text-sm font-semibold bg-cruz-soft text-cruz">Nota crédito {v.nc_proveedor} · {pesosExactos(v.valor_nc)}</span>
                    : <button onClick={() => { abrir(`nc-${v.id}`); setNc(""); setValorNc(numeroTexto(v.valor)); }} className="btn-borde h-9 px-3 text-sm">Registrar nota crédito</button>}
                </div>
                {accion === `nc-${v.id}` && (
                  <form onSubmit={(e) => { e.preventDefault(); hacer("/api/compras/devoluciones", "PATCH", { id: v.id, nc_proveedor: nc, valor: leerNumero(valorNc) }, "Nota crédito registrada: el saldo de la factura bajó."); }}
                    className="flex flex-wrap items-end gap-2 rounded-xl bg-paper p-3">
                    <div><label htmlFor={`nc-${v.id}`} className="etiqueta">N.º de la nota crédito</label><input id={`nc-${v.id}`} value={nc} onChange={(e) => setNc(e.target.value.toUpperCase())} className="campo h-10 w-44" /></div>
                    <div><label htmlFor={`nc-valor-${v.id}`} className="etiqueta">Valor</label><input id={`nc-valor-${v.id}`} inputMode="decimal" value={valorNc} onChange={(e) => setValorNc(decimal(e.target.value))} className="campo h-10 w-40 num" /></div>
                    <button disabled={ocupado} className="btn-primario h-10">Guardar nota crédito</button>
                  </form>
                )}
              </li>
            ))}</ul>
          )}
        </section>
      )}

      {dinero && !anulada && (
        <section className="grid gap-2">
          {accion === "anular" ? (
            <form onSubmit={(e) => { e.preventDefault(); hacer(`/api/compras/${c.id}`, "DELETE", { motivo }, "Compra anulada: las unidades salieron del inventario."); }} className="tarjeta p-4 grid gap-2 border-alerta">
              <label htmlFor="motivo-anular" className="etiqueta">Motivo de la anulación</label>
              <input id="motivo-anular" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} className="campo" placeholder="Por ejemplo: factura registrada dos veces" />
              <p className="text-sm text-muted">Se sacan del inventario todas las unidades que entraron con esta compra. No se puede si tiene pagos o devoluciones, o si ya se vendió parte.</p>
              {error && <p role="alert" className="text-alerta font-semibold">{error}</p>}
              <div className="flex gap-2"><button disabled={ocupado} className="btn-peligro">Confirmar anulación</button><button type="button" onClick={() => setAccion(null)} className="btn-borde">Cancelar</button></div>
            </form>
          ) : d.pagos.some((g) => !g.anulado) || d.devoluciones.length > 0
            ? <p className="text-sm text-muted">Esta compra no se puede anular porque tiene {d.devoluciones.length ? "devoluciones al proveedor" : "pagos vigentes (anúlalos primero si fueron un error)"}.</p>
            : <div><button onClick={() => abrir("anular")} className="btn-peligro">Anular compra</button></div>}
        </section>
      )}
      {!dinero && <p className="text-sm text-muted">Los costos, pagos y devoluciones de la compra los maneja el dueño o el administrador.</p>}
      <p className="text-xs text-muted">La compra, sus pagos y devoluciones no se borran: se anulan con motivo y quedan en la auditoría.</p>
    </>
  );
}
