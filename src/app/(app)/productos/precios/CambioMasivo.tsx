"use client";
import { useEffect, useRef, useState } from "react";
import { leerNumero } from "@/lib/compras";
import { FILTROS, pct, pesosMano, type TipoFiltro } from "@/lib/precios";

export type Opciones = { laboratorios: { nombre: string; n: number }[]; categorias: { nombre: string; n: number }[]; proveedores: { id: string; nombre: string; n: number }[]; iva: { tarifa: number; n: number }[] };
type Prod = { id: string; nombre: string; laboratorio: string | null };
type Linea = { producto_id: string; nombre: string; laboratorio: string | null; upc: number; caja_antes: number; unidad_antes: number | null; caja_despues: number; unidad_despues: number | null;
  costo: number | null; heredado: boolean; margen_antes: number | null; margen_despues: number | null; omitido: string | null; aplica: boolean };
type Previa = { lineas: Linea[]; firma: string; descripcion: string;
  resumen: { productos: number; cambian: number; suben: number; bajan: number; sin_costo: number; heredados: number; margen_antes: number | null; margen_despues: number | null } };
type Regla = "subir" | "bajar" | "margen";

const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

/** Cambio masivo de precios: filtro, regla, redondeo → vista previa calculada por la base → confirmar y aplicar. */
export function CambioMasivo({ opciones }: { opciones: Opciones }) {
  const [tipo, setTipo] = useState<TipoFiltro>("laboratorio");
  const [lab, setLab] = useState(""); const [cat, setCat] = useState(""); const [prov, setProv] = useState(""); const [iva, setIva] = useState("");
  const [elegidos, setElegidos] = useState<Prod[]>([]);
  const [q, setQ] = useState(""); const [res, setRes] = useState<Prod[]>([]);
  const [regla, setRegla] = useState<Regla>("subir");
  const [valor, setValor] = useState("");
  const [redondeo, setRedondeo] = useState<50 | 100>(50);
  const [excluir, setExcluir] = useState<string[]>([]);
  const [previa, setPrevia] = useState<Previa | null>(null);
  const [confirmar, setConfirmar] = useState(false);
  const [error, setError] = useState("");
  const [cargando, setCargando] = useState(false);
  const idem = useRef("");

  // Cualquier cambio en el formulario deja vieja la vista previa.
  useEffect(() => { setPrevia(null); setConfirmar(false); }, [tipo, lab, cat, prov, iva, elegidos, regla, valor, redondeo]);
  useEffect(() => { setExcluir([]); }, [tipo, lab, cat, prov, iva, elegidos]);

  useEffect(() => {
    if (tipo !== "productos" || q.trim().length < 2) { setRes([]); return; }
    const ctl = new AbortController();
    const t = setTimeout(() => fetch(`/api/productos?q=${encodeURIComponent(q)}`, { signal: ctl.signal }).then((r) => r.json()).then((j) => {
      const ps: (Prod & { exacto?: boolean })[] = j.productos ?? [];
      if (ps[0]?.exacto) { agregar(ps[0]); return; }
      setRes(ps.slice(0, 8));
    }).catch(() => {}), 160);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q, tipo]); // eslint-disable-line react-hooks/exhaustive-deps

  function agregar(p: Prod) { setQ(""); setRes([]); setElegidos((l) => (l.some((x) => x.id === p.id) ? l : [...l, { id: p.id, nombre: p.nombre, laboratorio: p.laboratorio }])); }

  function cuerpo(ex = excluir) {
    const v = leerNumero(valor);
    const valorFiltro = tipo === "laboratorio" ? lab : tipo === "categoria" ? cat : tipo === "proveedor" ? prov : tipo === "iva" ? iva : elegidos.map((p) => p.id);
    return { filtro: { tipo, valor: valorFiltro }, regla: { tipo: regla === "margen" ? "margen" : "porcentaje", valor: v === null ? NaN : regla === "bajar" ? -v : v }, redondeo, excluir: ex };
  }

  async function verPrevia(ex = excluir) {
    setError(""); setConfirmar(false);
    const b = cuerpo(ex);
    if ((typeof b.filtro.valor === "string" && !b.filtro.valor) || (Array.isArray(b.filtro.valor) && !b.filtro.valor.length)) { setError(tipo === "productos" ? "Agrega al menos un producto." : "Elige a qué productos aplicar el cambio."); return; }
    if (!isFinite(b.regla.valor) || b.regla.valor === 0) { setError(regla === "margen" ? "Escribe el margen objetivo." : "Escribe el porcentaje."); document.getElementById("regla-valor")?.focus(); return; }
    setCargando(true);
    const r = await fetch("/api/precios/vista-previa", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ ...b, regla: { ...b.regla, valor: Math.round(b.regla.valor * 100) / 100 } }) }).catch(() => null);
    setCargando(false);
    const j = await r?.json().catch(() => ({}));
    if (!r) { setError("Sin conexión: revisa internet e intenta de nuevo."); return; }
    if (!r.ok) { setError(j?.error ?? "No se pudo calcular la vista previa"); return; }
    idem.current = crypto.randomUUID();
    setPrevia(j);
    setTimeout(() => document.getElementById("previa-t")?.focus(), 0);
  }

  function alternar(id: string) {
    const ex = excluir.includes(id) ? excluir.filter((x) => x !== id) : [...excluir, id];
    setExcluir(ex); void verPrevia(ex);
  }

  async function aplicar() {
    if (!previa) return;
    setError(""); setCargando(true);
    const b = cuerpo();
    const r = await fetch("/api/precios", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ ...b, regla: { ...b.regla, valor: Math.round(b.regla.valor * 100) / 100 }, firma: previa.firma, idem_key: idem.current }) }).catch(() => null);
    const j = await r?.json().catch(() => ({}));
    if (!r) { setCargando(false); setError("Sin conexión: revisa internet y vuelve a aplicar (no se duplicará)."); return; }
    if (!r.ok) { setCargando(false); setConfirmar(false); setError(j?.error ?? "No se pudo aplicar el cambio"); return; }
    location.assign(`/productos/precios/${j.cambio.id}?aplicado=1`);
  }

  const lista = (id: string, etiqueta: string, v: string, set: (x: string) => void, items: { valor: string; texto: string }[], vacio: string) => (
    <div>
      <label htmlFor={id} className="etiqueta">{etiqueta}</label>
      {items.length ? (
        <select id={id} className="campo" value={v} onChange={(e) => set(e.target.value)}>
          <option value="">Elige…</option>
          {items.map((x) => <option key={x.valor} value={x.valor}>{x.texto}</option>)}
        </select>
      ) : <p className="text-sm text-muted">{vacio}</p>}
    </div>
  );
  const marg = (m: number | null) => (m === null ? "—" : pct(m));
  const tonoMargen = (m: number | null) => (m === null ? "text-muted" : m < 10 ? "text-alerta" : m < 20 ? "text-aviso" : "text-cruz");
  const aplican = previa?.lineas.filter((l) => l.aplica) ?? [];

  return (
    <div className="grid gap-4 max-w-5xl">
      <section className="tarjeta p-4 sm:p-5 grid gap-3" aria-labelledby="filtro-t">
        <fieldset>
          <legend id="filtro-t" className="titulo text-xl">1. ¿A qué productos?</legend>
          <div className="grid grid-cols-2 sm:grid-cols-5 gap-2 mt-2">
            {FILTROS.map(([k, t]) => (
              <label key={k} className={`flex items-center gap-2 rounded-xl border-2 px-3 py-2.5 cursor-pointer text-[15px] font-semibold has-[:focus-visible]:outline has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-marca ${tipo === k ? "border-ink bg-paper" : "border-line bg-surface hover:border-ink/50"}`}>
                <input type="radio" name="filtro" value={k} checked={tipo === k} onChange={() => setTipo(k)} className="accent-[var(--ink)] w-4 h-4 shrink-0" />{t}
              </label>
            ))}
          </div>
        </fieldset>
        {tipo === "laboratorio" && lista("f-lab", "Laboratorio", lab, setLab, opciones.laboratorios.map((x) => ({ valor: x.nombre, texto: `${x.nombre} (${x.n})` })), "Tus productos no tienen laboratorio registrado.")}
        {tipo === "categoria" && lista("f-cat", "Categoría", cat, setCat, opciones.categorias.map((x) => ({ valor: x.nombre, texto: `${x.nombre} (${x.n})` })), "Tus productos no tienen categoría registrada.")}
        {tipo === "proveedor" && lista("f-prov", "Proveedor (productos que le has comprado)", prov, setProv, opciones.proveedores.map((x) => ({ valor: x.id, texto: `${x.nombre} (${x.n})` })), "Todavía no hay compras registradas a proveedores.")}
        {tipo === "iva" && lista("f-iva", "Tarifa de IVA", iva, setIva, opciones.iva.map((x) => ({ valor: String(x.tarifa), texto: `IVA ${x.tarifa} % (${x.n})` })), "No hay productos.")}
        {tipo === "productos" && (
          <div className="grid gap-2">
            <div className="relative">
              <label htmlFor="f-buscar" className="etiqueta">Agrega productos</label>
              <input id="f-buscar" className="campo" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Escanea o escribe el nombre" autoComplete="off" />
              {res.length > 0 && (
                <ul aria-label="Resultados" className="absolute z-10 mt-1 w-full tarjeta shadow-lg divide-y divide-line max-h-80 overflow-auto">
                  {res.map((p) => <li key={p.id}><button type="button" onClick={() => agregar(p)} className="w-full text-left px-4 py-2.5 hover:bg-paper"><span className="font-semibold">{p.nombre}</span><span className="block text-sm text-muted">{p.laboratorio ?? "Sin laboratorio"}</span></button></li>)}
                </ul>
              )}
            </div>
            {elegidos.length > 0 && (
              <ul aria-label="Productos elegidos" className="flex flex-wrap gap-2">
                {elegidos.map((p) => (
                  <li key={p.id} className="inline-flex items-center gap-1 rounded-lg border border-line bg-paper pl-3 pr-1 h-9 max-w-full">
                    <span className="truncate text-sm font-semibold">{p.nombre}</span>
                    <button type="button" onClick={() => setElegidos((l) => l.filter((x) => x.id !== p.id))} aria-label={`Quitar ${p.nombre}`} className="h-7 w-7 rounded-md text-muted hover:text-alerta grid place-items-center shrink-0">×</button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </section>

      <section className="tarjeta p-4 sm:p-5 grid gap-3" aria-labelledby="regla-t">
        <fieldset>
          <legend id="regla-t" className="titulo text-xl">2. ¿Cómo cambia el precio?</legend>
          <div className="grid sm:grid-cols-3 gap-2 mt-2">
            {([["subir", "Subir un porcentaje", "Sobre el precio de hoy"], ["bajar", "Bajar un porcentaje", "Sobre el precio de hoy"], ["margen", "Margen objetivo", "Sobre el último costo sin IVA"]] as const).map(([k, t, d]) => (
              <label key={k} className={`flex items-start gap-2.5 rounded-xl border-2 px-3 py-2.5 cursor-pointer has-[:focus-visible]:outline has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-marca ${regla === k ? "border-ink bg-paper" : "border-line bg-surface hover:border-ink/50"}`}>
                <input type="radio" name="regla" value={k} checked={regla === k} onChange={() => setRegla(k)} className="accent-[var(--ink)] w-4 h-4 shrink-0 mt-1" />
                <span><span className="font-semibold">{t}</span><span className="block text-sm text-muted">{d}</span></span>
              </label>
            ))}
          </div>
        </fieldset>
        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label htmlFor="regla-valor" className="etiqueta">{regla === "margen" ? "Margen sobre el precio sin IVA (%)" : "Porcentaje (%)"}</label>
            <input id="regla-valor" className="campo num" inputMode="decimal" value={valor} onChange={(e) => setValor(e.target.value.replace(/[^\d,.]/g, "").slice(0, 6))} placeholder={regla === "margen" ? "Ej.: 30" : "Ej.: 5"} />
            {regla === "margen" && <p className="text-sm text-muted mt-1">Margen = (precio sin IVA − costo) ÷ precio sin IVA, igual que en el resto de Regenta. El precio por unidad conserva su proporción con el de la caja.</p>}
          </div>
          <fieldset>
            <legend className="etiqueta">Redondeo hacia arriba</legend>
            <div className="flex rounded-xl border-2 border-line overflow-hidden h-11" role="radiogroup" aria-label="Redondeo">
              {([50, 100] as const).map((r) => (
                <button key={r} type="button" role="radio" aria-checked={redondeo === r} onClick={() => setRedondeo(r)} className={`flex-1 px-3 font-semibold ${redondeo === r ? "bg-ink text-white" : "bg-surface text-ink"}`}>A ${r}</button>
              ))}
            </div>
          </fieldset>
        </div>
        <div className="flex flex-wrap gap-2 items-center">
          <button type="button" onClick={() => void verPrevia()} disabled={cargando} className="btn-oscuro">{cargando && !previa ? "Calculando…" : "Ver vista previa"}</button>
          <p className="text-sm text-muted">Nada cambia hasta que confirmes.</p>
        </div>
        {error && <p role="alert" className="text-sm text-alerta font-semibold">{error}</p>}
      </section>

      {previa && (
        <section className="tarjeta p-4 sm:p-5 grid gap-4" aria-labelledby="previa-t">
          <div>
            <h2 id="previa-t" tabIndex={-1} className="titulo text-xl outline-none">3. Vista previa</h2>
            <p className="text-sm text-muted break-words">{previa.descripcion}</p>
          </div>
          <dl className="grid grid-cols-2 lg:grid-cols-4 gap-2">
            <div className="rounded-xl bg-paper px-3 py-2.5"><dt className="text-sm text-muted">Cambian de precio</dt><dd className="num titulo text-2xl" data-prueba="cambian">{previa.resumen.cambian} <span className="text-base font-normal text-muted">de {previa.resumen.productos}</span></dd></div>
            <div className="rounded-xl bg-paper px-3 py-2.5"><dt className="text-sm text-muted">Suben · bajan</dt><dd className="num titulo text-2xl">{previa.resumen.suben} · {previa.resumen.bajan}</dd></div>
            <div className="rounded-xl bg-paper px-3 py-2.5"><dt className="text-sm text-muted">Margen promedio</dt><dd className="num titulo text-xl sm:text-2xl">{marg(n(previa.resumen.margen_antes))} → {marg(n(previa.resumen.margen_despues))}</dd></div>
            <div className="rounded-xl bg-paper px-3 py-2.5"><dt className="text-sm text-muted">Redondeo</dt><dd className="num titulo text-2xl">A ${redondeo}</dd></div>
          </dl>
          {previa.resumen.heredados > 0 && <p className="rounded-xl bg-aviso-soft text-aviso px-4 py-3 text-sm font-semibold">{previa.resumen.heredados} producto{previa.resumen.heredados === 1 ? " tiene" : "s tienen"} un costo heredado (cargado antes de las compras con IVA separado): no se sabe si incluye IVA, revisa su margen antes de aplicar.</p>}
          {previa.resumen.sin_costo > 0 && <p className="rounded-xl bg-paper px-4 py-3 text-sm">{previa.resumen.sin_costo} producto{previa.resumen.sin_costo === 1 ? "" : "s"} sin costo registrado quedan igual (sin costo no hay margen que calcular).</p>}
          <div className="relative overflow-x-auto rounded-xl border border-line">
            <table className="w-full text-sm min-w-[760px]">
              <caption className="sr-only">Precios antes y después</caption>
              <thead className="bg-paper text-left text-muted"><tr>
                <th className="px-3 py-2 font-semibold">Aplicar</th><th className="px-3 py-2 font-semibold">Producto</th><th className="px-3 py-2 font-semibold text-right">Costo und sin IVA</th>
                <th className="px-3 py-2 font-semibold text-right">Caja</th><th className="px-3 py-2 font-semibold text-right">Unidad</th><th className="px-3 py-2 font-semibold text-right">Margen</th>
              </tr></thead>
              <tbody className="divide-y divide-line">
                {previa.lineas.map((l) => {
                  const fuera = excluir.includes(l.producto_id);
                  return (
                    <tr key={l.producto_id} className={l.aplica ? "" : "text-muted"} data-producto={l.producto_id}>
                      <td className="px-3 py-2">
                        {(l.aplica || fuera) ? <input type="checkbox" checked={!fuera} disabled={cargando} onChange={() => alternar(l.producto_id)} aria-label={`Aplicar a ${l.nombre}`} className="w-4 h-4 accent-[var(--ink)]" /> : <span className="text-xs">—</span>}
                      </td>
                      <td className="px-3 py-2 max-w-[320px]"><p className="font-semibold leading-snug text-ink">{l.nombre}</p>
                        <p className="text-xs text-muted">{l.laboratorio ?? "Sin laboratorio"}{fuera ? " · excluido" : l.omitido ? ` · ${l.omitido}` : ""}</p></td>
                      <td className="px-3 py-2 text-right num whitespace-nowrap">{l.costo === null ? "—" : pesosMano(Number(l.costo))}{l.heredado && <span className="block text-xs text-aviso font-semibold">heredado</span>}</td>
                      <td className="px-3 py-2 text-right num whitespace-nowrap" data-campo="caja">{pesosMano(Number(l.caja_antes))}{l.aplica && <> → <b className="text-ink">{pesosMano(Number(l.caja_despues))}</b></>}</td>
                      <td className="px-3 py-2 text-right num whitespace-nowrap" data-campo="unidad">{l.unidad_antes === null ? "—" : <>{pesosMano(Number(l.unidad_antes))}{l.aplica && Number(l.unidad_despues) !== Number(l.unidad_antes) && <> → <b className="text-ink">{pesosMano(Number(l.unidad_despues))}</b></>}</>}</td>
                      <td className="px-3 py-2 text-right num whitespace-nowrap">{marg(n(l.margen_antes))}{l.aplica && <> → <b className={tonoMargen(n(l.margen_despues))}>{marg(n(l.margen_despues))}</b></>}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {!confirmar ? (
            <div className="flex flex-wrap gap-2 items-center">
              <button type="button" onClick={() => setConfirmar(true)} disabled={!aplican.length || cargando} className="btn-primario">Aplicar a {aplican.length} producto{aplican.length === 1 ? "" : "s"}</button>
              {!aplican.length && <p className="text-sm text-muted">Con esta regla ningún precio cambia.</p>}
            </div>
          ) : (
            <div role="alertdialog" aria-labelledby="conf-t" aria-describedby="conf-d" className="rounded-xl border-2 border-ink p-4 grid gap-3">
              <p id="conf-t" className="font-semibold">¿Cambiar el precio de {aplican.length} producto{aplican.length === 1 ? "" : "s"}?</p>
              <p id="conf-d" className="text-sm text-muted">La caja cobra el precio nuevo desde ya. Queda en el historial y lo puedes revertir mientras nadie cambie esos precios.</p>
              <div className="flex flex-wrap gap-2">
                <button type="button" onClick={() => void aplicar()} disabled={cargando} className="btn-primario" autoFocus>{cargando ? "Aplicando…" : "Sí, aplicar"}</button>
                <button type="button" onClick={() => setConfirmar(false)} disabled={cargando} className="btn-borde">Cancelar</button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
