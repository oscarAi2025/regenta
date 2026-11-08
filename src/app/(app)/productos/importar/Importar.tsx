"use client";
import { useRef, useState } from "react";
import { CAMPOS, ETIQUETAS, mapearColumnas, type Campo } from "@/lib/importar";

const EJEMPLO = [
  ["nombre", "codigo_barras", "laboratorio", "iva", "unidades_por_caja", "precio_caja", "precio_unidad", "stock_minimo", "lote", "vence", "cantidad_unidades", "costo_unidad", "registro_sanitario", "venta_con_formula", "control_especial"],
  ["Acetaminofen 500 mg tabletas caja x 100", "7702057000000", "Genérico", "0", "100", "12000", "200", "3", "L2026A", "31/08/2027", "300", "80", "", "no", "no"],
  ["Crema dental 75 ml", "7891024000000", "Marca", "19", "1", "6500", "", "6", "C55", "31/01/2028", "24", "4100", "", "", ""],
];

type Celda = string | number | boolean | Date | null;
type Plan = { fila: number; nombre: string; accion: string; existencias: number };
type Resumen = { crear: number; actualizar: number; con_existencias: number; unidades: number };
type Respuesta = { plan: Plan[]; resumen: Resumen; errores: { fila: number; error: string }[]; avisos: { fila: number; texto: string }[]; total_avisos: number; aplicado?: boolean };

/** Lee un CSV (separado por ; , o tabulador, con comillas) como filas de celdas. */
function leerCSV(texto: string): string[][] {
  const linea = texto.split(/\r?\n/)[0];
  const cuenta = (c: string) => linea.split(c).length - 1;
  const sep = [";", ",", "\t"].sort((a, b) => cuenta(b) - cuenta(a))[0];
  const filas: string[][] = []; let fila: string[] = [], campo = "", comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (comillas) { if (ch === '"' && texto[i + 1] === '"') { campo += '"'; i++; } else if (ch === '"') comillas = false; else campo += ch; }
    else if (ch === '"') comillas = true;
    else if (ch === sep) { fila.push(campo); campo = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && texto[i + 1] === "\n") i++; fila.push(campo); campo = ""; filas.push(fila); fila = []; }
    else campo += ch;
  }
  fila.push(campo); filas.push(fila);
  return filas;
}

const vacia = (f: Celda[]) => f.every((c) => c === null || c === undefined || String(c).trim() === "");

/** La fila de títulos es la primera (de las 15 primeras) donde se reconoce el nombre del producto y al menos otra columna. */
function buscarCabecera(filas: Celda[][]) {
  for (let i = 0; i < Math.min(15, filas.length); i++) {
    const m = mapearColumnas(filas[i]);
    if (m.includes("nombre") && m.filter(Boolean).length >= 2) return i;
  }
  return filas.findIndex((f) => !vacia(f));
}

export function Importar() {
  const [archivo, setArchivo] = useState("");
  const [tabla, setTabla] = useState<{ cab: string[]; datos: Celda[][]; desde: number } | null>(null);
  const [mapa, setMapa] = useState<(Campo | null)[]>([]);
  const [res, setRes] = useState<Respuesta | null>(null);
  const [estado, setEstado] = useState<"" | "leyendo" | "revisando" | "listo" | "importando" | "hecho">("");
  const [error, setError] = useState("");
  const [arrastrando, setArrastrando] = useState(false);
  const [verAvisos, setVerAvisos] = useState(false);
  const idem = useRef("");
  const entrada = useRef<HTMLInputElement>(null);

  function plantilla() {
    const csv = EJEMPLO.map((f) => f.join(";")).join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = "plantilla-productos-regenta.csv"; a.click();
  }

  const filasPara = (t: NonNullable<typeof tabla>, m: (Campo | null)[]) => {
    const filas = t.datos.map((f) => {
      const o: Record<string, unknown> = {};
      m.forEach((c, i) => { if (!c) return; const v = f[i]; o[c] = v instanceof Date ? v.toISOString().slice(0, 10) : v ?? ""; });
      return o;
    });
    while (filas.length && Object.values(filas.at(-1)!).every((v) => String(v).trim() === "")) filas.pop();
    return filas;
  };

  async function enviar(t: NonNullable<typeof tabla>, m: (Campo | null)[], simular: boolean) {
    const r = await fetch("/api/productos/importar", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ simular, filas: filasPara(t, m), primera_fila: t.desde, idem_key: simular ? null : idem.current }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error ?? "No se pudo procesar el archivo");
    return j as Respuesta;
  }

  async function revisar(t: NonNullable<typeof tabla>, m: (Campo | null)[]) {
    setError(""); setRes(null);
    if (!m.includes("nombre")) { setError("Indica abajo cuál columna tiene el nombre del producto."); setEstado("listo"); return; }
    if (!m.includes("precio_caja") && !m.includes("precio_unidad")) { setError("Indica abajo cuál columna tiene el precio de venta."); setEstado("listo"); return; }
    setEstado("revisando");
    try { setRes(await enviar(t, m, true)); setEstado("listo"); }
    catch (e) { setError((e as Error).message); setEstado("listo"); }
  }

  async function abrir(f: File | undefined) {
    if (!f) return;
    setError(""); setRes(null); setTabla(null); setArchivo(f.name); setEstado("leyendo"); idem.current = crypto.randomUUID();
    try {
      let filas: Celda[][];
      if (/\.xlsx$/i.test(f.name)) {
        const { readSheet } = await import("read-excel-file/browser");
        filas = (await readSheet(f)) as Celda[][];
      } else if (/\.(csv|txt)$/i.test(f.name)) {
        // Excel en español guarda el CSV en Windows-1252: si no es UTF-8 válido se lee con esa codificación.
        const bytes = await f.arrayBuffer();
        let texto: string;
        try { texto = new TextDecoder("utf-8", { fatal: true }).decode(bytes); } catch { texto = new TextDecoder("windows-1252").decode(bytes); }
        filas = leerCSV(texto.replace(/^﻿/, ""));
      } else if (/\.xls$/i.test(f.name)) {
        throw new Error("Ese es el formato antiguo de Excel (.xls). Ábrelo en Excel y guárdalo como «Libro de Excel (.xlsx)» o como CSV.");
      } else throw new Error("Sube el archivo en Excel (.xlsx) o CSV.");
      const i = buscarCabecera(filas);
      if (i < 0) throw new Error("El archivo está vacío.");
      const cab = filas[i].map((c) => String(c ?? "").trim());
      const t = { cab, datos: filas.slice(i + 1), desde: i + 2 };
      if (!t.datos.some((d) => !vacia(d))) throw new Error("El archivo solo tiene títulos: no hay productos debajo.");
      const m = mapearColumnas(cab);
      setTabla(t); setMapa(m);
      await revisar(t, m);
    } catch (e) { setError((e as Error).message || "No se pudo leer el archivo. Ábrelo en Excel y guárdalo de nuevo como .xlsx."); setEstado(""); }
  }

  function cambiarColumna(i: number, c: Campo | null) {
    if (!tabla) return;
    const m = mapa.map((x, j) => (j === i ? c : x === c && c ? null : x));
    setMapa(m); void revisar(tabla, m);
  }

  async function importar() {
    if (!tabla) return;
    setEstado("importando"); setError("");
    try { const j = await enviar(tabla, mapa, false); setRes(j); setEstado(j.aplicado ? "hecho" : "listo"); }
    catch (e) { setError((e as Error).message); setEstado("listo"); }
  }

  const r = res?.resumen;
  const prod = (n: number) => `${n.toLocaleString("es-CO")} producto${n === 1 ? "" : "s"}`;
  const total = r ? r.crear + r.actualizar : 0;
  const partes = r ? [r.crear && `crear ${prod(r.crear)}`, r.actualizar && `actualizar ${prod(r.actualizar)}`].filter(Boolean).join(" y ") : "";
  const errores = res?.errores ?? [];

  return (
    <div className="grid gap-5 max-w-4xl">
      <label
        onDragOver={(e) => { e.preventDefault(); setArrastrando(true); }} onDragLeave={() => setArrastrando(false)}
        onDrop={(e) => { e.preventDefault(); setArrastrando(false); void abrir(e.dataTransfer.files?.[0]); }}
        className={`tarjeta p-6 sm:p-8 grid justify-items-center text-center gap-2 cursor-pointer border-2 border-dashed transition-colors ${arrastrando ? "border-cruz bg-cruz-soft" : "border-line hover:border-ink"}`}>
        <svg aria-hidden viewBox="0 0 24 24" className="size-10 text-cruz" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="M12 16V4m0 0-4 4m4-4 4 4M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3" strokeLinecap="round" strokeLinejoin="round" /></svg>
        <span className="titulo text-xl">{archivo ? "Subir otro archivo" : "Sube el Excel de tus productos"}</span>
        <span className="text-sm text-muted max-w-md">Sirve el archivo que exporta tu sistema anterior (.xlsx o .csv). Reconocemos las columnas solas; si un producto se repite, se carga una sola vez.</span>
        <span className="btn-primario mt-2 h-10">Elegir archivo</span>
        <input ref={entrada} type="file" accept=".xlsx,.csv,.txt,.xls,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" className="sr-only"
          onChange={(e) => { void abrir(e.target.files?.[0]); e.target.value = ""; }} />
        {archivo && <span className="text-sm text-muted truncate max-w-full">{archivo}</span>}
      </label>
      <div className="-mt-2 flex flex-wrap items-center gap-x-4 gap-y-2"><p className="text-sm text-muted">¿Empiezas de cero? Usa la plantilla: una fila por producto; lote, vencimiento y existencias son opcionales.</p><button type="button" onClick={plantilla} className="btn-borde h-11 text-sm">Descargar la plantilla</button></div>

      {error && <p role="alert" className="rounded-xl bg-alerta-soft text-alerta px-4 py-3 font-semibold">{error}</p>}
      {(estado === "leyendo" || estado === "revisando") && <p className="text-muted" role="status">{estado === "leyendo" ? "Leyendo el archivo…" : "Revisando fila por fila…"}</p>}

      {tabla && (
        <details className="tarjeta p-4" open={!mapa.includes("nombre") || (!mapa.includes("precio_caja") && !mapa.includes("precio_unidad"))}>
          <summary className="cursor-pointer font-semibold">Columnas reconocidas: {mapa.filter(Boolean).length} de {tabla.cab.filter(Boolean).length} <span className="font-normal text-muted">· cambia la que no corresponda</span></summary>
          <ul className="mt-3 grid sm:grid-cols-2 gap-2">
            {tabla.cab.map((h, i) => h && (
              <li key={i} className="flex items-center gap-2 text-sm">
                <span className="flex-1 truncate" title={h}>{h}</span>
                <span aria-hidden className="text-muted">→</span>
                <select aria-label={`Columna ${h}`} value={mapa[i] ?? ""} onChange={(e) => cambiarColumna(i, (e.target.value || null) as Campo | null)} className={`campo h-9 w-44 py-1 text-sm ${mapa[i] ? "" : "text-muted"}`}>
                  <option value="">No usar</option>
                  {CAMPOS.map((c) => <option key={c} value={c}>{ETIQUETAS[c]}</option>)}
                </select>
              </li>
            ))}
          </ul>
        </details>
      )}

      {res && r && (estado === "listo" || estado === "importando" || estado === "hecho") && (
        <section className="tarjeta p-5" aria-live="polite">
          {estado === "hecho"
            ? <p className="titulo text-xl text-cruz">Listo: {[r.crear && `${prod(r.crear)} creado${r.crear === 1 ? "" : "s"}`, r.actualizar && `${prod(r.actualizar)} actualizado${r.actualizar === 1 ? "" : "s"}`].filter(Boolean).join(", ")}{r.con_existencias ? `; existencias cargadas en ${prod(r.con_existencias)}` : ""}.</p>
            : <p className="titulo text-xl">{total ? <>Se va{total === 1 ? "" : "n"} a {partes}{r.con_existencias ? `; ${r.con_existencias.toLocaleString("es-CO")} con existencias (${r.unidades.toLocaleString("es-CO")} unidades)` : ""}.</> : "No hay productos para cargar."}</p>}

          {errores.length > 0 && (
            <div className="mt-4 rounded-xl bg-alerta-soft p-4">
              <p className="font-semibold text-alerta">Hay {errores.length} fila(s) con errores. Corrígelas en el archivo y vuelve a subirlo: no se importa nada hasta que esté limpio.</p>
              <ul className="mt-2 text-sm grid gap-1">{errores.slice(0, 40).map((e, i) => <li key={i}>Fila {e.fila}: {e.error}</li>)}</ul>
              {errores.length > 40 && <p className="text-sm mt-1">…y {errores.length - 40} más.</p>}
            </div>
          )}
          {res.total_avisos > 0 && (
            <div className="mt-4 rounded-xl bg-aviso-soft p-4 text-sm">
              <button onClick={() => setVerAvisos(!verAvisos)} className="font-semibold text-aviso text-left" aria-expanded={verAvisos}>
                {res.total_avisos} ajuste{res.total_avisos === 1 ? "" : "s"} automático{res.total_avisos === 1 ? "" : "s"} (no impiden importar) · {verAvisos ? "ocultar" : "ver"}
              </button>
              {verAvisos && <ul className="mt-2 grid gap-1">{res.avisos.map((a, i) => <li key={i}>Fila {a.fila}: {a.texto}</li>)}{res.total_avisos > res.avisos.length && <li>…y {res.total_avisos - res.avisos.length} más.</li>}</ul>}
            </div>
          )}
          <ul className="mt-4 max-h-80 overflow-auto divide-y divide-line text-sm">
            {res.plan.slice(0, 300).map((p) => <li key={p.fila} className="flex gap-3 py-1.5"><span className="text-muted w-16 shrink-0">Fila {p.fila}</span><span className="flex-1 min-w-0 truncate">{p.nombre}</span><span className={p.accion === "crear" ? "text-cruz font-semibold" : "text-muted"}>{p.accion === "crear" ? "Nuevo" : p.accion === "reactivar" ? "Reactiva" : "Actualiza"}</span>{p.existencias > 0 && <span className="num w-24 text-right">+{p.existencias.toLocaleString("es-CO")} und</span>}</li>)}
          </ul>
          {res.plan.length > 300 && <p className="text-sm text-muted mt-1">Se muestran 300 de {prod(total)}.</p>}
          {estado !== "hecho" && <button onClick={importar} disabled={errores.length > 0 || estado === "importando" || total === 0} className="btn-primario mt-4">{estado === "importando" ? "Importando…" : `Importar ${prod(total)}`}</button>}
          {estado === "hecho" && <a href="/productos" className="btn-oscuro mt-4">Ver productos</a>}
        </section>
      )}
    </div>
  );
}
