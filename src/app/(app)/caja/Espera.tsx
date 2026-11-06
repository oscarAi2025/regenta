"use client";
import { useEffect, useRef, useState } from "react";
import { pesos } from "@/lib/formato";
import { hoyBogota, restarDias } from "@/lib/control-especial";
import { ESTADOS, TIPOS, etiquetaPedido, fechaCorta, textoCotizacion, type TipoPedido } from "@/lib/pedidos";
import { imprimirRuta } from "@/lib/impresion";

// Ventas en espera, domicilios y cotizaciones desde la caja: el cuadro para guardarlas (F4 o los botones) y la lista
// para recuperarlas (F6). Todo queda en el servidor: otra caja puede cobrar lo que esta guardó.

export type DatosPedido = { contacto: string; telefono: string; direccion: string; nota: string; vence: string | null };
export type PedidoGuardado = {
  id: string; tipo: TipoPedido; numero: number; contacto: string | null; telefono: string | null; vence: string | null; descuento_pct: number;
  lineas: { presentacion: "caja" | "unidad"; cantidad: number; descuento_pct: number; precio_mostrado: number; producto: { nombre: string; unidades_por_caja: number } }[];
};

function Dialogo({ titulo, onCerrar, children, ancho = "max-w-md" }: { titulo: string; onCerrar: () => void; children: React.ReactNode; ancho?: string }) {
  const caja = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const anterior = document.activeElement as HTMLElement | null;
    const primero = caja.current?.querySelector<HTMLElement>("input, select, textarea, button:not([data-cerrar])");
    primero?.focus();
    return () => anterior?.focus?.();
  }, []);
  return (
    <div className="fixed inset-0 z-50 bg-ink/40 flex items-end sm:items-center justify-center p-0 sm:p-4" onMouseDown={(e) => { if (e.target === e.currentTarget) onCerrar(); }}>
      <div ref={caja} role="dialog" aria-modal="true" aria-labelledby="dlg-titulo"
        onKeyDown={(e) => { if (e.key === "Escape") { e.preventDefault(); e.stopPropagation(); onCerrar(); } if (/^F\d+$/.test(e.key)) e.stopPropagation(); }}
        className={`w-full ${ancho} max-h-[92vh] overflow-auto bg-surface rounded-t-2xl sm:rounded-2xl shadow-xl p-5 sm:p-6`}>
        <div className="flex items-start justify-between gap-3">
          <h2 id="dlg-titulo" className="titulo text-2xl leading-tight">{titulo}</h2>
          <button data-cerrar onClick={onCerrar} aria-label="Cerrar" className="text-2xl leading-none text-muted hover:text-ink -mt-1">×</button>
        </div>
        {children}
      </div>
    </div>
  );
}

const VALIDEZ = [3, 8, 15, 30];

/** Guardar la venta actual como espera, domicilio o cotización. */
export function GuardarPedido({ tipo, inicial, guardar, onCerrar, onListo, nombreEmpresa }: {
  tipo: TipoPedido; inicial: Partial<DatosPedido>; nombreEmpresa: string;
  guardar: (d: DatosPedido) => Promise<{ pedido: PedidoGuardado } | { error: string }>;
  onCerrar: () => void; onListo: (p: PedidoGuardado, enCamino?: boolean) => void;
}) {
  const [d, setD] = useState<DatosPedido>({ contacto: inicial.contacto ?? "", telefono: inicial.telefono ?? "", direccion: inicial.direccion ?? "", nota: inicial.nota ?? "", vence: null });
  const [dias, setDias] = useState(8);
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [hecho, setHecho] = useState<PedidoGuardado | null>(null);
  const [saliendo, setSaliendo] = useState(false);

  async function enviar(e: React.FormEvent) {
    e.preventDefault();
    if (enviando) return;
    if (tipo === "domicilio" && (!d.contacto.trim() || !d.telefono.trim() || !d.direccion.trim())) { setError("Escribe nombre, teléfono y dirección de entrega"); return; }
    setEnviando(true); setError("");
    const r = await guardar({ ...d, vence: tipo === "cotizacion" ? restarDias(hoyBogota(), -dias) : null });
    setEnviando(false);
    if ("error" in r) { setError(r.error); return; }
    if (tipo === "espera") onListo(r.pedido); else setHecho(r.pedido);
  }
  async function enCamino() {
    if (!hecho || saliendo) return;
    setSaliendo(true); setError("");
    try {
      const r = await fetch(`/api/pedidos/${hecho.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ estado: "en_camino" }) });
      const j = await r.json();
      if (!r.ok) { setError(j.error ?? "No se pudo marcar en camino"); return; }
      onListo(hecho, true);
    } catch { setError("Sin conexión con el servidor: vuelve a intentarlo"); } finally { setSaliendo(false); }
  }

  const titulo = tipo === "espera" ? "Poner la venta en espera" : tipo === "domicilio" ? "Domicilio" : "Cotización";
  if (hecho) {
    const tel = (hecho.telefono ?? "").replace(/\D/g, "");
    const texto = textoCotizacion({ empresa: nombreEmpresa, numero: hecho.numero, vence: hecho.vence, contacto: hecho.contacto, descuento_pct: hecho.descuento_pct,
      lineas: hecho.lineas.map((l) => ({ nombre: l.producto.nombre, presentacion: l.presentacion, cantidad: l.cantidad, precio: l.precio_mostrado, descuento_pct: l.descuento_pct, upc: l.producto.unidades_por_caja })) });
    return (
      <Dialogo titulo={titulo} onCerrar={() => onListo(hecho)}>
        <p role="status" className="mt-3 rounded-xl bg-cruz-soft text-cruz px-4 py-3 font-semibold">{etiquetaPedido(hecho)} {hecho.tipo === "cotizacion" ? "guardada" : "guardado"}{hecho.contacto ? ` · ${hecho.contacto}` : ""}</p>
        {tipo === "domicilio" ? <>
          <p className="mt-3 text-sm text-muted">Imprime el rótulo para el domiciliario. Cuando salga, márcalo «en camino»; al volver se cobra desde Pedidos o con F6 (o se cancela sin mover existencias).</p>
          <div className="mt-4 grid gap-2">
            <button onClick={() => imprimirRuta(`/tiquete/cotizacion/${hecho.id}`)} className="btn-borde h-12">Imprimir rótulo</button>
            <button onClick={enCamino} disabled={saliendo} className="btn-oscuro h-12">{saliendo ? "Guardando…" : "Salió: marcar en camino"}</button>
            <button onClick={() => onListo(hecho)} className="btn-borde h-12">Listo, sigue en el mostrador</button>
          </div>
        </> : <>
          <p className="mt-3 text-sm text-muted">Válida hasta el {fechaCorta(hecho.vence)}. Se cobra al precio del día en que se convierta en venta.</p>
          <div className="mt-4 grid gap-2">
            <a href={`/tiquete/cotizacion/${hecho.id}`} target="_blank" rel="noopener" className="btn-borde h-12">Imprimir cotización</a>
            <a href={`https://wa.me/${tel.length >= 10 ? "57" + tel.slice(-10) : ""}?text=${encodeURIComponent(texto)}`} target="_blank" rel="noopener" className="btn-primario h-12">Enviar por WhatsApp</a>
            <button onClick={() => onListo(hecho)} className="btn-borde h-12">Listo</button>
          </div>
        </>}
        {error && <p role="alert" className="mt-3 text-sm text-alerta">{error}</p>}
      </Dialogo>
    );
  }
  const campo = (id: keyof DatosPedido, etiqueta: string, props: React.InputHTMLAttributes<HTMLInputElement> = {}) => (
    <div><label htmlFor={`pd-${id}`} className="etiqueta">{etiqueta}</label>
      <input id={`pd-${id}`} className="campo" value={String(d[id] ?? "")} onChange={(e) => { setD({ ...d, [id]: e.target.value }); setError(""); }} autoComplete="off" {...props} /></div>
  );
  return (
    <Dialogo titulo={titulo} onCerrar={onCerrar}>
      <form onSubmit={enviar} className="mt-4 grid gap-3" aria-label={titulo}>
        {tipo === "espera" && <>
          {campo("contacto", "Nombre corto (opcional)", { maxLength: 80, placeholder: "Ej.: señora de la gorra roja" })}
          <p className="text-sm text-muted">La venta queda guardada y la caja libre. Cualquier caja la recupera con <kbd>F6</kbd>.</p>
        </>}
        {tipo === "domicilio" && <>
          {campo("contacto", "A nombre de", { maxLength: 80, required: true })}
          {campo("telefono", "Teléfono", { maxLength: 20, inputMode: "tel", required: true })}
          {campo("direccion", "Dirección de entrega", { maxLength: 200, required: true })}
          {campo("nota", "Indicaciones (opcional)", { maxLength: 300, placeholder: "Ej.: paga con billete de $50.000" })}
        </>}
        {tipo === "cotizacion" && <>
          {campo("contacto", "Para (opcional)", { maxLength: 80 })}
          {campo("telefono", "Celular para WhatsApp (opcional)", { maxLength: 20, inputMode: "tel" })}
          <div><p className="etiqueta" id="pd-validez">Válida por</p>
            <div className="flex flex-wrap gap-2" role="group" aria-labelledby="pd-validez">
              {VALIDEZ.map((v) => <button type="button" key={v} aria-pressed={dias === v} onClick={() => setDias(v)} className={`h-10 px-3 rounded-lg border-2 text-sm font-semibold ${dias === v ? "border-ink bg-ink text-white" : "border-line"}`}>{v} días</button>)}
            </div></div>
          <p className="text-sm text-muted">No aparta productos y los precios están sujetos a cambio: al convertirla se cobra el precio del día.</p>
        </>}
        {error && <p role="alert" className="text-sm text-alerta">{error}</p>}
        <button disabled={enviando} className="btn-oscuro h-12 mt-1 disabled:opacity-60">{enviando ? "Guardando…" : tipo === "espera" ? "Guardar en espera" : tipo === "domicilio" ? "Guardar domicilio" : "Guardar cotización"}</button>
      </form>
    </Dialogo>
  );
}

type Fila = { id: string; tipo: TipoPedido; estado: keyof typeof ESTADOS; numero: number; contacto: string | null; creado: string; n_lineas: number; total_actual: number; caja: string | null; creado_por: string | null };

/** Lista para recuperar (F6): esperas, domicilios y cotizaciones abiertas de toda la droguería. */
export function ListaPedidos({ onRecuperar, onCerrar, actual }: { onRecuperar: (id: string) => void; onCerrar: () => void; actual: string | null }) {
  const [tipo, setTipo] = useState<TipoPedido>("espera");
  const [filas, setFilas] = useState<Fila[] | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    const ctl = new AbortController();
    setFilas(null); setError("");
    fetch(`/api/pedidos?tipo=${tipo}`, { signal: ctl.signal })
      .then(async (r) => { const j = await r.json(); if (!r.ok) throw new Error(j.error); setFilas(j.pedidos ?? []); })
      .catch((e) => { if (!ctl.signal.aborted) setError(e instanceof TypeError ? "Sin conexión con el servidor" : (e as Error).message || "No se pudo cargar la lista"); });
    return () => ctl.abort();
  }, [tipo]);
  return (
    <Dialogo titulo="Recuperar una venta" onCerrar={onCerrar} ancho="max-w-xl">
      <div className="mt-4 grid grid-cols-3 gap-1 rounded-xl bg-paper p-1" role="group" aria-label="Tipo">
        {(Object.keys(TIPOS) as TipoPedido[]).map((t) => (
          <button key={t} aria-pressed={tipo === t} onClick={() => setTipo(t)} className={`h-10 rounded-lg text-sm font-semibold ${tipo === t ? "bg-ink text-white" : "text-muted"}`}>{t === "espera" ? "En espera" : t === "domicilio" ? "Domicilios" : "Cotizaciones"}</button>
        ))}
      </div>
      {error ? <p role="alert" className="mt-4 text-alerta text-sm">{error}</p>
        : !filas ? <p className="mt-6 text-muted text-center">Cargando…</p>
        : filas.length === 0 ? <p className="mt-6 mb-2 text-muted text-center">No hay {tipo === "espera" ? "ventas en espera" : tipo === "domicilio" ? "domicilios abiertos" : "cotizaciones abiertas"}.</p>
        : <ul className="mt-4 divide-y divide-line rounded-xl border border-line" aria-label="Pedidos para recuperar">
          {filas.map((f) => (
            <li key={f.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="font-semibold leading-snug">{etiquetaPedido(f)}{f.contacto ? ` · ${f.contacto}` : ""}</p>
                <p className="text-sm text-muted">{f.creado.slice(11)} · {f.n_lineas} producto{f.n_lineas === 1 ? "" : "s"} · <span className="num">{pesos(f.total_actual)}</span>{f.caja ? ` · ${f.caja}` : ""}{f.estado !== "abierto" ? ` · ${ESTADOS[f.estado].toLowerCase()}` : ""}</p>
              </div>
              {f.id === actual ? <span className="text-sm text-muted">En esta caja</span>
                : <button onClick={() => onRecuperar(f.id)} aria-label={`Recuperar ${etiquetaPedido(f)}`} className="btn-oscuro h-10 text-sm">Recuperar</button>}
            </li>
          ))}
        </ul>}
      <p className="mt-4 text-sm text-muted">Si la venta actual tiene productos, queda en espera antes de abrir la otra.</p>
    </Dialogo>
  );
}
