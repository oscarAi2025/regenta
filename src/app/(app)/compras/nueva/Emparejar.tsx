"use client";
import { useEffect, useState } from "react";
import { miles, pesosExactos } from "@/lib/compras";
import { MARGEN_SUGERIDO, margenDe, nombreDeFactura, preciosSugeridos, unidadesEnDescripcion } from "@/lib/producto-desde-factura";
import type { LineaFactura, ProductoFactura } from "./CargarFactura";

// Una línea de la factura sin producto seguro en el catálogo. Tres salidas, sin salir de la compra:
//  · es uno de mis productos → candidatos parecidos o buscador;
//  · es nuevo → se crea aquí mismo con lo que trae la factura (nombre, código de barras, unidades por caja, IVA) y un
//    precio de venta sugerido que la persona revisa; queda agregado a la compra y recordado para ese proveedor;
//  · no es mercancía → quitar.

export type Nuevo = {
  nombre: string; laboratorio: string; ean: string; upc: string; iva: number; precio_caja: string; precio_unidad: string;
  como: "caja" | "unidad"; maestro_id: string | null; del_maestro: boolean;
};

/** Formulario de producto nuevo armado desde la línea de la factura. */
export function nuevoDesdeLinea(l: LineaFactura): Nuevo {
  const upc = unidadesEnDescripcion(l.descripcion), como = upc > 1 ? "caja" : "unidad";
  const p = preciosSugeridos({ costo: l.precio, descuentoPct: l.descuento_pct, como, upc, ivaPct: l.iva_pct });
  return {
    nombre: nombreDeFactura(l.nombre), laboratorio: "", ean: l.ean ?? "", upc: String(upc), iva: [0, 5, 19].includes(l.iva_pct) ? l.iva_pct : 0,
    precio_caja: p.precio_caja ? String(p.precio_caja) : "", precio_unidad: p.precio_unidad ? String(p.precio_unidad) : "", como, maestro_id: null, del_maestro: false,
  };
}

const solo = (s: string) => s.replace(/\D/g, "");
const fmt = (s: string) => (solo(s) ? miles(Number(solo(s))) : "");

/** Crea el producto en el catálogo; devuelve el producto listo para la compra o el error en palabras. */
export async function crearProducto(f: Nuevo): Promise<{ p: ProductoFactura } | { error: string }> {
  const upc = Math.max(1, Number(solo(f.upc)) || 1), caja = Number(solo(f.precio_caja)), und = upc > 1 ? Number(solo(f.precio_unidad)) || null : null;
  if (f.nombre.trim().length < 3) return { error: "Escribe el nombre del producto" };
  if (!caja) return { error: "Pon el precio de venta" };
  if (und && und > caja) return { error: "El precio por unidad no puede ser mayor que el de la caja" };
  if (f.ean && !/^\d{8,14}$/.test(f.ean)) return { error: "El código de barras debe tener de 8 a 14 dígitos" };
  const cuerpo = { maestro_id: f.maestro_id, nombre: f.nombre.trim(), laboratorio: f.laboratorio.trim() || null, ean: f.ean || "", iva: f.iva, unidades_por_caja: upc, precio_caja: caja, precio_unidad: und, stock_minimo: 0 };
  let r: Response;
  try { r = await fetch("/api/productos", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) }); }
  catch { return { error: "Sin conexión: no se creó. Vuelve a intentarlo." }; }
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.id) return { error: j.error ?? "No se pudo crear el producto" };
  return { p: { id: j.id, nombre: cuerpo.nombre, laboratorio: cuerpo.laboratorio, ean: f.ean || null, unidades_por_caja: upc, unidades: 0, iva: f.iva, precio_caja: caja, precio_unidad: und } };
}

type Props = {
  l: LineaFactura; dinero: boolean; nuevo: Nuevo | null; error: string; creando: boolean;
  alElegir: (p: ProductoFactura) => void; alQuitar: () => void; alAbrirNuevo: () => void; alCambiarNuevo: (n: Partial<Nuevo> | null) => void; alCrear: () => void;
};

export function Emparejar({ l, dinero, nuevo, error, creando, alElegir, alQuitar, alAbrirNuevo, alCambiarNuevo, alCrear }: Props) {
  const [q, setQ] = useState("");
  const [res, setRes] = useState<ProductoFactura[]>([]);
  useEffect(() => {
    if (q.trim().length < 2) { setRes([]); return; }
    const ctl = new AbortController();
    const t = setTimeout(() => fetch(`/api/productos?q=${encodeURIComponent(q)}`, { signal: ctl.signal }).then((r) => r.json()).then((j) => setRes((j.productos ?? []).slice(0, 6))).catch(() => {}), 160);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q]);
  const id = `emp-${l.n}`;
  const upc = nuevo ? Math.max(1, Number(solo(nuevo.upc)) || 1) : 1;
  const costoCaja = l.precio ? l.precio * (1 - l.descuento_pct / 100) * (nuevo?.como === "unidad" ? upc : 1) : null;
  const mg = nuevo && costoCaja && solo(nuevo.precio_caja) ? margenDe(Number(solo(nuevo.precio_caja)), costoCaja, nuevo.iva) : null;
  const cambiarUpc = (v: string) => {
    if (!nuevo) return;
    const n = Math.max(1, Number(solo(v)) || 1), como = n > 1 ? nuevo.como : "unidad";
    const p = preciosSugeridos({ costo: l.precio, descuentoPct: l.descuento_pct, como, upc: n, ivaPct: nuevo.iva });
    alCambiarNuevo({ upc: solo(v), como, precio_caja: p.precio_caja ? String(p.precio_caja) : nuevo.precio_caja, precio_unidad: p.precio_unidad ? String(p.precio_unidad) : "" });
  };

  return (
    <article className="rounded-xl border border-line p-3 sm:p-4 grid gap-3 min-w-0" aria-label={`Producto de la factura: ${l.descripcion}`}>
      <div className="flex items-start gap-3">
        <div className="flex-1 min-w-0">
          <p className="font-semibold break-words">«{l.descripcion}»</p>
          <p className="text-sm text-muted num">{miles(l.cantidad)} en la factura{l.lote ? ` · lote ${l.lote}` : ""}{l.vence ? ` · vence ${l.vence}` : ""}{dinero && l.precio !== null ? ` · ${pesosExactos(l.precio)} c/u sin IVA` : ""}</p>
        </div>
        <button type="button" onClick={alQuitar} className="text-sm text-alerta underline shrink-0">Quitar</button>
      </div>

      {!nuevo && <>
        {l.candidatos.length > 0 && (
          <div className="grid gap-1.5">
            <p className="text-sm font-semibold">¿Es uno de estos?</p>
            <div className="flex flex-wrap gap-2">{l.candidatos.map((p) => (
              <button type="button" key={p.id} onClick={() => alElegir(p)} className="pastilla bg-surface border border-line hover:border-cruz text-left">{p.nombre}{p.laboratorio ? ` · ${p.laboratorio}` : ""}</button>))}</div>
          </div>
        )}
        <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start">
          <div className="relative">
            <label htmlFor={id} className="sr-only">Buscar el producto en tu catálogo</label>
            <input id={id} value={q} onChange={(e) => setQ(e.target.value)} className="campo" placeholder="Busca el producto en tu catálogo" autoComplete="off" />
            {res.length > 0 && <ul className="absolute z-10 mt-1 w-full tarjeta shadow-lg divide-y divide-line max-h-72 overflow-auto">{res.map((p) => (
              <li key={p.id}><button type="button" onClick={() => alElegir(p)} className="w-full text-left px-4 py-2.5 hover:bg-paper"><span className="font-semibold">{p.nombre}</span><span className="block text-sm text-muted">{p.laboratorio ?? "Genérico"} · hay {p.unidades} und</span></button></li>))}</ul>}
          </div>
          {dinero
            ? <button type="button" onClick={alAbrirNuevo} className="btn-borde">Es nuevo: crearlo</button>
            : <p className="text-sm text-muted sm:max-w-56">¿Es nuevo? El dueño o el administrador lo crea desde aquí mismo.</p>}
        </div>
      </>}

      {nuevo && (
        <fieldset className="grid gap-3 rounded-xl bg-paper p-3 sm:p-4 min-w-0" disabled={creando}>
          <legend className="sr-only">Producto nuevo</legend>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-semibold">Producto nuevo{nuevo.del_maestro ? <span className="font-normal text-muted"> · datos del catálogo de Regenta</span> : <span className="font-normal text-muted"> · con los datos de la factura</span>}</p>
            <button type="button" onClick={() => alCambiarNuevo(null)} className="text-sm underline">No, buscarlo en mi catálogo</button>
          </div>
          <div className="grid gap-3 grid-cols-2 lg:grid-cols-4">
            <div className="col-span-2"><label htmlFor={`${id}-n`} className="etiqueta">Nombre</label>
              <input id={`${id}-n`} value={nuevo.nombre} onChange={(e) => alCambiarNuevo({ nombre: e.target.value })} className="campo" maxLength={200} /></div>
            <div className="col-span-2 sm:col-span-1"><label htmlFor={`${id}-l`} className="etiqueta">Laboratorio <span className="font-normal text-muted">(opcional)</span></label>
              <input id={`${id}-l`} value={nuevo.laboratorio} onChange={(e) => alCambiarNuevo({ laboratorio: e.target.value })} className="campo" maxLength={120} /></div>
            <div className="col-span-2 sm:col-span-1"><label htmlFor={`${id}-e`} className="etiqueta">Código de barras</label>
              <input id={`${id}-e`} value={nuevo.ean} onChange={(e) => alCambiarNuevo({ ean: solo(e.target.value).slice(0, 14) })} className="campo num" inputMode="numeric" placeholder="Opcional" /></div>
            <div className="min-w-0 self-end"><label htmlFor={`${id}-u`} className="etiqueta">Unidades por caja</label>
              <input id={`${id}-u`} value={nuevo.upc} onChange={(e) => cambiarUpc(e.target.value)} className="campo num" inputMode="numeric" /></div>
            <div className="min-w-0 self-end"><label htmlFor={`${id}-i`} className="etiqueta">IVA de venta</label>
              <select id={`${id}-i`} value={nuevo.iva} onChange={(e) => alCambiarNuevo({ iva: Number(e.target.value) })} className="campo">
                <option value={0}>0 %</option><option value={5}>5 %</option><option value={19}>19 %</option>
              </select></div>
            {upc > 1 && (
              <div className="col-span-2 sm:col-span-1 min-w-0"><label htmlFor={`${id}-c`} className="etiqueta">La factura trae</label>
                <select id={`${id}-c`} value={nuevo.como} onChange={(e) => { const como = e.target.value as Nuevo["como"]; const p = preciosSugeridos({ costo: l.precio, descuentoPct: l.descuento_pct, como, upc, ivaPct: nuevo.iva }); alCambiarNuevo({ como, precio_caja: p.precio_caja ? String(p.precio_caja) : nuevo.precio_caja, precio_unidad: p.precio_unidad ? String(p.precio_unidad) : nuevo.precio_unidad }); }} className="campo">
                  <option value="caja">{miles(l.cantidad)} cajas</option>
                  <option value="unidad">{miles(l.cantidad)} sueltas</option>
                </select></div>
            )}
            <div className="min-w-0"><label htmlFor={`${id}-p`} className="etiqueta">{upc > 1 ? "Precio caja" : "Precio de venta"} con IVA</label>
              <input id={`${id}-p`} value={fmt(nuevo.precio_caja)} onChange={(e) => alCambiarNuevo({ precio_caja: solo(e.target.value) })} className="campo num" inputMode="numeric" />
              {mg !== null && <p className={`text-sm mt-1 ${mg < 10 ? "text-alerta font-semibold" : "text-muted"}`}>Margen {String(mg).replace(".", ",")} % sobre el costo de esta factura{mg < 10 ? ": muy bajo" : ""}</p>}
              {!l.precio && <p className="text-sm text-muted mt-1">La factura no trae costo: pon el precio a mano.</p>}</div>
            {upc > 1 && (
              <div className="min-w-0"><label htmlFor={`${id}-pu`} className="etiqueta">Precio suelta <span className="font-normal text-muted">(opcional)</span></label>
                <input id={`${id}-pu`} value={fmt(nuevo.precio_unidad)} onChange={(e) => alCambiarNuevo({ precio_unidad: solo(e.target.value) })} className="campo num" inputMode="numeric" /></div>
            )}
          </div>
          {l.precio ? <p className="text-sm text-muted">Precio sugerido con un margen del {MARGEN_SUGERIDO} % sobre el costo de esta factura, redondeado. Cámbialo si quieres.</p> : null}
          {error && <p role="alert" className="rounded-lg bg-alerta-soft text-alerta px-3 py-2 font-semibold">{error}</p>}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={alCrear} className="btn-primario">{creando ? "Creando…" : "Crear y agregar"}</button>
          </div>
        </fieldset>
      )}
    </article>
  );
}
