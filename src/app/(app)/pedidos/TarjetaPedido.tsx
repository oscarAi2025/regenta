"use client";
import { useState } from "react";
import { pesos } from "@/lib/formato";
import { ESTADOS, etiquetaPedido, fechaCorta, pesosTexto } from "@/lib/pedidos";
import type { Pedido } from "@/lib/pedidos-servidor";

const COLOR: Record<Pedido["estado"], string> = {
  abierto: "bg-cruz-soft text-cruz", en_camino: "bg-sky-100 text-sky-900", cobrado: "bg-paper text-ink", cancelado: "bg-paper text-muted", vencido: "bg-aviso-soft text-aviso",
};

/** Un pedido de la lista con sus acciones. Tras cada acción, la API devuelve el pedido actualizado y la tarjeta lo aplica. */
export function TarjetaPedido({ inicial, cobra, empresa }: { inicial: Pedido; cobra: boolean; empresa: string }) {
  const [p, setP] = useState(inicial);
  const [cancelando, setCancelando] = useState(false);
  const [motivo, setMotivo] = useState("");
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const nombre = etiquetaPedido(p);
  const abierto = p.estado === "abierto" || p.estado === "en_camino" || p.estado === "vencido";

  async function estado(e: "en_camino" | "abierto" | "cancelado", m?: string) {
    if (enviando) return;
    setEnviando(true); setError("");
    try {
      const r = await fetch(`/api/pedidos/${p.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ estado: e, motivo: m }) });
      const j = await r.json();
      if (!r.ok) { setError(j.error ?? "No se pudo guardar"); return; }
      const { lineas: _l, cliente_datos: _c, ...resto } = j.pedido;
      setP(resto); setCancelando(false); setMotivo("");
    } catch { setError("Sin conexión con el servidor: vuelve a intentarlo"); } finally { setEnviando(false); }
  }
  const tel = (p.telefono ?? "").replace(/\D/g, "");
  const wa = `https://wa.me/${tel.length >= 10 ? "57" + tel.slice(-10) : ""}?text=${encodeURIComponent(`${empresa} · Cotización N.º ${p.numero}${p.contacto ? ` para ${p.contacto}` : ""}: ${p.n_lineas} producto${p.n_lineas === 1 ? "" : "s"} por ${pesosTexto(p.total_mostrado)}.${p.vence ? ` Válida hasta el ${fechaCorta(p.vence)}.` : ""} Precios sujetos a cambio y a existencias.`)}`;

  return (
    <li className="tarjeta p-4 grid gap-3 content-start" aria-label={nombre} data-pedido={p.id}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="font-semibold leading-snug">{nombre}{p.contacto ? <span className="font-normal"> · {p.contacto}</span> : null}</p>
          <p className="text-sm text-muted num">{fechaCorta(p.creado)} · {p.creado.slice(11)}{p.creado_por ? ` · ${p.creado_por}` : ""}{p.caja ? ` · ${p.caja}` : ""}</p>
        </div>
        <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-[13px] font-semibold whitespace-nowrap ${COLOR[p.estado]}`}>{ESTADOS[p.estado]}</span>
      </div>
      {(p.direccion || p.telefono || p.nota || p.cliente) && (
        <p className="text-sm break-words">
          {p.cliente && <span className="block">Cliente: {p.cliente}</span>}
          {p.direccion && <span className="block">{p.direccion}</span>}
          {p.telefono && <span className="block num">Tel. {p.telefono}</span>}
          {p.nota && <span className="block text-muted">{p.nota}</span>}
        </p>
      )}
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-sm text-muted">{p.n_lineas} producto{p.n_lineas === 1 ? "" : "s"}{p.tipo === "cotizacion" && p.vence ? ` · válida hasta el ${fechaCorta(p.vence)}` : ""}</p>
        <p className="num font-semibold text-lg">{pesos(p.total_mostrado)}</p>
      </div>
      {abierto && Math.round(p.total_actual) !== Math.round(p.total_mostrado) && (
        <p className="text-sm font-semibold text-aviso">Cambiaron precios: hoy serían {pesos(p.total_actual)}</p>
      )}
      {p.estado === "cancelado" && p.motivo && <p className="text-sm text-muted">Motivo: {p.motivo}</p>}
      {p.estado === "cobrado" && p.venta && <p className="text-sm">Cobrado en la venta <span className="num font-semibold">{p.venta}</span></p>}

      {cancelando ? (
        <form className="grid gap-2 rounded-xl bg-paper p-3" onSubmit={(e) => { e.preventDefault(); void estado("cancelado", motivo); }} aria-label={`Cancelar ${nombre}`}>
          <label htmlFor={`motivo-${p.id}`} className="text-sm font-semibold">Motivo de la cancelación</label>
          <input id={`motivo-${p.id}`} className="campo" value={motivo} maxLength={200} autoFocus onChange={(e) => setMotivo(e.target.value)} placeholder="Ej.: el cliente no lo recibió" />
          <div className="flex flex-wrap gap-2">
            <button disabled={enviando || motivo.trim().length < 3} className="btn-peligro h-10 text-sm disabled:opacity-50">{enviando ? "Guardando…" : "Cancelar pedido"}</button>
            <button type="button" onClick={() => { setCancelando(false); setError(""); }} className="btn-borde h-10 text-sm">Volver</button>
          </div>
        </form>
      ) : (
        <div className="flex flex-wrap gap-2 pt-1 border-t border-line">
          {abierto && cobra && <a href={`/caja?pedido=${p.id}`} className="btn-oscuro h-10 text-sm">{p.tipo === "cotizacion" ? "Convertir en venta" : p.tipo === "domicilio" ? "Cobrar en la caja" : "Abrir en la caja"}</a>}
          {p.tipo === "domicilio" && p.estado === "abierto" && <button onClick={() => estado("en_camino")} disabled={enviando} className="btn-borde h-10 text-sm">Marcar en camino</button>}
          {p.tipo === "domicilio" && p.estado === "en_camino" && <button onClick={() => estado("abierto")} disabled={enviando} className="btn-borde h-10 text-sm">Volvió sin entregar</button>}
          {p.estado === "abierto" && <a href={`/pedidos/${p.id}`} className="btn-borde h-10 text-sm">Editar</a>}
          {p.tipo !== "espera" && p.estado !== "cancelado" && <a href={`/tiquete/cotizacion/${p.id}`} target="_blank" rel="noopener" className="btn-borde h-10 text-sm">{p.tipo === "cotizacion" ? "Imprimir" : "Rótulo"}</a>}
          {p.tipo === "cotizacion" && abierto && <a href={wa} target="_blank" rel="noopener" className="btn-borde h-10 text-sm">WhatsApp</a>}
          {p.estado === "cobrado" && p.venta_id && cobra && <a href={`/ventas/${p.venta_id}`} className="btn-borde h-10 text-sm">Ver venta</a>}
          {abierto && <button onClick={() => { setCancelando(true); setError(""); }} className="h-10 px-3 text-sm font-semibold text-alerta">Cancelar…</button>}
        </div>
      )}
      {error && <p role="alert" className="text-sm text-alerta">{error}</p>}
    </li>
  );
}
