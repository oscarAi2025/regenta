"use client";
import { guardarImpresora, imprimirTiquete, leerImpresora, type Impresora } from "@/lib/impresion";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { pesos } from "@/lib/formato";
import { ClienteFactura, documento, type Cliente } from "./ClienteFactura";
import { actualizarCatalogo, buscarLocal, catalogo, cola, descartar, encolar, esFallaDeRed, imprimirProvisional, sincronizar, type VentaEnCola } from "@/lib/sin-conexion";

type Producto = {
  id: string; nombre: string; laboratorio: string | null; ean: string | null; iva: number; unidades_por_caja: number;
  precio_caja: number; precio_unidad: number | null; stock_minimo: number; unidades: number; proximo_vence: string | null; exacto: boolean;
};
type Linea = { key: string; p: Producto; presentacion: "caja" | "unidad"; cantidad: number; descuento: number /* % */ };
type Medio = "efectivo" | "transferencia" | "nequi" | "daviplata" | "tarjeta" | "bre_b" | "qr";
type Resultado = { provisional?: VentaEnCola; venta: { venta_id: string; prefijo: string; numero: number; total: number; cambio: number; base: number; iva: number; credito?: boolean; vence_pago?: string | null; repetida?: boolean }; documento: { tipo: "pos" | "factura"; estado: string; cufe: string | null; simulado: boolean; ultimo_error: string | null } };
const PLAZOS = [15, 30, 45, 60, 90];
const fechaCorta = (f: string) => new Date(f + "T00:00:00").toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" });

const MEDIOS: { id: Medio; label: string }[] = [
  { id: "efectivo", label: "Efectivo" }, { id: "nequi", label: "Nequi" }, { id: "daviplata", label: "Daviplata" },
  { id: "bre_b", label: "Bre-B" }, { id: "qr", label: "QR Bancolombia" }, { id: "transferencia", label: "Transferencia" }, { id: "tarjeta", label: "Tarjeta" },
];

function diasA(f: string | null) {
  if (!f) return null;
  return Math.round((Date.parse(f + "T00:00:00") - Date.now()) / 864e5);
}

function Vence({ fecha }: { fecha: string | null }) {
  const d = diasA(fecha);
  if (d === null || d > 90) return null;
  const malo = d <= 30;
  return (
    <span className={`text-[12px] font-semibold px-1.5 py-0.5 rounded ${malo ? "bg-alerta-soft text-alerta" : "bg-aviso-soft text-aviso"}`}>
      {d < 0 ? "Vencido" : d === 0 ? "Vence hoy" : `Vence en ${d} d`}
    </span>
  );
}

function existencias(p: Producto) {
  if (p.unidades <= 0) return "Agotado";
  if (p.unidades_por_caja <= 1) return `${p.unidades} und`;
  const c = Math.floor(p.unidades / p.unidades_por_caja), u = p.unidades % p.unidades_por_caja;
  return `${c} caja${c === 1 ? "" : "s"}${u ? ` + ${u} und` : ""}`;
}

export function Caja({ fiar, empresa, nombreEmpresa }: { fiar: boolean; empresa: string; nombreEmpresa: string }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Producto[]>([]);
  const [sel, setSel] = useState(0);
  const [buscando, setBuscando] = useState(false);
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [cobrando, setCobrando] = useState(false);
  const [medio, setMedio] = useState<Medio>("efectivo");
  const [recibido, setRecibido] = useState("");
  // Pago mixto: una parte con otro medio (tarjeta, Nequi…) y el resto en efectivo.
  const [otro, setOtro] = useState<{ medio: Medio; valor: string } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  const [hecho, setHecho] = useState<Resultado | null>(null);
  const [impresora, setImpresora] = useState<Impresora>({ auto: true, ancho: "80" });
  useEffect(() => setImpresora(leerImpresora()), []);
  const cambiarImpresora = (i: Impresora) => { setImpresora(i); guardarImpresora(i); };
  const [vencen, setVencen] = useState<Producto[]>([]);
  const [tipoDoc, setTipoDoc] = useState<"pos" | "factura">("pos");
  const [cliente, setCliente] = useState<Cliente | null>(null);
  const [credito, setCredito] = useState(false);
  const [plazo, setPlazo] = useState(30);
  const idem = useRef<string>(crypto.randomUUID());
  // Sin internet: catálogo local, cola de ventas y aviso del estado.
  const [enLinea, setEnLinea] = useState(true);
  const [pendientes, setPendientes] = useState(0);
  const [fallidas, setFallidas] = useState<VentaEnCola[]>([]);
  const [avisoCola, setAvisoCola] = useState("");
  const contar = useCallback(() => { const c = cola().filter((v) => v.empresa === empresa); setPendientes(c.filter((v) => !v.error).length); setFallidas(c.filter((v) => v.error)); }, [empresa]);
  const enviarCola = useCallback(async () => {
    if (!cola().some((v) => v.empresa === empresa && !v.error)) return;
    const r = await sincronizar(empresa);
    if (r.enviadas) setAvisoCola(`${r.enviadas} venta${r.enviadas === 1 ? "" : "s"} hecha${r.enviadas === 1 ? "" : "s"} sin internet ya ${r.enviadas === 1 ? "quedó registrada" : "quedaron registradas"} y en camino a la DIAN.`);
    if (r.sesion) setAvisoCola("Tu sesión venció: entra de nuevo para enviar las ventas hechas sin internet. Siguen guardadas en esta caja.");
    contar();
  }, [empresa, contar]);
  useEffect(() => {
    setEnLinea(navigator.onLine); contar();
    void actualizarCatalogo(); void enviarCola();
    const on = () => { setEnLinea(true); void enviarCola(); void actualizarCatalogo(); };
    const off = () => setEnLinea(false);
    addEventListener("online", on); addEventListener("offline", off); addEventListener("regenta:cola", contar);
    const t1 = setInterval(() => void enviarCola(), 20000);
    const t2 = setInterval(() => { if (navigator.onLine) void actualizarCatalogo(); }, 600000);
    return () => { removeEventListener("online", on); removeEventListener("offline", off); removeEventListener("regenta:cola", contar); clearInterval(t1); clearInterval(t2); };
  }, [contar, enviarCola]);
  const buscador = useRef<HTMLInputElement>(null);
  const recibidoRef = useRef<HTMLInputElement>(null);

  // Búsqueda con espera corta (el lector de código de barras escribe muy rápido y termina con Enter).
  useEffect(() => {
    const t = q.trim();
    if (!t) { setRes([]); return; }
    const ctl = new AbortController();
    const h = setTimeout(async () => {
      setBuscando(true);
      const local = () => { const c = catalogo(); if (c?.empresa === empresa) { setRes(buscarLocal(t)); setSel(0); } };
      try {
        if (!navigator.onLine) { local(); return; }
        const r = await fetch(`/api/productos?q=${encodeURIComponent(t)}`, { signal: ctl.signal });
        if (r.status === 401) { location.href = "/entrar"; return; }
        const j = await r.json();
        setRes(j.productos ?? []); setSel(0);
      } catch (e) { if (!ctl.signal.aborted && esFallaDeRed(e)) { setEnLinea(false); local(); } } finally { setBuscando(false); }
    }, 140);
    return () => { clearTimeout(h); ctl.abort(); };
  }, [q]);

  // Lista de «ofrécelos primero»: se recarga al empezar cada venta.
  useEffect(() => {
    if (hecho) return;
    fetch("/api/productos?vencen=1").then((r) => (r.ok ? r.json() : { productos: [] })).then((j) => setVencen(j.productos ?? [])).catch(() => {});
  }, [hecho]);

  const agregar = useCallback((p: Producto, presentacion: "caja" | "unidad") => {
    if (p.unidades <= 0) return;
    setLineas((ls) => {
      const i = ls.findIndex((l) => l.p.id === p.id && l.presentacion === presentacion);
      if (i >= 0) return ls.map((l, j) => (j === i ? { ...l, cantidad: l.cantidad + 1 } : l));
      return [...ls, { key: crypto.randomUUID(), p, presentacion, cantidad: 1, descuento: 0 }];
    });
    setQ(""); setRes([]); setError("");
    buscador.current?.focus();
  }, []);

  // Descuento general sobre toda la venta (%). Se combina con el de cada línea igual que en la base de datos.
  const [descGeneral, setDescGeneral] = useState(0);
  const netoLinea = useCallback((l: Linea) => {
    const bruto = (l.presentacion === "caja" ? l.p.precio_caja : l.p.precio_unidad ?? 0) * l.cantidad;
    const pct = 100 - (100 - l.descuento) * (100 - descGeneral) / 100;
    return { bruto, neto: pct > 0 ? Math.round(bruto * (100 - pct) / 100) : bruto };
  }, [descGeneral]);
  const totales = useMemo(() => {
    let total = 0, iva = 0, descuento = 0;
    for (const l of lineas) {
      const { bruto, neto } = netoLinea(l);
      total += neto; descuento += bruto - neto; iva += neto - neto / (1 + l.p.iva / 100);
    }
    return { total, iva, base: total - iva, descuento, items: lineas.reduce((a, l) => a + l.cantidad, 0) };
  }, [lineas, netoLinea]);

  // Unidades pedidas de un producto (sumando caja y unidad) frente a sus existencias.
  const excede = useCallback((ls: Linea[], p: Producto) =>
    ls.filter((l) => l.p.id === p.id).reduce((a, l) => a + l.cantidad * (l.presentacion === "caja" ? p.unidades_por_caja : 1), 0) > p.unidades, []);

  const nueva = useCallback(() => {
    setLineas([]); setHecho(null); setCobrando(false); setRecibido(""); setMedio("efectivo"); setOtro(null); setDescGeneral(0); setError(""); setCliente(null); setCredito(false);
    idem.current = crypto.randomUUID();
    setTimeout(() => buscador.current?.focus(), 0);
  }, []);

  const aCredito = credito && tipoDoc === "factura" && fiar;
  const otroNum = medio === "efectivo" && otro ? Math.min(Number(otro.valor.replace(/\D/g, "")) || 0, Math.round(totales.total)) : 0;
  const restante = Math.round(totales.total) - otroNum; // lo que falta cubrir en efectivo
  const recibidoNum = medio === "efectivo" && !aCredito ? Number(recibido.replace(/\D/g, "")) || 0 : totales.total;
  const cambio = Math.max(0, recibidoNum - restante);
  const faltaCliente = tipoDoc === "factura" && !cliente;
  const puedeCobrar = lineas.length > 0 && !lineas.some((l) => excede(lineas, l.p)) && !faltaCliente;

  async function confirmar() {
    if (enviando || !puedeCobrar) return;
    if (!aCredito && medio === "efectivo" && otro && (otroNum <= 0 || otroNum >= Math.round(totales.total))) { setError("En el pago mixto, la parte con el otro medio debe ser menor que el total"); return; }
    if (!aCredito && medio === "efectivo" && recibidoNum < restante) { setError(otroNum ? `El efectivo no cubre el resto (${pesos(restante)})` : "El efectivo recibido no cubre el total"); return; }
    setEnviando(true); setError("");
    const cuerpo = {
          idem_key: idem.current, tipo_doc: tipoDoc, cliente_id: tipoDoc === "factura" ? cliente?.id : null,
          condicion: aCredito ? "credito" : "contado", plazo_dias: aCredito ? plazo : null,
          lineas: lineas.map((l) => ({ producto_id: l.p.id, presentacion: l.presentacion, cantidad: l.cantidad, descuento_pct: l.descuento })),
          descuento_pct: descGeneral,
          pagos: aCredito ? [] : medio === "efectivo" && otroNum > 0
            ? [{ medio: otro!.medio, valor: otroNum }, { medio: "efectivo", valor: recibidoNum }]
            : [{ medio, valor: medio === "efectivo" ? recibidoNum : Math.round(totales.total) }],
    };
    try {
      const r = await fetch("/api/ventas", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) });
      const j = await r.json();
      if (!r.ok) { setError(j.error ?? "No se pudo registrar la venta"); return; }
      setHecho(j); setCobrando(false);
      window.dispatchEvent(new CustomEvent("regenta:venta", { detail: { total: Number(j.venta?.total ?? 0), documento: j.documento?.estado ?? null } }));
      if (impresora.auto && j.venta?.venta_id) imprimirTiquete(j.venta.venta_id, impresora.ancho);
    } catch (e) {
      if (!esFallaDeRed(e)) { setError("No se pudo registrar la venta. Vuelve a confirmar (no se duplicará)."); return; }
      setEnLinea(false);
      if (tipoDoc !== "pos" || aCredito) { setError("Sin internet: la factura electrónica necesita conexión. Cobra con tiquete POS y se envía solo al volver internet."); return; }
      // Sin internet: la venta se guarda en esta caja y se envía sola al volver la conexión (misma clave: no se duplica).
      const v: VentaEnCola = {
        idem_key: idem.current, empresa, creado: new Date().toISOString(), cuerpo, total: Math.round(totales.total), cambio: medio === "efectivo" ? cambio : 0,
        lineas: lineas.map((l) => ({ nombre: l.p.nombre, cantidad: l.cantidad, presentacion: l.presentacion, total: netoLinea(l).neto, producto_id: l.p.id, unidades: l.cantidad * (l.presentacion === "caja" ? l.p.unidades_por_caja : 1) })),
      };
      if (!encolar(v)) { setError("Sin internet y este navegador no deja guardar la venta. Anótala y regístrala al volver la conexión."); return; }
      setHecho({ provisional: v, venta: { venta_id: "", prefijo: "", numero: 0, total: v.total, cambio: v.cambio, base: 0, iva: 0 }, documento: { tipo: "pos", estado: "pendiente", cufe: null, simulado: false, ultimo_error: null } });
      setCobrando(false); contar();
      if (impresora.auto) imprimirProvisional(v, nombreEmpresa, impresora.ancho);
    } finally { setEnviando(false); }
  }

  // Atajos: F2 buscar, F9 cobrar, Esc volver, Enter nueva venta tras cobrar.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (e.key === "F2") { e.preventDefault(); buscador.current?.focus(); }
      if (e.key === "F9" && puedeCobrar && !hecho) { e.preventDefault(); setCobrando(true); setTimeout(() => recibidoRef.current?.focus(), 0); }
      if (e.key === "Escape" && cobrando) { setCobrando(false); buscador.current?.focus(); }
      if (e.key === "Enter" && hecho) { e.preventDefault(); nueva(); }
      if (e.key === "F8" && hecho?.provisional) { e.preventDefault(); imprimirProvisional(hecho.provisional, nombreEmpresa, impresora.ancho); }
      else if (e.key === "F8" && hecho?.venta.venta_id) { e.preventDefault(); imprimirTiquete(hecho.venta.venta_id, impresora.ancho); }
    };
    addEventListener("keydown", h);
    return () => removeEventListener("keydown", h);
  }, [puedeCobrar, cobrando, hecho, nueva, impresora.ancho, nombreEmpresa]);

  function teclaBuscador(e: React.KeyboardEvent) {
    if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(s + 1, res.length - 1)); }
    if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(s - 1, 0)); }
    // Lector de código de barras: escribe el código y Enter antes de que termine la búsqueda. Con un código completo se
    // busca ya mismo el producto exacto y se agrega (una caja); la búsqueda queda limpia para el siguiente.
    const t = q.trim();
    if (e.key === "Enter" && /^\d{7,14}$/.test(t)) {
      e.preventDefault();
      const exacto = (l: Producto[]) => l.find((p) => p.ean === t);
      const ya = exacto(res);
      if (ya) { agregar(ya, "caja"); setQ(""); return; }
      (async () => {
        let lista: Producto[] = [];
        try {
          if (navigator.onLine) lista = (await (await fetch(`/api/productos?q=${encodeURIComponent(t)}`)).json()).productos ?? [];
          else lista = buscarLocal(t);
        } catch { lista = buscarLocal(t); }
        const p = exacto(lista);
        if (p) { agregar(p, "caja"); setQ(""); } else if (lista[0]) { setRes(lista); setSel(0); }
      })();
      return;
    }
    if (e.key === "Enter" && res[sel]) { e.preventDefault(); agregar(res[sel], "caja"); }
  }

  return (
    <div className="grid xl:grid-cols-[1fr_440px] gap-5 p-4 sm:p-6 pb-28 xl:pb-6 items-start">
      {/* Buscar y agregar */}
      <section aria-label="Productos" className="min-w-0">
        {(!enLinea || pendientes > 0) && (
          <p role="status" className={`mb-3 rounded-xl px-4 py-3 font-semibold ${enLinea ? "bg-aviso-soft text-aviso" : "bg-ink text-white"}`}>
            {!enLinea ? "Sin internet: sigues vendiendo con tiquete POS. " : "Enviando las ventas hechas sin internet… "}
            {pendientes > 0 && `${pendientes} venta${pendientes === 1 ? "" : "s"} guardada${pendientes === 1 ? "" : "s"} en esta caja, se envía${pendientes === 1 ? "" : "n"} sola${pendientes === 1 ? "" : "s"} al volver la conexión.`}
          </p>
        )}
        {avisoCola && <p role="status" className="mb-3 rounded-xl bg-cruz-soft text-cruz px-4 py-3 font-semibold flex justify-between gap-3">{avisoCola}<button onClick={() => setAvisoCola("")} className="text-sm underline shrink-0">Cerrar</button></p>}
        {fallidas.length > 0 && (
          <div role="alert" className="mb-3 rounded-xl bg-alerta-soft text-alerta px-4 py-3">
            <p className="font-semibold">{fallidas.length} venta{fallidas.length === 1 ? "" : "s"} hecha{fallidas.length === 1 ? "" : "s"} sin internet no se pudo registrar:</p>
            <ul className="mt-1 text-sm grid gap-1">{fallidas.map((v) => <li key={v.idem_key} className="flex flex-wrap justify-between gap-2"><span>{new Date(v.creado).toLocaleString("es-CO")} · {pesos(v.total)} · {v.error}</span><button onClick={() => descartar(v.idem_key)} className="underline">Ya la registré a mano</button></li>)}</ul>
          </div>
        )}
        <div className="relative">
          <label htmlFor="buscar" className="sr-only">Buscar producto o escanear código de barras</label>
          <svg className="absolute left-4 top-1/2 -translate-y-1/2 text-muted" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true"><circle cx="11" cy="11" r="7" /><path d="M20 20l-4-4" /></svg>
          <input id="buscar" ref={buscador} autoFocus value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={teclaBuscador}
            placeholder="Buscar o escanear" autoComplete="off" spellCheck={false}
            className="w-full h-16 rounded-2xl bg-surface border-2 border-line focus:border-ink outline-none pl-13 pr-24 text-xl"
            style={{ paddingLeft: 52 }} />
          <span className="absolute right-4 top-1/2 -translate-y-1/2 text-sm text-muted">{buscando ? "Buscando…" : <kbd className="hidden sm:inline">F2</kbd>}</span>
        </div>

        {res.length > 0 ? (
          <ul className="mt-3 bg-surface rounded-2xl border border-line divide-y divide-line overflow-hidden" role="listbox" aria-label="Resultados">
            {res.map((p, i) => <Fila key={p.id} p={p} activo={i === sel} onHover={() => setSel(i)} agregar={agregar} />)}
          </ul>
        ) : q.trim() && !buscando ? (
          <p className="mt-6 text-muted">No hay productos con «{q.trim()}». Prueba con otra palabra o escanea el código.</p>
        ) : (
          <>
          {vencen.length > 0 && (
            <section className="mt-5" aria-label="Vender primero">
              <h2 className="font-cond text-lg" style={{ fontWeight: 700 }}>Ofrécelos primero <span className="text-muted font-normal text-base" style={{ fontWeight: 400 }}>· tienen lotes que vencen en menos de 60 días</span></h2>
              <ul role="listbox" aria-label="Vender primero" className="mt-2 bg-surface rounded-2xl border border-line divide-y divide-line overflow-hidden">
                {vencen.map((p) => <Fila key={p.id} p={p} activo={false} onHover={() => {}} agregar={agregar} />)}
              </ul>
            </section>
          )}
          <div className="mt-6 hidden sm:grid sm:grid-cols-3 gap-3 text-sm text-muted">
            <p><kbd>F2</kbd> buscar o escanear</p>
            <p><kbd>↑</kbd> <kbd>↓</kbd> elegir · <kbd>Enter</kbd> agregar caja</p>
            <p><kbd>F9</kbd> cobrar · <kbd>Esc</kbd> volver</p>
          </div>
          </>
        )}
      </section>

      {/* La tirilla */}
      <aside id="venta" aria-label="Venta actual" className="tirilla rounded-t-2xl xl:sticky xl:top-6 pb-8 scroll-mt-4">
        {hecho ? (
          <div className="px-6 pt-6">
            {hecho.provisional ? <>
              <p className="text-sm text-aviso font-semibold">Venta guardada sin internet</p>
              <p className="font-cond text-2xl num" style={{ fontWeight: 700 }}>Comprobante provisional</p>
              <p className="mt-2 text-sm text-muted">Se registra y se envía a la DIAN sola en cuanto vuelva internet. No la cobres de nuevo.</p>
            </> : <>
            <p className="text-sm text-muted">{hecho.documento?.tipo === "factura" ? "Factura electrónica registrada" : "Venta registrada"}</p>
            <p className="font-cond text-2xl num" style={{ fontWeight: 700 }}>{hecho.venta.prefijo}{hecho.venta.numero}</p>
            </>}
            <div className="corte my-5" />
            <div className="flex items-baseline justify-between"><span>Total</span><span className="num font-cond text-2xl" style={{ fontWeight: 700 }}>{pesos(hecho.venta.total)}</span></div>
            {hecho.venta.repetida && (
              <p role="alert" className="mt-4 rounded-xl bg-alerta-soft text-alerta px-4 py-3 font-semibold">Esta venta ya se había registrado antes del corte de conexión. Revisa la tirilla: si agregaste productos después, no se cobraron; regístralos en una venta nueva.</p>
            )}
            {hecho.venta.credito && hecho.venta.vence_pago && (
              <p className="mt-4 rounded-xl bg-aviso-soft text-aviso px-4 py-3 font-semibold">A crédito · vence el {fechaCorta(hecho.venta.vence_pago)}. Queda en Cartera para registrar los abonos.</p>
            )}
            {Number(hecho.venta.cambio) > 0 && (
              <div className="mt-4 rounded-xl bg-cruz text-cruz-ink px-5 py-4 flex items-baseline justify-between">
                <span className="text-lg">Cambio</span><span className="num font-cond text-[44px] leading-none" style={{ fontWeight: 700 }}>{pesos(hecho.venta.cambio)}</span>
              </div>
            )}
            {!hecho.provisional && <div className="mt-5 flex items-center gap-2 text-sm">
              <span className={`size-2.5 rounded-full ${hecho.documento?.estado === "aceptado" ? "bg-cruz" : hecho.documento?.estado === "rechazado" ? "bg-alerta" : "bg-aviso"}`} />
              <span>
                {hecho.documento?.estado === "aceptado" ? (hecho.documento.tipo === "factura" ? "Factura electrónica aceptada" : "Tiquete POS electrónico aceptado") : hecho.documento?.estado === "rechazado" ? `DIAN rechazó el documento: ${hecho.documento.ultimo_error}` : "Enviando a la DIAN: la cola lo reintenta sola"}
                {hecho.documento?.simulado && <span className="text-muted"> · emisión simulada (pruebas)</span>}
              </span>
            </div>}
            {hecho.documento?.cufe && <p className="mt-2 text-[11px] text-muted break-all font-cond">CUFE {hecho.documento.cufe}</p>}
            <div className="mt-6 grid grid-cols-[auto_1fr] gap-2">
              <button onClick={() => hecho.provisional ? imprimirProvisional(hecho.provisional, nombreEmpresa, impresora.ancho) : imprimirTiquete(hecho.venta.venta_id, impresora.ancho)} className="h-14 px-4 rounded-xl border border-line font-semibold">Imprimir <kbd className="ml-1">F8</kbd></button>
              <button onClick={nueva} className="h-14 rounded-xl bg-ink text-white text-lg font-semibold">Nueva venta <kbd className="ml-2 !bg-transparent !text-white/70 !border-white/30">Enter</kbd></button>
            </div>
            <details className="mt-3 text-sm text-muted">
              <summary className="cursor-pointer">Impresora de esta caja</summary>
              <div className="mt-2 grid gap-2">
                <label className="flex items-center gap-2"><input type="checkbox" checked={impresora.auto} onChange={(e) => cambiarImpresora({ ...impresora, auto: e.target.checked })} /> Imprimir la tirilla al cobrar</label>
                <label className="flex items-center gap-2">Papel
                  <select className="campo !h-9 !w-auto" value={impresora.ancho} onChange={(e) => cambiarImpresora({ ...impresora, ancho: e.target.value as Impresora["ancho"] })}>
                    <option value="80">80 mm</option><option value="58">58 mm</option>
                  </select>
                </label>
                <p>Para que salga sin el cuadro de impresión, abre la caja con un acceso directo de Chrome que tenga <span className="font-mono">--kiosk-printing</span> y deja la térmica como impresora predeterminada. El cajón monedero se abre con la opción «abrir cajón al imprimir» del controlador de la impresora.</p>
              </div>
            </details>
          </div>
        ) : (
          <>
            <div className="px-6 pt-5 flex items-baseline justify-between">
              <h2 className="font-cond text-xl" style={{ fontWeight: 700 }}>Venta</h2>
              <span className="text-sm text-muted num">{totales.items} artículo{totales.items === 1 ? "" : "s"}</span>
            </div>
            <div className="px-6 pt-3" role="group" aria-label="Documento">
              <div className="grid grid-cols-2 gap-1 rounded-xl bg-paper p-1">
                {([["pos", "Tiquete POS"], ["factura", "Factura electrónica"]] as const).map(([k, t]) => (
                  <button key={k} aria-pressed={tipoDoc === k} onClick={() => { setTipoDoc(k); if (k === "pos") setCredito(false); setError(""); }}
                    className={`h-10 rounded-lg text-sm font-semibold ${tipoDoc === k ? "bg-ink text-white" : "text-muted"}`}>{t}</button>
                ))}
              </div>
            </div>
            {tipoDoc === "factura" && <ClienteFactura cliente={cliente} onCambio={setCliente} />}
            {tipoDoc === "factura" && fiar && (
                  <div className="px-6 pt-3">
                    <p className="text-sm font-semibold mb-2">Forma de pago</p>
                    <div className="grid grid-cols-2 gap-2" role="group" aria-label="Forma de pago">
                      {([[false, "Contado"], [true, "Crédito"]] as const).map(([v, t]) => (
                        <button key={t} aria-pressed={credito === v} onClick={() => setCredito(v)}
                          className={`h-11 rounded-lg border-2 text-sm font-semibold ${credito === v ? "border-ink bg-ink text-white" : "border-line"}`}>{t}</button>
                      ))}
                    </div>
                    {credito && (
                      <div className="mt-3">
                        <p className="text-sm font-semibold mb-2">Plazo</p>
                        <div className="flex flex-wrap gap-2" role="group" aria-label="Plazo de pago">
                          {PLAZOS.map((d) => (
                            <button key={d} aria-pressed={plazo === d} onClick={() => setPlazo(d)}
                              className={`h-9 px-3 rounded-lg border-2 text-sm font-semibold num ${plazo === d ? "border-ink bg-ink text-white" : "border-line"}`}>{d} días</button>
                          ))}
                        </div>
                        <p className="mt-2 text-sm text-muted">{cliente ? `${cliente.nombre} (${documento(cliente)})` : "El cliente"} paga a {plazo} días. Los abonos se registran en Cartera.</p>
                      </div>
                    )}
                  </div>
                )}

            <div className="pb-3" />
            <div className="corte" />
            {lineas.length === 0 ? (
              <p className="px-6 py-10 text-muted text-center">Escanea o busca un producto para empezar.</p>
            ) : (
              <ul className="px-6 py-2 divide-y divide-dashed divide-line max-h-[46vh] overflow-auto">
                {lineas.map((l) => {
                  const precio = l.presentacion === "caja" ? l.p.precio_caja : l.p.precio_unidad ?? 0;
                  const sobra = excede(lineas, l.p);
                  return (
                    <li key={l.key} className="py-3">
                      <div className="flex justify-between gap-3">
                        <p className="leading-snug text-[15px]">{l.p.nombre}</p>
                        <button onClick={() => setLineas((ls) => ls.filter((x) => x.key !== l.key))} aria-label={`Quitar ${l.p.nombre}`} className="text-muted hover:text-alerta shrink-0 -mt-0.5 text-xl leading-none">×</button>
                      </div>
                      <div className="mt-2 flex items-center justify-between gap-3">
                        <div className="flex items-center gap-1">
                          <button aria-label="Uno menos" onClick={() => setLineas((ls) => ls.map((x) => x.key === l.key ? { ...x, cantidad: Math.max(1, x.cantidad - 1) } : x))} className="size-10 sm:size-8 rounded-lg border border-line text-lg leading-none">−</button>
                          <span className="num w-8 text-center font-semibold">{l.cantidad}</span>
                          <button aria-label="Uno más" onClick={() => setLineas((ls) => ls.map((x) => x.key === l.key ? { ...x, cantidad: x.cantidad + 1 } : x))} className="size-10 sm:size-8 rounded-lg border border-line text-lg leading-none">+</button>
                          <span className="ml-2 text-sm text-muted">{l.presentacion === "caja" ? (l.p.unidades_por_caja > 1 ? `caja x${l.p.unidades_por_caja}` : "und") : "unidad"} · {pesos(precio)}</span>
                        </div>
                        <span className="num font-semibold text-right">
                          {l.descuento > 0 && <span className="block text-xs text-muted line-through">{pesos(precio * l.cantidad)}</span>}
                          {pesos(l.descuento > 0 ? Math.round(precio * l.cantidad * (100 - l.descuento) / 100) : precio * l.cantidad)}
                        </span>
                      </div>
                      <label className="mt-1 inline-flex items-center gap-1.5 text-sm text-muted">Desc.
                        <input aria-label={`Descuento de ${l.p.nombre} en porcentaje`} inputMode="decimal" className="num w-14 h-8 rounded-lg border border-line px-2 text-right"
                          value={l.descuento || ""} placeholder="0" onChange={(e) => { const v = Math.min(99, Math.max(0, Number(e.target.value.replace(",", ".").replace(/[^\d.]/g, "")) || 0)); setLineas((ls) => ls.map((x) => x.key === l.key ? { ...x, descuento: v } : x)); }} />%
                      </label>
                      {sobra && <p className="mt-1 text-sm text-alerta">Solo hay {existencias(l.p).toLowerCase()} en existencia</p>}
                    </li>
                  );
                })}
              </ul>
            )}
            <div className="corte" />
            <dl className="px-6 pt-3 text-sm text-muted num grid grid-cols-2 gap-y-1">
              <dt>Base</dt><dd className="text-right">{pesos(totales.base)}</dd>
              <dt>IVA</dt><dd className="text-right">{pesos(totales.iva)}</dd>
              {totales.descuento > 0 && <><dt>Descuento</dt><dd className="text-right">−{pesos(totales.descuento)}</dd></>}
            </dl>
            {lineas.length > 0 && (
              <label className="px-6 pt-1 flex items-center justify-end gap-1.5 text-sm text-muted">Descuento general
                <input id="desc-general" inputMode="decimal" className="num w-14 h-8 rounded-lg border border-line px-2 text-right" value={descGeneral || ""} placeholder="0"
                  onChange={(e) => setDescGeneral(Math.min(99, Math.max(0, Number(e.target.value.replace(",", ".").replace(/[^\d.]/g, "")) || 0)))} />%
              </label>
            )}
            <div className="px-6 pt-2 flex items-baseline justify-between">
              <span className="text-lg">Total</span>
              <span className="num font-cond text-[52px] leading-none tracking-tight" style={{ fontWeight: 700 }}>{pesos(totales.total)}</span>
            </div>

            {cobrando ? (
              <div className="px-6 pt-5">
                {!aCredito && <>
                <p className="text-sm font-semibold mb-2">Medio de pago</p>
                <div className="grid grid-cols-3 gap-2" role="group" aria-label="Medio de pago">
                  {MEDIOS.map((m) => (
                    <button key={m.id} aria-pressed={medio === m.id} onClick={() => setMedio(m.id)}
                      className={`h-11 rounded-lg border-2 text-sm font-semibold ${medio === m.id ? "border-ink bg-ink text-white" : "border-line"}`}>{m.label}</button>
                  ))}
                </div>
                {medio === "efectivo" && (
                  <div className="mt-4">
                    {otro ? (
                      <div className="mb-3 rounded-xl bg-paper p-3 grid grid-cols-[1fr_1fr_auto] gap-2 items-end">
                        <div><label htmlFor="otro-medio" className="text-sm font-semibold">Parte con</label>
                          <select id="otro-medio" className="campo !h-11" value={otro.medio} onChange={(e) => setOtro({ ...otro, medio: e.target.value as Medio })}>
                            {MEDIOS.filter((m) => m.id !== "efectivo").map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
                          </select></div>
                        <div><label htmlFor="otro-valor" className="text-sm font-semibold">Valor</label>
                          <input id="otro-valor" inputMode="numeric" className="campo !h-11 num" value={otro.valor} onChange={(e) => setOtro({ ...otro, valor: e.target.value.replace(/[^\d]/g, "") ? Number(e.target.value.replace(/[^\d]/g, "")).toLocaleString("es-CO") : "" })} /></div>
                        <button type="button" aria-label="Quitar pago mixto" onClick={() => setOtro(null)} className="h-11 px-3 text-muted text-sm">Quitar</button>
                        {otroNum > 0 && <p className="col-span-3 text-sm">Resto en efectivo: <span className="num font-semibold">{pesos(restante)}</span></p>}
                      </div>
                    ) : (
                      <button type="button" onClick={() => setOtro({ medio: "tarjeta", valor: "" })} className="mb-3 text-sm font-semibold text-cruz">+ Pago mixto (parte con otro medio)</button>
                    )}
                    <label htmlFor="recibido" className="text-sm font-semibold">{otroNum > 0 ? "Efectivo recibido" : "Recibido"}</label>
                    <input id="recibido" ref={recibidoRef} inputMode="numeric" value={recibido} onChange={(e) => setRecibido(e.target.value.replace(/[^\d]/g, "") ? Number(e.target.value.replace(/[^\d]/g, "")).toLocaleString("es-CO") : "")}
                      onKeyDown={(e) => { if (e.key === "Enter") confirmar(); }}
                      placeholder={restante.toLocaleString("es-CO")} className="num mt-1 w-full h-14 rounded-xl border-2 border-line focus:border-ink outline-none px-4 text-2xl font-cond" style={{ fontWeight: 700 }} />
                    <div className="mt-2 flex flex-wrap gap-2">
                      {[restante, 20000, 50000, 100000].filter((v, i, a) => v >= restante && a.indexOf(v) === i).map((v) => (
                        <button key={v} onClick={() => setRecibido(v.toLocaleString("es-CO"))} className="num px-3 h-9 rounded-lg border border-line text-sm font-semibold">{v === restante ? "Exacto" : pesos(v)}</button>
                      ))}
                    </div>
                    {recibidoNum >= restante && <p className="mt-3 flex justify-between text-lg"><span>Cambio</span><span className="num font-cond text-2xl" style={{ fontWeight: 700 }}>{pesos(cambio)}</span></p>}
                  </div>
                )}
                </>}
                {error && <p role="alert" className="mt-3 text-alerta text-sm">{error}</p>}
                <button onClick={confirmar} disabled={enviando} className="mt-4 w-full h-14 rounded-xl bg-cruz text-cruz-ink text-lg font-semibold disabled:opacity-60">
                  {enviando ? "Registrando…" : aCredito ? `Facturar a crédito ${pesos(totales.total)}` : tipoDoc === "factura" ? `Facturar ${pesos(totales.total)}` : `Confirmar ${pesos(totales.total)}`}
                </button>
                <button onClick={() => { setCobrando(false); buscador.current?.focus(); }} className="mt-2 w-full h-10 text-muted text-sm">Volver a la venta <kbd>Esc</kbd></button>
              </div>
            ) : (
              <div className="px-6 pt-5">
                {error && <p role="alert" className="mb-3 text-alerta text-sm">{error}</p>}
                <button disabled={!puedeCobrar} onClick={() => { setCobrando(true); setTimeout(() => recibidoRef.current?.focus(), 0); }}
                  className="w-full h-16 rounded-xl bg-cruz text-cruz-ink text-xl font-semibold disabled:opacity-40 flex items-center justify-center gap-3">
                  Cobrar <kbd className="!bg-transparent !text-white/80 !border-white/40">F9</kbd>
                </button>
                <p className="mt-3 text-center text-[13px] text-muted">{faltaCliente && lineas.length > 0 ? "Elige o crea el cliente para facturar" : `${tipoDoc === "factura" ? "Factura electrónica de venta" : "Tiquete POS electrónico"} · el lote que vence antes sale primero`}</p>
              </div>
            )}
          </>
        )}
      </aside>
      {/* En pantallas pequeñas la tirilla queda abajo: barra fija con el total para no perderlo de vista. */}
      {!hecho && lineas.length > 0 && !cobrando && (
        <div className="xl:hidden fixed inset-x-0 bottom-0 z-30 bg-ink text-white px-4 py-3 flex items-center gap-3" style={{ paddingBottom: "max(12px, env(safe-area-inset-bottom))" }}>
          <a href="#venta" className="flex-1 min-w-0">
            <span className="block text-sm text-white/70">{totales.items} artículo{totales.items === 1 ? "" : "s"} · ver venta</span>
            <span className="block num font-cond text-2xl leading-tight" style={{ fontWeight: 700 }}>{pesos(totales.total)}</span>
          </a>
          <button disabled={!puedeCobrar} onClick={() => { setCobrando(true); document.getElementById("venta")?.scrollIntoView({ behavior: "smooth" }); setTimeout(() => recibidoRef.current?.focus(), 350); }}
            className="h-12 px-6 rounded-xl bg-cruz text-cruz-ink font-semibold text-lg disabled:opacity-40">Cobrar</button>
        </div>
      )}
    </div>
  );
}

function Fila({ p, activo, onHover, agregar }: { p: Producto; activo: boolean; onHover: () => void; agregar: (p: Producto, pr: "caja" | "unidad") => void }) {
  const agotado = p.unidades <= 0;
  return (
    <li role="option" aria-selected={activo} onMouseEnter={onHover}
      className={`flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 ${agotado ? "opacity-55" : ""}`}
      style={activo ? { background: "color-mix(in srgb, var(--cruz-soft) 70%, white)" } : undefined}>
      <div className="min-w-0 flex-1 basis-64">
        <p className="font-semibold leading-snug">{p.nombre}</p>
        <p className="text-sm text-muted flex flex-wrap items-center gap-x-2 gap-y-1">
          <span>{p.laboratorio ?? "Genérico"}</span>
          <span aria-hidden>·</span>
          <span className={agotado ? "text-alerta font-semibold" : p.unidades <= p.stock_minimo * Math.max(1, p.unidades_por_caja) ? "text-aviso font-semibold" : ""}>{existencias(p)}</span>
          <Vence fecha={p.proximo_vence} />
          {p.iva > 0 && <span className="text-[12px]">IVA {p.iva} %</span>}
        </p>
      </div>
      {agotado && <Alternativas id={p.id} agregar={agregar} />}
      <div className="flex gap-2">
        <button onClick={() => agregar(p, "caja")} disabled={agotado}
          className="num rounded-xl border-2 border-ink px-3 py-2 text-left leading-tight hover:bg-ink hover:text-white disabled:pointer-events-none disabled:opacity-40 disabled:border-line">
          <span className="block text-[11px] font-semibold uppercase tracking-wide opacity-70">{agotado ? "Agotado" : p.unidades_por_caja > 1 ? `Caja x${p.unidades_por_caja}` : "Und"}</span>
          <span className="block font-cond text-lg" style={{ fontWeight: 700 }}>{pesos(p.precio_caja)}</span>
        </button>
        {p.precio_unidad !== null && p.unidades_por_caja > 1 && (
          <button onClick={() => agregar(p, "unidad")} disabled={agotado}
            className="num rounded-xl border-2 border-line px-3 py-2 text-left leading-tight hover:border-ink disabled:pointer-events-none">
            <span className="block text-[11px] font-semibold uppercase tracking-wide opacity-70">Unidad</span>
            <span className="block font-cond text-lg" style={{ fontWeight: 700 }}>{pesos(p.precio_unidad)}</span>
          </button>
        )}
      </div>
    </li>
  );
}

/** Producto agotado: parecidos con existencias (mismo principio activo y concentración) para no perder la venta. */
function Alternativas({ id, agregar }: { id: string; agregar: (p: Producto, pr: "caja" | "unidad") => void }) {
  const [lista, setLista] = useState<Producto[] | null>(null);
  const [cargando, setCargando] = useState(false);
  async function ver() {
    setCargando(true);
    try { const r = await fetch(`/api/productos/alternativas?id=${id}`); const j = await r.json(); setLista(j.productos ?? []); }
    catch { setLista([]); } finally { setCargando(false); }
  }
  if (!lista) return (
    <button onClick={ver} disabled={cargando} className="basis-full sm:basis-auto order-last sm:order-none text-sm font-semibold text-teal-700 underline underline-offset-2 text-left">
      {cargando ? "Buscando…" : "Ver alternativas con existencias"}
    </button>
  );
  return (
    <div className="basis-full order-last rounded-xl bg-teal-50 border border-teal-200 p-3">
      {lista.length === 0 ? <p className="text-sm text-muted">No hay productos parecidos con existencias.</p> : (
        <>
          <p className="text-sm font-semibold text-teal-900">Parecidos que sí tienes. Confirma principio activo y concentración antes de ofrecerlos.</p>
          <ul className="mt-2 grid gap-1.5">
            {lista.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 text-sm">
                <span className="min-w-0"><span className="font-semibold">{a.nombre}</span> <span className="text-muted">· {a.laboratorio ?? "Genérico"} · {existencias(a)}</span></span>
                <button onClick={() => agregar(a, "caja")} className="shrink-0 rounded-lg border-2 border-ink px-2.5 py-1 font-semibold num hover:bg-ink hover:text-white">+ {pesos(a.precio_caja)}</button>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}
