"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import { MEDIOS_PAGO, calcularLinea, leerNumero, margen, miles, pesosExactos } from "@/lib/compras";
import { CargarFactura, type FacturaCargada, type LineaFactura } from "./CargarFactura";

type Prod = { id: string; nombre: string; laboratorio: string | null; ean: string | null; unidades_por_caja: number; unidades: number; iva: number; precio_caja: number; precio_unidad: number | null };
type Linea = { key: number; p: Prod; lote: string; vence: string; cajas: string; sueltas: string; bonif: string; costo: string; por: "caja" | "unidad"; desc: string; iva: number; precio: string; precioUnd: string;
  factura?: { descripcion: string; por: LineaFactura["por"]; revisar: boolean; claves: string[] } };
export type ProveedorOpcion = { id: string; nombre: string; nit: string | null; plazo_dias: number | null };
type Guardada = { id: string; numero: number; estado: string; total: number; unidades: number; diferencia: number | null; pagada: boolean };

const ent = (s: string) => Number(String(s).replace(/\D/g, "")) || 0;
const milesCampo = (s: string) => (s.replace(/\D/g, "") ? miles(Number(s.replace(/\D/g, ""))) : "");
const sumarDias = (f: string, d: number) => new Date(Date.parse(f + "T12:00:00Z") + d * 864e5).toISOString().slice(0, 10);
// Mientras se escribe un decimal se deja el texto como está (con coma); solo se quitan letras.
const decimal = (s: string) => s.replace(/[^\d.,]/g, "");
const coma = (n: number | null | undefined) => (n === null || n === undefined ? "" : String(n).replace(".", ","));
const POR: Record<string, string> = { codigo: "por código de barras", memoria: "como en tu última factura de este proveedor", nombre: "por nombre: revisa que sea el mismo" };

export function NuevaCompra({ dinero, proveedores: iniciales, hoy }: { dinero: boolean; proveedores: ProveedorOpcion[]; hoy: string }) {
  const [proveedores, setProveedores] = useState(iniciales);
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Prod[]>([]);
  const [lineas, setLineas] = useState<Linea[]>([]);
  const [proveedor, setProveedor] = useState("");
  const [nit, setNit] = useState("");
  const [factura, setFactura] = useState("");
  const [fecha, setFecha] = useState(hoy);
  const [condicion, setCondicion] = useState<"contado" | "credito">("contado");
  const [vence, setVence] = useState("");
  const [papel, setPapel] = useState("");
  const [pagada, setPagada] = useState(false);
  const [medio, setMedio] = useState("transferencia");
  const [desdeCaja, setDesdeCaja] = useState(true);
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const [hecho, setHecho] = useState<Guardada | null>(null);
  const [cufe, setCufe] = useState("");
  const [archivoId, setArchivoId] = useState<string | null>(null);
  const [avisos, setAvisos] = useState<string[]>([]);
  const [porEmparejar, setPorEmparejar] = useState<{ key: number; l: LineaFactura }[]>([]);
  const buscar = useRef<HTMLInputElement>(null);
  const clave = useRef(0);
  const idem = useRef(crypto.randomUUID()); // misma clave si se reintenta tras un corte; nueva tras guardar

  // Con lector de código de barras (PC) el buscador queda listo; en el celular no: abriría el teclado y bajaría la página.
  useEffect(() => { if (window.matchMedia("(pointer: fine)").matches) buscar.current?.focus({ preventScroll: true }); }, []);
  const elegido = useMemo(() => proveedores.find((x) => x.nombre.trim().toLowerCase() === proveedor.trim().toLowerCase()) ?? null, [proveedor, proveedores]);
  // Con el proveedor elegido, su plazo propone la condición y el vencimiento.
  useEffect(() => {
    if (!elegido) return;
    if (elegido.plazo_dias && elegido.plazo_dias > 0) { setCondicion("credito"); setVence(sumarDias(fecha, elegido.plazo_dias)); }
  }, [elegido?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (q.trim().length < 2) { setRes([]); return; }
    const ctl = new AbortController();
    const t = setTimeout(() => fetch(`/api/productos?q=${encodeURIComponent(q)}`, { signal: ctl.signal }).then((r) => r.json()).then((j) => {
      const ps: (Prod & { exacto: boolean })[] = j.productos ?? [];
      if (ps[0]?.exacto) { agregar(ps[0]); return; } // lector de código de barras: entra directo
      setRes(ps.slice(0, 8));
    }).catch(() => {}), 160);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q]); // eslint-disable-line react-hooks/exhaustive-deps

  function agregar(p: Prod) {
    const key = ++clave.current;
    setLineas((ls) => [...ls, { key, p, lote: "", vence: "", cajas: "", sueltas: "", bonif: "", costo: "", por: p.unidades_por_caja > 1 ? "caja" : "unidad", desc: "", iva: Number(p.iva) || 0, precio: "", precioUnd: "" }]);
    setQ(""); setRes([]); setHecho(null);
    setTimeout(() => document.getElementById(`lote-${key}`)?.focus(), 0);
  }
  // Línea de la compra a partir de la línea leída de la factura y el producto del catálogo.
  function desdeFactura(l: LineaFactura, p: Prod): Linea {
    const upc = p.unidades_por_caja, enCaja = l.como === "caja" && upc > 1, q = l.cantidad;
    const cant = Number.isInteger(q) ? { cajas: enCaja ? String(q) : "", sueltas: enCaja ? "" : String(q) } : { cajas: "", sueltas: String(Math.round(q * (enCaja ? upc : 1))) };
    return {
      key: ++clave.current, p, lote: (l.lote ?? "").toUpperCase(), vence: l.vence ?? "",
      ...(l.bonificada ? { cajas: "", sueltas: "", bonif: String(Math.round(q * (enCaja ? upc : 1))) } : { ...cant, bonif: "" }),
      costo: dinero ? (l.bonificada ? "0" : coma(l.precio)) : "", por: enCaja ? "caja" : "unidad", desc: l.descuento_pct ? coma(l.descuento_pct) : "",
      iva: [0, 5, 19].includes(l.iva_pct) ? l.iva_pct : Number(p.iva) || 0, precio: "", precioUnd: "",
      factura: { descripcion: l.descripcion, por: l.por, revisar: l.revisar_como || l.por === "nombre", claves: l.claves },
    };
  }
  function cargarFactura(r: FacturaCargada) {
    const d = r.documento;
    setHecho(null); setError("");
    if (r.proveedor) { setProveedor(r.proveedor.nombre); setNit(""); if (!proveedores.some((x) => x.id === r.proveedor!.id)) setProveedores((ps) => [...ps, r.proveedor!]); }
    else { setProveedor(d.proveedor.nombre); setNit(d.proveedor.nit ?? ""); }
    setFactura(d.numero.toUpperCase());
    setFecha(d.fecha && d.fecha <= hoy ? d.fecha : hoy);
    if (dinero) {
      if (d.vence_pago && d.vence_pago > (d.fecha ?? hoy)) { setCondicion("credito"); setVence(d.vence_pago); }
      setPapel(d.totales.total !== null ? coma(d.totales.total) : "");
    }
    setCufe(d.cufe ?? ""); setArchivoId(r.archivo_id);
    const listas = d.lineas.filter((l) => l.producto).map((l) => desdeFactura(l, l.producto as Prod));
    setLineas(listas);
    setPorEmparejar(d.lineas.filter((l) => !l.producto).map((l) => ({ key: ++clave.current, l })));
    const sinLote = d.lineas.filter((l) => !l.lote).length;
    setAvisos([...r.avisos,
      `Factura ${d.numero} de ${d.proveedor.nombre}: ${r.resumen.lineas} producto${r.resumen.lineas === 1 ? "" : "s"}, ${r.resumen.emparejadas} ya encontrado${r.resumen.emparejadas === 1 ? "" : "s"} en tu catálogo${r.resumen.lineas > r.resumen.emparejadas ? `, ${r.resumen.lineas - r.resumen.emparejadas} por emparejar abajo` : ""}.`,
      ...(sinLote ? [`${sinLote} producto${sinLote === 1 ? "" : "s"} sin lote en la factura: escríbelo desde la caja.`] : []),
      ...(d.origen === "ia" ? ["Leída de la foto con Regenta IA: confirma cantidades, lotes y costos contra el papel."] : [])]);
  }
  function emparejarLinea(key: number, p: Prod) {
    const x = porEmparejar.find((y) => y.key === key);
    if (!x) return;
    setPorEmparejar((xs) => xs.filter((y) => y.key !== key));
    setLineas((ls) => [...ls, desdeFactura({ ...x.l, por: null, revisar_como: x.l.revisar_como || p.unidades_por_caja > 1 }, p)]);
  }
  const cambiar = <K extends keyof Linea>(key: number, k: K, v: Linea[K]) => setLineas((ls) => ls.map((l) => (l.key === key ? { ...l, [k]: v } : l)));
  const pagadas = (l: Linea) => ent(l.cajas) * l.p.unidades_por_caja + ent(l.sueltas);
  const entran = (l: Linea) => pagadas(l) + ent(l.bonif);
  const calc = (l: Linea) => {
    const c = leerNumero(l.costo), d = leerNumero(l.desc) ?? 0;
    if (c === null || d >= 100) return null;
    return calcularLinea(c, l.por === "caja" ? l.p.unidades_por_caja : 1, pagadas(l), d, l.iva);
  };

  const conCosto = dinero ? lineas.filter((l) => leerNumero(l.costo) !== null).length : 0;
  const tot = lineas.reduce((a, l) => { const k = calc(l); if (k) { a.sub += k.bruto; a.des += k.bruto - k.base; a.iva += k.iva; a.total += k.total; } return a; }, { sub: 0, des: 0, iva: 0, total: 0 });
  const r2 = (n: number) => Math.round(n * 100) / 100;
  const total = r2(tot.total), totalPapel = leerNumero(papel), diferencia = totalPapel === null || !conCosto ? null : r2(totalPapel - total);
  const unidadesTotal = lineas.reduce((a, l) => a + entran(l), 0);

  async function guardar() {
    setError("");
    if (!proveedor.trim()) { setError("Elige o escribe el proveedor."); document.getElementById("proveedor")?.focus(); return; }
    if (!factura.trim()) { setError("Escribe el número de la factura del proveedor."); document.getElementById("factura")?.focus(); return; }
    if (porEmparejar.length) { setError(`Faltan ${porEmparejar.length} producto${porEmparejar.length === 1 ? "" : "s"} de la factura por emparejar con tu catálogo (o quítalos si no son mercancía).`); document.getElementById("por-emparejar")?.scrollIntoView({ block: "center" }); return; }
    const mal = lineas.find((l) => !l.lote.trim() || entran(l) <= 0);
    if (mal) { setError(`Falta ${!mal.lote.trim() ? "el lote" : "la cantidad"} de ${mal.p.nombre}.`); document.getElementById(`${!mal.lote.trim() ? "lote" : "sueltas"}-${mal.key}`)?.focus(); return; }
    const vencida = lineas.find((l) => l.vence && l.vence < hoy);
    if (vencida) { setError(`${vencida.p.nombre}: el lote ${vencida.lote.trim()} ya está vencido. La mercancía vencida no se recibe para la venta.`); document.getElementById(`vence-${vencida.key}`)?.focus(); return; }
    if (dinero && conCosto > 0 && conCosto < lineas.length) {
      const sin = lineas.find((l) => leerNumero(l.costo) === null)!;
      setError(`Falta el costo de ${sin.p.nombre}. Pon el costo de todas las líneas, o de ninguna para completarlo después.`); document.getElementById(`costo-${sin.key}`)?.focus(); return;
    }
    if (dinero && condicion === "credito" && !vence) { setError("Pon la fecha en que vence el pago."); document.getElementById("vence-pago")?.focus(); return; }
    setEnviando(true);
    let r: Response;
    try {
      r = await fetch("/api/compras", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({
        idem_key: idem.current, ...(elegido ? { proveedor_id: elegido.id } : { proveedor_nuevo: { nombre: proveedor.trim(), nit: nit.trim() || null } }),
        numero_factura: factura.trim(), fecha_factura: fecha, condicion: dinero ? condicion : "contado", vence_pago: dinero && condicion === "credito" ? vence : null,
        total_papel: dinero && conCosto ? totalPapel : null, cufe_proveedor: cufe || null, archivo_id: archivoId,
        recordar: lineas.flatMap((l) => (l.factura?.claves ?? []).map((k) => ({ clave: k, producto_id: l.p.id, como: ent(l.cajas) > 0 ? "caja" : "unidad" }))),
        lineas: lineas.map((l) => ({ producto_id: l.p.id, lote: l.lote.trim(), vence: l.vence || null, unidades: pagadas(l), bonificadas: ent(l.bonif),
          ...(dinero && leerNumero(l.costo) !== null ? { costo: leerNumero(l.costo), costo_por: l.por, descuento_pct: leerNumero(l.desc) ?? 0, iva_pct: l.iva,
            precio_venta_nuevo: ent(l.precio) || null, precio_unidad_nuevo: ent(l.precioUnd) || null } : {}) })),
        pago: dinero && conCosto && condicion === "contado" && pagada ? { medio, desde_caja: medio === "efectivo" ? desdeCaja : false } : null,
      }) });
    } catch { setEnviando(false); setError("Sin conexión: revisa internet y vuelve a guardar (no se duplicará)."); return; }
    const j = await r.json().catch(() => ({}));
    setEnviando(false);
    if (!r.ok) { setError(j.error ?? "No se pudo guardar la compra"); return; }
    setHecho({ id: j.id, numero: j.numero, estado: j.estado, total: Number(j.total), unidades: unidadesTotal, diferencia: j.diferencia === null || j.diferencia === undefined ? null : Number(j.diferencia), pagada: !!j.pago });
    if (!elegido && j.detalle?.compra) setProveedores((ps) => [...ps, { id: j.detalle.compra.proveedor_id, nombre: j.detalle.compra.proveedor, nit: j.detalle.compra.proveedor_nit, plazo_dias: null }]);
    setLineas([]); setFactura(""); setPapel(""); setNit(""); setPagada(false); setCufe(""); setArchivoId(null); setAvisos([]); setPorEmparejar([]); idem.current = crypto.randomUUID();
    window.scrollTo({ top: 0 });
    buscar.current?.focus();
  }

  const gruposCampo = "grid gap-3 grid-cols-2 sm:grid-cols-4";
  return (
    <div className="grid gap-4 max-w-6xl min-w-0">
      {hecho && (
        <div role="status" className="rounded-xl bg-cruz-soft text-cruz px-4 py-3 grid gap-1">
          <p className="font-semibold">Compra N.º {hecho.numero} guardada: {miles(hecho.unidades)} unidades ya están disponibles para vender.</p>
          <p className="text-sm text-ink">
            {hecho.estado === "por_costear" ? "Quedó por costear: el dueño o el administrador completa los costos y ahí queda la cuenta por pagar."
              : `Total ${pesosExactos(hecho.total)}${hecho.pagada ? " · pagada" : ""}${hecho.diferencia ? ` · diferencia con la factura ${pesosExactos(hecho.diferencia)}` : ""}.`}{" "}
            <a href={`/compras/${hecho.id}`} className="underline font-semibold">Ver la compra</a> · <a href={`/tiquete/recepcion/${hecho.id}`} className="underline font-semibold">Acta de recepción</a>
          </p>
        </div>
      )}

      <CargarFactura alCargar={cargarFactura} />
      {avisos.length > 0 && (
        <ul role="status" className="rounded-xl bg-cruz-soft text-ink px-4 py-3 grid gap-1">
          {avisos.map((a, i) => <li key={i} className={/^(Ojo|Esta factura ya)/.test(a) ? "font-semibold text-alerta" : i === 0 ? "font-semibold" : ""}>{a}</li>)}
        </ul>
      )}

      <section className="tarjeta p-4 sm:p-5 grid gap-3" aria-labelledby="factura-t">
        <h2 id="factura-t" className="titulo text-xl">Factura del proveedor</h2>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)_minmax(0,1fr)]">
          <div className="min-w-0">
            <label htmlFor="proveedor" className="etiqueta">Proveedor</label>
            <input id="proveedor" list="proveedores-lista" value={proveedor} onChange={(e) => setProveedor(e.target.value)} className="campo" placeholder="Elige o escribe uno nuevo" autoComplete="off" />
            <datalist id="proveedores-lista">{proveedores.map((x) => <option key={x.id} value={x.nombre} />)}</datalist>
            {proveedor.trim().length >= 2 && !elegido && <p className="text-sm text-muted mt-1">Proveedor nuevo: se crea al guardar.</p>}
            {elegido && <p className="text-sm text-muted mt-1">{elegido.nit ? `NIT ${elegido.nit}` : "Sin NIT"}{elegido.plazo_dias ? ` · plazo ${elegido.plazo_dias} días` : ""}</p>}
          </div>
          <div><label htmlFor="factura" className="etiqueta">N.º de factura</label><input id="factura" value={factura} onChange={(e) => setFactura(e.target.value.toUpperCase())} className="campo" placeholder="FE-1234" autoComplete="off" /></div>
          <div><label htmlFor="fecha-factura" className="etiqueta">Fecha de la factura</label><input id="fecha-factura" type="date" max={hoy} value={fecha} onChange={(e) => { setFecha(e.target.value); if (elegido?.plazo_dias && condicion === "credito") setVence(sumarDias(e.target.value, elegido.plazo_dias)); }} className="campo" /></div>
          {cufe && <p className="text-sm text-muted sm:col-span-2 lg:col-span-3 break-all">CUFE {cufe}</p>}
          {proveedor.trim().length >= 2 && !elegido && <div><label htmlFor="nit-nuevo" className="etiqueta">NIT del proveedor nuevo (opcional)</label><input id="nit-nuevo" inputMode="numeric" value={nit} onChange={(e) => setNit(e.target.value)} className="campo" placeholder="Sin dígito de verificación" /></div>}
        </div>
        {dinero && (
          <div className="flex flex-wrap items-end gap-3">
            <fieldset className="flex gap-1 rounded-xl border-2 border-line p-1">
              <legend className="sr-only">Condición de pago</legend>
              {(["contado", "credito"] as const).map((k) => (
                <label key={k} className={`px-3.5 h-9 inline-flex items-center rounded-lg text-sm font-semibold cursor-pointer ${condicion === k ? "bg-ink text-white" : "text-muted"}`}>
                  <input type="radio" name="condicion" value={k} checked={condicion === k} onChange={() => { setCondicion(k); if (k === "credito" && !vence) setVence(sumarDias(fecha, elegido?.plazo_dias || 30)); }} className="sr-only" />{k === "contado" ? "De contado" : "A crédito"}
                </label>
              ))}
            </fieldset>
            {condicion === "credito" ? (
              <div><label htmlFor="vence-pago" className="etiqueta">Vence el pago</label><input id="vence-pago" type="date" min={fecha} value={vence} onChange={(e) => setVence(e.target.value)} className="campo w-44" /></div>
            ) : (
              <div className="flex flex-wrap items-center gap-3 h-11">
                <label className="flex items-center gap-2 font-semibold"><input id="ya-pague" type="checkbox" checked={pagada} onChange={(e) => setPagada(e.target.checked)} className="w-4 h-4" />Ya la pagué</label>
                {pagada && <>
                  <label htmlFor="medio-pago" className="sr-only">Medio de pago</label>
                  <select id="medio-pago" value={medio} onChange={(e) => setMedio(e.target.value)} className="campo w-44">{MEDIOS_PAGO.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select>
                  {medio === "efectivo" && <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!desdeCaja} onChange={(e) => setDesdeCaja(!e.target.checked)} className="w-4 h-4" />No sale de la caja</label>}
                </>}
              </div>
            )}
          </div>
        )}
      </section>

      {porEmparejar.length > 0 && (
        <section id="por-emparejar" className="tarjeta p-4 sm:p-5 grid gap-3 border-2 border-aviso" aria-labelledby="emparejar-t">
          <div><h2 id="emparejar-t" className="titulo text-xl">Por emparejar ({porEmparejar.length})</h2>
            <p className="text-muted">Estos productos de la factura no tienen un igual seguro en tu catálogo. Elige cuál es: Regenta lo recuerda para la próxima factura de este proveedor.</p></div>
          {porEmparejar.map(({ key, l }) => <Emparejar key={key} l={l} dinero={dinero} alElegir={(p) => emparejarLinea(key, p)} alQuitar={() => setPorEmparejar((xs) => xs.filter((y) => y.key !== key))} />)}
        </section>
      )}

      <section className="tarjeta p-4 sm:p-5 grid gap-2" aria-labelledby="productos-t">
        <h2 id="productos-t" className="titulo text-xl">Productos recibidos</h2>
        <div className="relative">
          <label htmlFor="buscar-recibir" className="etiqueta">Producto</label>
          <input id="buscar-recibir" ref={buscar} value={q} onChange={(e) => setQ(e.target.value)} className="campo h-12 text-lg" placeholder="Escanea o escribe el nombre" autoComplete="off" />
          {res.length > 0 && (
            <ul aria-label="Resultados" className="absolute z-10 mt-1 w-full tarjeta shadow-lg divide-y divide-line max-h-80 overflow-auto">
              {res.map((p) => <li key={p.id}><button onClick={() => agregar(p)} className="w-full text-left px-4 py-2.5 hover:bg-paper"><span className="font-semibold">{p.nombre}</span><span className="block text-sm text-muted">{p.laboratorio ?? "Genérico"} · hay {p.unidades} und</span></button></li>)}
            </ul>
          )}
          {q.trim().length >= 2 && res.length === 0 && <p className="text-sm text-muted mt-2">¿No aparece? Créalo primero en <a href="/productos/nuevo" className="underline">Productos → Agregar</a>.</p>}
        </div>
      </section>

      {lineas.length === 0 ? (
        <p className="tarjeta p-8 text-center text-muted">Cada producto que escanees aparece aquí para ponerle lote, vencimiento, cantidad{dinero ? ", costo sin IVA, IVA y descuento" : ""}.</p>
      ) : (
        <section className="grid gap-3" aria-label="Líneas de la compra">
          {lineas.map((l) => {
            const k = calc(l), upc = l.p.unidades_por_caja, costoUnd = k && entran(l) ? k.base / entran(l) : null;
            const precioNuevo = ent(l.precio), m = costoUnd !== null ? margen(costoUnd, precioNuevo || l.p.precio_caja, Number(l.p.iva) || 0, upc) : null;
            return (
              <article key={l.key} className="tarjeta p-4 grid gap-3 min-w-0">
                <div className="flex items-start gap-3"><div className="flex-1 min-w-0"><p className="font-semibold">{l.p.nombre}</p><p className="text-sm text-muted">{l.p.laboratorio ?? "Genérico"}{upc > 1 ? ` · caja x ${upc}` : ""}{dinero ? ` · precio actual ${pesosExactos(l.p.precio_caja)}${upc > 1 ? " la caja" : ""}` : ""}</p>
                  {l.factura && <p className="text-sm text-muted mt-0.5">En la factura: «{l.factura.descripcion}»{l.factura.por ? ` · encontrado ${POR[l.factura.por]}` : " · elegido por ti"}</p>}
                  {l.factura?.revisar && upc > 1 && <p className="text-sm font-semibold text-aviso mt-0.5">Revisa si la factura trae cajas (x {upc}) o unidades sueltas.</p>}</div>
                  <button onClick={() => setLineas((ls) => ls.filter((x) => x.key !== l.key))} className="text-sm text-alerta underline" aria-label={`Quitar ${l.p.nombre}`}>Quitar</button></div>
                <div className={gruposCampo}>
                  <div><label htmlFor={`lote-${l.key}`} className="etiqueta">Lote</label><input id={`lote-${l.key}`} value={l.lote} onChange={(e) => cambiar(l.key, "lote", e.target.value.toUpperCase())} className="campo" /></div>
                  <div><label htmlFor={`vence-${l.key}`} className="etiqueta">Vence</label><input id={`vence-${l.key}`} type="date" value={l.vence} onChange={(e) => cambiar(l.key, "vence", e.target.value)} className="campo" /></div>
                  {upc > 1 && <div><label htmlFor={`cajas-${l.key}`} className="etiqueta">Cajas</label><input id={`cajas-${l.key}`} inputMode="numeric" value={l.cajas} onChange={(e) => cambiar(l.key, "cajas", e.target.value.replace(/\D/g, ""))} className="campo num" /></div>}
                  <div><label htmlFor={`sueltas-${l.key}`} className="etiqueta">{upc > 1 ? "Unidades sueltas" : "Unidades"}</label><input id={`sueltas-${l.key}`} inputMode="numeric" value={l.sueltas} onChange={(e) => cambiar(l.key, "sueltas", e.target.value.replace(/\D/g, ""))} className="campo num" /></div>
                  <div><label htmlFor={`bonif-${l.key}`} className="etiqueta">Bonificadas (und)</label><input id={`bonif-${l.key}`} inputMode="numeric" value={l.bonif} onChange={(e) => cambiar(l.key, "bonif", e.target.value.replace(/\D/g, ""))} className="campo num" placeholder="0" /></div>
                  {dinero && <>
                    <div className="col-span-2 sm:col-span-1"><label htmlFor={`costo-${l.key}`} className="etiqueta">Costo sin IVA</label>
                      <div className="flex gap-1.5"><input id={`costo-${l.key}`} inputMode="decimal" value={l.costo} onChange={(e) => cambiar(l.key, "costo", decimal(e.target.value))} className="campo num min-w-0" placeholder="$" />
                        {upc > 1 && <><label htmlFor={`costo-por-${l.key}`} className="sr-only">El costo es</label><select id={`costo-por-${l.key}`} value={l.por} onChange={(e) => cambiar(l.key, "por", e.target.value as Linea["por"])} className="campo w-[104px] px-2 shrink-0"><option value="caja">por caja</option><option value="unidad">por und</option></select></>}</div></div>
                    <div><label htmlFor={`desc-${l.key}`} className="etiqueta">Descuento %</label><input id={`desc-${l.key}`} inputMode="decimal" value={l.desc} onChange={(e) => cambiar(l.key, "desc", decimal(e.target.value))} className="campo num" placeholder="0" /></div>
                    <div><label htmlFor={`iva-${l.key}`} className="etiqueta">IVA de la compra</label><select id={`iva-${l.key}`} value={l.iva} onChange={(e) => cambiar(l.key, "iva", Number(e.target.value))} className="campo">{[0, 5, 19].map((x) => <option key={x} value={x}>{x} %</option>)}</select></div>
                    <div><label htmlFor={`precio-${l.key}`} className="etiqueta">Precio venta nuevo{upc > 1 ? " (caja)" : ""}</label><input id={`precio-${l.key}`} inputMode="numeric" value={milesCampo(l.precio)} onChange={(e) => cambiar(l.key, "precio", e.target.value)} className="campo num" placeholder="Opcional" /></div>
                    {upc > 1 && l.p.precio_unidad !== null && <div><label htmlFor={`precio-und-${l.key}`} className="etiqueta">Precio venta nuevo (und)</label><input id={`precio-und-${l.key}`} inputMode="numeric" value={milesCampo(l.precioUnd)} onChange={(e) => cambiar(l.key, "precioUnd", e.target.value)} className="campo num" placeholder="Opcional" /></div>}
                  </>}
                </div>
                <p className="text-sm text-muted num">Entran {miles(entran(l))} unidades{ent(l.bonif) ? ` (${ent(l.bonif)} bonificadas)` : ""}
                  {k && <> · base {pesosExactos(k.base)}{k.iva ? ` + IVA ${pesosExactos(k.iva)}` : ""} = <b className="text-ink">{pesosExactos(k.total)}</b>{costoUnd !== null ? ` · costo por unidad ${pesosExactos(Math.round(costoUnd * 100) / 100)}` : ""}
                    {m !== null && <span className={m < 10 ? "text-alerta font-semibold" : m < 20 ? "text-aviso font-semibold" : "text-cruz font-semibold"}> · margen {String(m).replace(".", ",")} %{precioNuevo ? " con el precio nuevo" : " con el precio actual"}</span>}</>}
                  {l.vence && l.vence < hoy ? <span className="text-alerta font-semibold"> · ya está vencido: no se puede recibir</span> : l.vence && l.vence < sumarDias(hoy, 90) ? <span className="text-aviso font-semibold"> · vence en menos de 90 días</span> : null}</p>
              </article>
            );
          })}
          {dinero && conCosto > 0 && (
            <section className="tarjeta p-4 grid gap-3 sm:grid-cols-[minmax(0,1fr)_260px] sm:items-end" aria-label="Cuadre con la factura">
              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-x-4 gap-y-1 num">
                <div><dt className="text-sm text-muted">Subtotal</dt><dd className="font-semibold">{pesosExactos(r2(tot.sub))}</dd></div>
                <div><dt className="text-sm text-muted">Descuento</dt><dd className="font-semibold">{pesosExactos(r2(tot.des))}</dd></div>
                <div><dt className="text-sm text-muted">IVA</dt><dd className="font-semibold">{pesosExactos(r2(tot.iva))}</dd></div>
                <div><dt className="text-sm text-muted">Total calculado</dt><dd className="font-semibold text-lg" data-total={total}>{pesosExactos(total)}</dd></div>
              </dl>
              <div><label htmlFor="total-papel" className="etiqueta">Total de la factura (papel)</label><input id="total-papel" inputMode="decimal" value={papel} onChange={(e) => setPapel(decimal(e.target.value))} className="campo num" placeholder="Para cuadrar" /></div>
              {diferencia !== null && (
                <p role="note" className={`sm:col-span-2 rounded-xl px-4 py-2.5 font-semibold ${diferencia === 0 ? "bg-cruz-soft text-cruz" : "bg-aviso-soft text-aviso"}`}>
                  {diferencia === 0 ? "Cuadra con la factura." : `Diferencia con la factura: ${pesosExactos(diferencia)}. Revisa costos, descuentos, IVA y bonificadas antes de guardar.`}
                </p>
              )}
            </section>
          )}
          {error && <p role="alert" className="text-alerta font-semibold">{error}</p>}
          <div className="tarjeta p-4 flex flex-wrap items-center gap-3 sticky bottom-3">
            <p className="flex-1 min-w-0 font-semibold num">{lineas.length} producto{lineas.length === 1 ? "" : "s"} · {miles(unidadesTotal)} unidades{dinero && conCosto === lineas.length ? ` · ${pesosExactos(total)}` : ""}</p>
            <button onClick={guardar} disabled={enviando} className="btn-primario">{enviando ? "Guardando…" : diferencia ? "Guardar con diferencia" : "Guardar compra"}</button>
          </div>
          {dinero && conCosto === 0 && <p className="text-sm text-muted">Sin costos la compra queda «por costear»: entra al inventario y completas los costos después en la compra.</p>}
        </section>
      )}
    </div>
  );
}

/** Una línea de la factura sin producto seguro: candidatos parecidos, buscador del catálogo u omitir. */
function Emparejar({ l, dinero, alElegir, alQuitar }: { l: LineaFactura; dinero: boolean; alElegir: (p: Prod) => void; alQuitar: () => void }) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Prod[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) { setRes([]); return; }
    const ctl = new AbortController();
    const t = setTimeout(() => fetch(`/api/productos?q=${encodeURIComponent(q)}`, { signal: ctl.signal }).then((r) => r.json()).then((j) => setRes((j.productos ?? []).slice(0, 6))).catch(() => {}), 160);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q]);
  const id = `emp-${l.n}`;
  return (
    <article className="rounded-xl border border-line p-3 grid gap-2 min-w-0">
      <div className="flex items-start gap-3"><div className="flex-1 min-w-0">
        <p className="font-semibold">«{l.descripcion}»</p>
        <p className="text-sm text-muted num">{miles(l.cantidad)} {l.como === "caja" ? "en la factura" : "und"}{l.lote ? ` · lote ${l.lote}` : ""}{l.vence ? ` · vence ${l.vence}` : ""}{dinero && l.precio !== null ? ` · ${pesosExactos(l.precio)} c/u` : ""}</p>
      </div><button type="button" onClick={alQuitar} className="text-sm text-alerta underline">Quitar</button></div>
      {l.candidatos.length > 0 && <div className="flex flex-wrap gap-2">{l.candidatos.map((p) => (
        <button type="button" key={p.id} onClick={() => alElegir(p)} className="pastilla bg-surface border border-line hover:border-cruz text-left">Es {p.nombre}{p.laboratorio ? ` · ${p.laboratorio}` : ""}</button>))}</div>}
      <div className="relative">
        <label htmlFor={id} className="sr-only">Buscar el producto en tu catálogo</label>
        <input id={id} value={q} onChange={(e) => setQ(e.target.value)} className="campo" placeholder="Busca el producto en tu catálogo" autoComplete="off" />
        {res.length > 0 && <ul className="absolute z-10 mt-1 w-full tarjeta shadow-lg divide-y divide-line max-h-72 overflow-auto">{res.map((p) => (
          <li key={p.id}><button type="button" onClick={() => alElegir(p)} className="w-full text-left px-4 py-2.5 hover:bg-paper"><span className="font-semibold">{p.nombre}</span><span className="block text-sm text-muted">{p.laboratorio ?? "Genérico"} · hay {p.unidades} und</span></button></li>))}</ul>}
        {q.trim().length >= 2 && res.length === 0 && <p className="text-sm text-muted mt-1">¿No existe? Créalo en <a href="/productos/nuevo" target="_blank" rel="noopener" className="underline">Productos → Agregar</a> y búscalo aquí.</p>}
      </div>
    </article>
  );
}
