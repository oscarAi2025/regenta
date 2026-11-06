"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { pesos } from "@/lib/formato";
import { hoyBogota, restarDias } from "@/lib/control-especial";
import { TIPOS, etiquetaPedido, fechaCorta, netoLinea, prefijoCantidad, textoCotizacion, MAX_CANTIDAD, type TipoPedido } from "@/lib/pedidos";
import type { PedidoDetalle } from "@/lib/pedidos-servidor";
import { Fila } from "../caja/Productos";
import { LineaVenta } from "../caja/LineaVenta";
import { precioDe, unidadesDe, type Linea, type Producto } from "../caja/tipos";

const VALIDEZ = [3, 8, 15, 30];

/** Armar o editar un pedido sin pasar por la caja (lo usa el vendedor, que no cobra): productos, cantidades, datos de
 *  entrega o de la cotización. Al guardar ofrece imprimir y WhatsApp. */
export function EditorPedido({ inicial, empresa, cobra }: { inicial: PedidoDetalle | null; empresa: string; cobra: boolean }) {
  const [tipo, setTipo] = useState<TipoPedido>(inicial?.tipo ?? "cotizacion");
  const [lineas, setLineas] = useState<Linea[]>(() => (inicial?.lineas ?? []).map((l) => ({
    key: String(l.id), p: l.producto, presentacion: l.presentacion, cantidad: l.cantidad, descuento: l.descuento_pct,
    antes: (l.presentacion === "caja" ? l.producto.precio_caja : l.producto.precio_unidad ?? 0) !== l.precio_mostrado ? l.precio_mostrado : undefined,
  })));
  const [d, setD] = useState({ contacto: inicial?.contacto ?? "", telefono: inicial?.telefono ?? "", direccion: inicial?.direccion ?? "", nota: inicial?.nota ?? "" });
  const [dias, setDias] = useState(inicial?.vence ? 0 : 8); // 0 = conserva la validez que tenía
  const [descGeneral, setDescGeneral] = useState(inicial?.descuento_pct ?? 0);
  const [q, setQ] = useState("");
  const [mult, setMult] = useState<number | null>(null);
  const [res, setRes] = useState<Producto[]>([]);
  const [sel, setSel] = useState(0);
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [hecho, setHecho] = useState<PedidoDetalle | null>(null);
  const buscador = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const t = q.trim();
    if (!t) { setRes([]); return; }
    const ctl = new AbortController();
    const h = setTimeout(async () => {
      try { const r = await fetch(`/api/productos?q=${encodeURIComponent(t)}`, { signal: ctl.signal }); const j = await r.json(); setRes(j.productos ?? []); setSel(0); }
      catch { /* cancelada */ }
    }, 160);
    return () => { clearTimeout(h); ctl.abort(); };
  }, [q]);

  function agregar(p: Producto, presentacion: "caja" | "unidad") {
    const n = mult ?? 1;
    setLineas((ls) => {
      const i = ls.findIndex((l) => l.p.id === p.id && l.presentacion === presentacion);
      if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, cantidad: Math.min(MAX_CANTIDAD, l.cantidad + n) } : l));
      return [...ls, { key: crypto.randomUUID(), p, presentacion, cantidad: n, descuento: 0 }];
    });
    setQ(""); setRes([]); setMult(null); setError("");
    buscador.current?.focus();
  }
  const total = useMemo(() => lineas.reduce((a, l) => a + netoLinea(precioDe(l), l.cantidad, l.descuento, descGeneral).neto, 0), [lineas, descGeneral]);
  const excede = (p: Producto) => lineas.filter((l) => l.p.id === p.id).reduce((a, l) => a + unidadesDe(l), 0) > p.unidades;

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (enviando) return;
    if (!lineas.length) { setError("Agrega al menos un producto"); buscador.current?.focus(); return; }
    if (tipo === "domicilio" && (!d.contacto.trim() || !d.telefono.trim() || !d.direccion.trim())) { setError("Escribe nombre, teléfono y dirección de entrega"); return; }
    setEnviando(true); setError("");
    const cuerpo = {
      tipo, cliente_id: inicial?.cliente_id ?? null, ...d, descuento_pct: descGeneral,
      vence: tipo === "cotizacion" ? (inicial && inicial.tipo === "cotizacion" && inicial.vence && dias === 0 ? inicial.vence : restarDias(hoyBogota(), -(dias || 8))) : null,
      lineas: lineas.map((l) => ({ producto_id: l.p.id, presentacion: l.presentacion, cantidad: l.cantidad, descuento_pct: l.descuento })),
    };
    try {
      const r = await fetch(inicial ? `/api/pedidos/${inicial.id}` : "/api/pedidos", { method: inicial ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) });
      const j = await r.json();
      if (!r.ok) { setError(j.error ?? "No se pudo guardar el pedido"); return; }
      setHecho(j.pedido);
    } catch { setError("Sin conexión con el servidor: vuelve a intentarlo"); } finally { setEnviando(false); }
  }

  if (hecho) {
    const tel = (hecho.telefono ?? "").replace(/\D/g, "");
    const texto = textoCotizacion({ empresa, numero: hecho.numero, vence: hecho.vence, contacto: hecho.contacto, descuento_pct: hecho.descuento_pct,
      lineas: hecho.lineas.map((l) => ({ nombre: l.producto.nombre, presentacion: l.presentacion, cantidad: l.cantidad, precio: l.precio_mostrado, descuento_pct: l.descuento_pct, upc: l.producto.unidades_por_caja })) });
    return (
      <section className="tarjeta p-5 sm:p-6 grid gap-4 max-w-2xl" aria-label="Pedido guardado">
        <p role="status" className="rounded-xl bg-cruz-soft text-cruz px-4 py-3 font-semibold">{etiquetaPedido(hecho)} {hecho.tipo === "cotizacion" ? "guardada" : "guardado"}{hecho.contacto ? ` · ${hecho.contacto}` : ""} · {pesos(hecho.total_mostrado)}</p>
        <p className="text-muted">{hecho.tipo === "cotizacion" ? `Válida hasta el ${fechaCorta(hecho.vence)}. Al convertirla en venta, la caja cobra el precio del día.`
          : hecho.tipo === "domicilio" ? "Imprime el rótulo y, cuando salga el domiciliario, márcalo «en camino» en Pedidos." : "La caja la recupera con F6."}
          {!cobra && " La caja es la que cobra."}</p>
        <div className="flex flex-wrap gap-2">
          {hecho.tipo !== "espera" && <a href={`/tiquete/cotizacion/${hecho.id}`} target="_blank" rel="noopener" className="btn-borde">{hecho.tipo === "cotizacion" ? "Imprimir cotización" : "Imprimir rótulo"}</a>}
          {hecho.tipo === "cotizacion" && <a href={`https://wa.me/${tel.length >= 10 ? "57" + tel.slice(-10) : ""}?text=${encodeURIComponent(texto)}`} target="_blank" rel="noopener" className="btn-primario">Enviar por WhatsApp</a>}
          {cobra && <a href={`/caja?pedido=${hecho.id}`} className="btn-oscuro">{hecho.tipo === "cotizacion" ? "Convertir en venta" : "Abrir en la caja"}</a>}
          <a href="/pedidos" className="btn-borde">Ver pedidos</a>
          <a href="/pedidos/nuevo" className="btn-borde">Armar otro</a>
        </div>
      </section>
    );
  }

  const campo = (id: keyof typeof d, etiqueta: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div><label htmlFor={`ed-${id}`} className="etiqueta">{etiqueta}</label>
      <input id={`ed-${id}`} className="campo" value={d[id]} onChange={(e) => { setD({ ...d, [id]: e.target.value }); setError(""); }} autoComplete="off" {...props} /></div>
  );
  return (
    <form onSubmit={guardar} className="grid xl:grid-cols-[minmax(0,1fr)_420px] gap-5 items-start" aria-label={inicial ? `Editar ${etiquetaPedido(inicial)}` : "Nuevo pedido"}>
      <section className="grid gap-4 min-w-0" aria-label="Productos del pedido">
        {!inicial && (
          <div className="grid grid-cols-3 gap-1 rounded-xl bg-paper p-1 max-w-lg" role="group" aria-label="Tipo de pedido">
            {(["cotizacion", "domicilio", "espera"] as const).map((t) => (
              <button type="button" key={t} aria-pressed={tipo === t} onClick={() => setTipo(t)} className={`h-10 rounded-lg text-sm font-semibold ${tipo === t ? "bg-ink text-white" : "text-muted"}`}>{TIPOS[t]}</button>
            ))}
          </div>
        )}
        <div>
          <label htmlFor="ed-buscar" className="etiqueta">Agregar productos <span className="font-normal text-muted">(escribe 12* antes para llevar 12)</span></label>
          <input id="ed-buscar" ref={buscador} value={q} autoComplete="off" spellCheck={false} placeholder={mult ? `${mult} × siguiente producto` : "Nombre, laboratorio o código de barras"} className="campo h-14 text-lg"
            onChange={(e) => { const pre = prefijoCantidad(e.target.value); if (!pre) { setQ(e.target.value); return; } if (pre.error) setError(pre.error); else setMult(pre.cantidad); setQ(pre.resto); }}
            onKeyDown={(e) => {
              if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, res.length - 1)); }
              if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
              if (e.key === "Enter") { e.preventDefault(); if (res[sel] && res[sel].unidades > 0) agregar(res[sel], "caja"); }
            }} />
          {mult !== null && <p role="status" className="mt-2 inline-flex gap-2 rounded-lg bg-ink text-white px-3 py-1.5 text-sm font-semibold">Cantidad: {mult} para el siguiente producto <button type="button" onClick={() => setMult(null)} className="underline font-normal">Anular</button></p>}
        </div>
        {res.length > 0 && (
          <ul className="bg-surface rounded-2xl border border-line divide-y divide-line overflow-hidden" role="listbox" aria-label="Resultados">
            {res.map((p, i) => <Fila key={p.id} p={p} activo={i === sel} onHover={() => setSel(i)} agregar={agregar} />)}
          </ul>
        )}
        {q.trim() && !res.length && <p className="text-muted">Sin resultados para «{q.trim()}».</p>}
      </section>

      <aside className="tirilla rounded-2xl pb-6 xl:sticky xl:top-6" aria-label="Pedido">
        <div className="px-6 pt-5 flex items-baseline justify-between"><h2 className="font-cond text-xl" style={{ fontWeight: 700 }}>{inicial ? etiquetaPedido(inicial) : TIPOS[tipo]}</h2>
          <span className="text-sm text-muted num">{lineas.length} producto{lineas.length === 1 ? "" : "s"}</span></div>
        {lineas.length === 0 ? <p className="px-6 py-8 text-muted text-center">Busca y agrega los productos.</p> : (
          <ul className="px-6 py-2 divide-y divide-dashed divide-line">
            {lineas.map((l) => <LineaVenta key={l.key} l={l} sobra={excede(l.p)} onCambio={(c) => setLineas((ls) => ls.map((x) => (x.key === l.key ? { ...x, ...c } : x)))} onQuitar={() => setLineas((ls) => ls.filter((x) => x.key !== l.key))} />)}
          </ul>
        )}
        <div className="corte" />
        <div className="px-6 pt-3 grid gap-3">
          {lineas.length > 0 && <label className="flex items-center justify-end gap-1.5 text-sm text-muted">Descuento general
            <input inputMode="decimal" className="num w-14 h-8 rounded-lg border border-line px-2 text-right" value={descGeneral || ""} placeholder="0"
              onChange={(e) => setDescGeneral(Math.min(99, Math.max(0, Number(e.target.value.replace(",", ".").replace(/[^\d.]/g, "")) || 0)))} />%</label>}
          <p className="flex items-baseline justify-between"><span>Valor estimado</span><span className="num font-cond text-[34px] leading-none" style={{ fontWeight: 700 }}>{pesos(total)}</span></p>
          {tipo === "domicilio" ? <>
            {campo("contacto", "A nombre de", { maxLength: 80, required: true })}
            {campo("telefono", "Teléfono", { maxLength: 20, inputMode: "tel", required: true })}
            {campo("direccion", "Dirección de entrega", { maxLength: 200, required: true })}
            {campo("nota", "Indicaciones (opcional)", { maxLength: 300 })}
          </> : tipo === "cotizacion" ? <>
            {campo("contacto", "Para (opcional)", { maxLength: 80 })}
            {campo("telefono", "Celular para WhatsApp (opcional)", { maxLength: 20, inputMode: "tel" })}
            <div><p className="etiqueta" id="ed-validez">Válida por</p>
              <div className="flex flex-wrap gap-2" role="group" aria-labelledby="ed-validez">
                {inicial?.vence && <button type="button" aria-pressed={dias === 0} onClick={() => setDias(0)} className={`h-10 px-3 rounded-lg border-2 text-sm font-semibold ${dias === 0 ? "border-ink bg-ink text-white" : "border-line"}`}>Hasta el {fechaCorta(inicial.vence)}</button>}
                {VALIDEZ.map((v) => <button type="button" key={v} aria-pressed={dias === v} onClick={() => setDias(v)} className={`h-10 px-3 rounded-lg border-2 text-sm font-semibold ${dias === v ? "border-ink bg-ink text-white" : "border-line"}`}>{v} días</button>)}
              </div></div>
            {campo("nota", "Nota (opcional)", { maxLength: 300 })}
          </> : <>
            {campo("contacto", "Nombre corto (opcional)", { maxLength: 80 })}
          </>}
          {error && <p role="alert" className="text-sm text-alerta">{error}</p>}
          <button disabled={enviando} className="btn-oscuro h-12 disabled:opacity-60">{enviando ? "Guardando…" : inicial ? "Guardar cambios" : `Guardar ${TIPOS[tipo].toLowerCase()}`}</button>
          <p className="text-sm text-muted">Nada aparta existencias. Precios sujetos a cambio: se cobra el del día en que se convierte en venta.</p>
        </div>
      </aside>
    </form>
  );
}
