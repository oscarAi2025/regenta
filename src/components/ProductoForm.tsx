"use client";
import { useEffect, useState } from "react";

type Datos = { maestro_id?: string | null; nombre: string; laboratorio: string; ean: string; iva: 0 | 5 | 19; categoria?: string | null; unidades_por_caja: number; precio_caja: string; precio_unidad: string; stock_minimo: number; registro_sanitario?: string; requiere_formula?: boolean; control_especial?: boolean };
type Maestro = { id: string; nombre: string; laboratorio: string | null; ean: string | null; iva: number; categoria: string | null };

const vacio: Datos = { nombre: "", laboratorio: "", ean: "", iva: 0, unidades_por_caja: 1, precio_caja: "", precio_unidad: "", stock_minimo: 0, requiere_formula: false, control_especial: false };
// Pesos sin centavos: «2.500», «2500» y «1,500» son miles; una coma con 1 o 2 cifras al final son centavos y se descartan
// («2500,50» → 2.500), en vez de pegarlos al número.
const sinCentavos = (s: string) => String(s).replace(/,\d{1,2}$/, "");
const num = (s: string) => Number(sinCentavos(s).replace(/\D/g, "")) || 0;
const fmt = (s: string) => (sinCentavos(s).replace(/\D/g, "") ? Number(sinCentavos(s).replace(/\D/g, "")).toLocaleString("es-CO") : "");

/** Alta y edición de productos. En el alta se busca primero en el catálogo Regenta para no escribir nada a mano. */
export function ProductoForm({ id, inicial }: { id?: string; inicial?: Datos }) {
  const [d, setD] = useState<Datos>(inicial ?? vacio);
  const [modo, setModo] = useState<"catalogo" | "manual">(id ? "manual" : "catalogo");
  const [q, setQ] = useState("");
  const [res, setRes] = useState<Maestro[]>([]);
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const set = <K extends keyof Datos>(k: K, v: Datos[K]) => setD((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    if (modo !== "catalogo" || q.trim().length < 2) { setRes([]); return; }
    const ctl = new AbortController();
    const t = setTimeout(() => fetch(`/api/maestro?q=${encodeURIComponent(q)}`, { signal: ctl.signal }).then((r) => { if (r.status === 401) location.href = "/entrar"; return r.json(); }).then((j) => setRes(j.productos ?? [])).catch(() => {}), 160);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q, modo]);

  function elegir(m: Maestro) {
    // Sólidos orales: «caja x 30», «cjx 30 tab», «x 30 unds», «x30 tabletas».
    const porCaja = /tableta|\btabs?\b|capsula|cápsula|\bcaps?\b|comprimido|gragea/i.test(m.nombre)
      ? /(?:caja|cja?|frasco|blister)\s*x\s*(\d{1,3})\b|x\s*(\d{2,3})\s*(?:unds?|tabs?|tabletas|caps?|c[aá]psulas|comprimidos)\b/i.exec(m.nombre) : null;
    setD({ ...vacio, maestro_id: m.id, nombre: m.nombre, laboratorio: m.laboratorio ?? "", ean: m.ean ?? "", iva: (m.iva === 5 || m.iva === 19 ? m.iva : 0) as 0 | 5 | 19, categoria: m.categoria, unidades_por_caja: porCaja ? Number(porCaja[1] ?? porCaja[2]) : 1 });
    setModo("manual"); setRes([]);
    setTimeout(() => document.getElementById("precio_caja")?.focus(), 0);
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    setEnviando(true); setError("");
    const cuerpo = { maestro_id: d.maestro_id ?? null, nombre: d.nombre, laboratorio: d.laboratorio || null, ean: d.ean || "", iva: d.iva, categoria: d.categoria ?? null,
      unidades_por_caja: d.unidades_por_caja, precio_caja: num(d.precio_caja), precio_unidad: d.unidades_por_caja > 1 && num(d.precio_unidad) ? num(d.precio_unidad) : null, stock_minimo: d.stock_minimo, registro_sanitario: d.registro_sanitario || null,
      requiere_formula: !!(d.requiere_formula || d.control_especial), control_especial: !!d.control_especial };
    const r = await fetch(id ? `/api/productos/${id}` : "/api/productos", { method: id ? "PATCH" : "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) }).catch(() => null);
    if (!r) { setError("Sin conexión: revisa internet e intenta de nuevo."); setEnviando(false); return; }
    if (r.ok) { location.href = id ? "/productos" : "/productos?q=" + encodeURIComponent(d.ean || d.nombre); return; }
    setError((await r.json().catch(() => ({}))).error ?? "No se pudo guardar"); setEnviando(false);
  }

  const [confirmar, setConfirmar] = useState(false);
  async function retirar() {
    if (!id) return;
    if (!confirmar) { setConfirmar(true); return; }
    const r = await fetch(`/api/productos/${id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ activo: false }) }).catch(() => null);
    if (!r) { setError("Sin conexión: revisa internet e intenta de nuevo."); return; }
    if (r.ok) location.href = "/productos"; else setError((await r.json().catch(() => ({}))).error ?? "No se pudo retirar");
  }

  const unitario = d.unidades_por_caja > 1 && num(d.precio_caja) ? Math.ceil(num(d.precio_caja) / d.unidades_por_caja / 50) * 50 : 0;

  return (
    <div className="grid gap-5 max-w-3xl">
      {!id && (
        <div className="flex gap-1 tarjeta p-1 w-fit" role="tablist">
          <button role="tab" aria-selected={modo === "catalogo"} onClick={() => setModo("catalogo")} className={`px-4 py-2 rounded-xl text-sm font-semibold ${modo === "catalogo" ? "bg-ink text-white" : "text-muted"}`}>Del catálogo Regenta</button>
          <button role="tab" aria-selected={modo === "manual"} onClick={() => setModo("manual")} className={`px-4 py-2 rounded-xl text-sm font-semibold ${modo === "manual" ? "bg-ink text-white" : "text-muted"}`}>Producto nuevo</button>
        </div>
      )}

      {modo === "catalogo" ? (
        <section className="tarjeta p-5">
          <label htmlFor="buscar-maestro" className="etiqueta">Busca en el catálogo de casi 10.000 productos o escanea el código</label>
          <input id="buscar-maestro" autoFocus value={q} onChange={(e) => setQ(e.target.value)} className="campo h-14 text-lg" placeholder="Ej.: losartan 50, dolex, 7702..." />
          <ul className="mt-3 divide-y divide-line">
            {res.map((m) => (
              <li key={m.id} className="flex items-center gap-3 py-2.5">
                <div className="flex-1 min-w-0"><p className="font-semibold leading-snug">{m.nombre}</p><p className="text-sm text-muted">{m.laboratorio ?? "Sin laboratorio"}{m.ean ? ` · ${m.ean}` : ""}{m.iva ? ` · IVA ${m.iva} %` : ""}</p></div>
                <button onClick={() => elegir(m)} className="btn-borde h-9 px-4 text-sm">Agregar</button>
              </li>
            ))}
            {q.trim().length >= 2 && res.length === 0 && <li className="py-4 text-muted">No está en el catálogo (o ya lo tienes). <button className="underline" onClick={() => { setModo("manual"); set("nombre", q); }}>Créalo como producto nuevo</button>.</li>}
          </ul>
        </section>
      ) : (
        <form onSubmit={guardar} className="tarjeta p-5 grid sm:grid-cols-2 gap-4">
          {d.maestro_id && !id && <p className="sm:col-span-2 text-sm bg-cruz-soft text-cruz rounded-lg px-3 py-2 font-semibold">Datos traídos del catálogo Regenta: solo pon tu precio.</p>}
          <div className="sm:col-span-2"><label htmlFor="nombre" className="etiqueta">Nombre</label><input id="nombre" required className="campo" value={d.nombre} onChange={(e) => set("nombre", e.target.value)} /></div>
          <div><label htmlFor="laboratorio" className="etiqueta">Laboratorio</label><input id="laboratorio" className="campo" value={d.laboratorio} onChange={(e) => set("laboratorio", e.target.value)} /></div>
          <div><label htmlFor="ean" className="etiqueta">Código de barras</label><input id="ean" inputMode="numeric" className="campo num" value={d.ean} onChange={(e) => set("ean", e.target.value.replace(/\D/g, ""))} placeholder="Escanéalo aquí" /></div>
          <div><label htmlFor="iva" className="etiqueta">IVA</label>
            <select id="iva" className="campo" value={d.iva} onChange={(e) => set("iva", Number(e.target.value) as 0 | 5 | 19)}><option value={0}>0 % (medicamentos)</option><option value={5}>5 %</option><option value={19}>19 %</option></select></div>
          <div><label htmlFor="upc" className="etiqueta">Unidades por caja</label><input id="upc" type="number" min={1} max={1000} className="campo num" value={d.unidades_por_caja} onChange={(e) => set("unidades_por_caja", Math.max(1, Number(e.target.value) || 1))} /></div>
          <div><label htmlFor="precio_caja" className="etiqueta">Precio de venta {d.unidades_por_caja > 1 ? "por caja" : ""} (con IVA)</label><input id="precio_caja" required inputMode="numeric" className="campo num text-lg font-semibold" value={fmt(d.precio_caja)} onChange={(e) => set("precio_caja", e.target.value)} placeholder="$" /></div>
          {d.unidades_por_caja > 1 && (
            <div><label htmlFor="precio_unidad" className="etiqueta">Precio por unidad <span className="text-muted font-normal">(vacío = no se fracciona)</span></label>
              <input id="precio_unidad" inputMode="numeric" className="campo num" value={fmt(d.precio_unidad)} onChange={(e) => set("precio_unidad", e.target.value)} placeholder={unitario ? `Sugerido ${unitario.toLocaleString("es-CO")}` : "$"} /></div>
          )}
          <div><label htmlFor="minimo" className="etiqueta">Mínimo en {d.unidades_por_caja > 1 ? "cajas" : "unidades"} <span className="text-muted font-normal">(aviso para pedir)</span></label><input id="minimo" type="number" min={0} className="campo num" value={d.stock_minimo} onChange={(e) => set("stock_minimo", Math.max(0, Number(e.target.value) || 0))} /></div>
          <div><label htmlFor="registro" className="etiqueta">Registro sanitario INVIMA <span className="text-muted font-normal">(para cruzar alertas)</span></label><input id="registro" className="campo" value={d.registro_sanitario ?? ""} onChange={(e) => set("registro_sanitario", e.target.value.toUpperCase())} placeholder="INVIMA 2020M-0012345-R1" /></div>
          <fieldset className="sm:col-span-2 rounded-xl border-2 border-line p-4 grid gap-3">
            <legend className="px-1 text-sm font-semibold">Dispensación</legend>
            <label className="flex items-start gap-3 cursor-pointer">
              <input id="requiere_formula" type="checkbox" className="mt-1 size-5 accent-[var(--cruz)]" checked={!!(d.requiere_formula || d.control_especial)} disabled={!!d.control_especial}
                onChange={(e) => set("requiere_formula", e.target.checked)} />
              <span><span className="font-semibold">Venta con fórmula médica</span>
                <span className="block text-sm text-muted">La caja avisa «requiere fórmula médica» y pide confirmar que se verificó antes de cobrar.</span></span>
            </label>
            <label className="flex items-start gap-3 cursor-pointer">
              <input id="control_especial" type="checkbox" className="mt-1 size-5 accent-[var(--cruz)]" checked={!!d.control_especial}
                onChange={(e) => setD((x) => ({ ...x, control_especial: e.target.checked, requiere_formula: e.target.checked ? true : x.requiere_formula }))} />
              <span><span className="font-semibold">Medicamento de control especial</span>
                <span className="block text-sm text-muted">Siempre con fórmula. La caja pide paciente, médico y fórmula vigente, y cada venta queda en el libro de control especial.</span></span>
            </label>
          </fieldset>
          {error && <p role="alert" className="sm:col-span-2 text-alerta">{error}</p>}
          <div className="sm:col-span-2 flex flex-wrap gap-2 pt-1">
            <button disabled={enviando} className="btn-primario">{enviando ? "Guardando…" : id ? "Guardar cambios" : "Agregar a mi droguería"}</button>
            <a href="/productos" className="btn-borde">Cancelar</a>
            {id && <span className="ml-auto inline-flex items-center gap-3">
              {confirmar && <button type="button" onClick={() => setConfirmar(false)} className="text-sm text-muted">Cancelar</button>}
              <button type="button" onClick={retirar} className="btn-peligro">{confirmar ? "¿Retirar? Sí, retirar" : "Retirar producto"}</button>
            </span>}
          </div>
        </form>
      )}
    </div>
  );
}
