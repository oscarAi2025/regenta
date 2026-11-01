"use client";
import { useState } from "react";

const COLUMNAS = ["nombre", "codigo_barras", "laboratorio", "iva", "unidades_por_caja", "precio_caja", "precio_unidad", "stock_minimo", "lote", "vence", "cantidad_unidades", "costo_unidad"];
const EJEMPLO = [
  ["Acetaminofen 500 mg tabletas caja x 100", "7702057000000", "Genérico", "0", "100", "12000", "200", "3", "L2026A", "2027-08-31", "300", "80"],
  ["Crema dental 75 ml", "7891024000000", "Marca", "19", "1", "6500", "", "6", "C55", "2028-01-31", "24", "4100"],
];

/** Lee un CSV de Excel (separado por ; o ,), con comillas. Devuelve filas como objetos con las columnas del encabezado. */
function leerCSV(texto: string) {
  const sep = (texto.split(/\r?\n/)[0].match(/;/g)?.length ?? 0) >= (texto.split(/\r?\n/)[0].match(/,/g)?.length ?? 0) ? ";" : ",";
  const filas: string[][] = []; let fila: string[] = [], campo = "", comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const ch = texto[i];
    if (comillas) { if (ch === '"' && texto[i + 1] === '"') { campo += '"'; i++; } else if (ch === '"') comillas = false; else campo += ch; }
    else if (ch === '"') comillas = true;
    else if (ch === sep) { fila.push(campo); campo = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && texto[i + 1] === "\n") i++; fila.push(campo); campo = ""; if (fila.some((c) => c.trim())) filas.push(fila); fila = []; }
    else campo += ch;
  }
  fila.push(campo); if (fila.some((c) => c.trim())) filas.push(fila);
  const cab = (filas.shift() ?? []).map((c) => c.trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/\s+/g, "_"));
  const numericas = new Set(["iva", "unidades_por_caja", "precio_caja", "precio_unidad", "stock_minimo", "cantidad_unidades", "costo_unidad"]);
  // En columnas de números se quitan $, % y separadores de miles (12.000 → 12000); el texto se deja tal cual.
  return filas.map((f) => Object.fromEntries(cab.map((c, i) => { const v = (f[i] ?? "").trim(); return [c, numericas.has(c) ? v.replace(/[$%\s]/g, "").replace(/\.(?=\d{3}\b)/g, "").replace(",", ".") : v]; })));
}

type Plan = { fila: number; nombre: string; accion: string; existencias: number };

export function Importar() {
  const [filas, setFilas] = useState<Record<string, string>[] | null>(null);
  const [archivo, setArchivo] = useState("");
  const [plan, setPlan] = useState<Plan[]>([]);
  const [errores, setErrores] = useState<{ fila: number; error: string }[]>([]);
  const [estado, setEstado] = useState<"" | "revisando" | "listo" | "importando" | "hecho">("");
  const [error, setError] = useState("");

  function plantilla() {
    const csv = [COLUMNAS.join(";"), ...EJEMPLO.map((f) => f.join(";"))].join("\r\n");
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob(["﻿" + csv], { type: "text/csv;charset=utf-8" }));
    a.download = "plantilla-productos-regenta.csv"; a.click();
  }

  async function enviar(f: Record<string, string>[], simular: boolean) {
    const r = await fetch("/api/productos/importar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ simular, filas: f }) });
    const j = await r.json();
    if (!r.ok) throw new Error(j.error ?? "No se pudo procesar el archivo");
    return j;
  }

  async function elegir(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]; if (!f) return;
    setError(""); setArchivo(f.name); setEstado("revisando");
    if (!/\.csv$/i.test(f.name)) { setError("Guarda tu Excel como «CSV (delimitado por comas)» y súbelo de nuevo."); setEstado(""); return; }
    const leidas = leerCSV(await f.text());
    if (!leidas.length || !("nombre" in leidas[0]) || !("precio_caja" in leidas[0])) { setError("El archivo debe tener al menos las columnas «nombre» y «precio_caja». Descarga la plantilla para ver el formato."); setEstado(""); return; }
    setFilas(leidas);
    try { const j = await enviar(leidas, true); setPlan(j.plan ?? []); setErrores(j.errores ?? []); setEstado("listo"); }
    catch (err) { setError((err as Error).message); setEstado(""); }
  }

  async function importar() {
    if (!filas) return;
    setEstado("importando");
    try { const j = await enviar(filas, false); setPlan(j.plan ?? []); setErrores(j.errores ?? []); setEstado(j.aplicado ? "hecho" : "listo"); }
    catch (err) { setError((err as Error).message); setEstado("listo"); }
  }

  const crear = plan.filter((p) => p.accion === "crear").length, act = plan.length - crear, conStock = plan.filter((p) => p.existencias > 0).length;
  const prod = (n: number) => `${n} producto${n === 1 ? "" : "s"}`;
  const partes = [crear && `crear ${prod(crear)}`, act && `actualizar ${prod(act)}`].filter(Boolean).join(" y ");

  return (
    <div className="grid gap-5 max-w-4xl">
      <ol className="grid md:grid-cols-3 gap-3">
        <li className="tarjeta p-4"><p className="titulo text-lg">1. Descarga la plantilla</p><p className="text-sm text-muted mt-1">Una fila por producto. Lote, vence y cantidad son opcionales.</p><button onClick={plantilla} className="btn-borde mt-3 h-9 text-sm">Descargar plantilla</button></li>
        <li className="tarjeta p-4"><p className="titulo text-lg">2. Llénala en Excel</p><p className="text-sm text-muted mt-1">Guárdala como «CSV (delimitado por comas)». Precios con IVA, sin puntos ni signo $.</p></li>
        <li className="tarjeta p-4"><p className="titulo text-lg">3. Súbela y revisa</p>
          <label className="btn-primario mt-3 h-9 text-sm cursor-pointer">Elegir archivo<input type="file" accept=".csv,text/csv" className="sr-only" onChange={elegir} /></label>
          {archivo && <p className="text-sm text-muted mt-2 truncate">{archivo}</p>}</li>
      </ol>
      {error && <p role="alert" className="text-alerta">{error}</p>}
      {estado === "revisando" && <p className="text-muted">Revisando el archivo…</p>}
      {(estado === "listo" || estado === "importando" || estado === "hecho") && (
        <section className="tarjeta p-5">
          {estado === "hecho" ? <p className="titulo text-xl text-cruz">Listo: {[crear && `${prod(crear)} creado${crear === 1 ? "" : "s"}`, act && `${prod(act)} actualizado${act === 1 ? "" : "s"}`].filter(Boolean).join(", ")}{conStock ? `; existencias cargadas en ${prod(conStock)}` : ""}.</p>
            : <p className="titulo text-xl">Se va{plan.length === 1 ? "" : "n"} a {partes}{conStock ? `; ${conStock} con existencias` : ""}.</p>}
          {errores.length > 0 && (
            <div className="mt-4 rounded-xl bg-alerta-soft p-4">
              <p className="font-semibold text-alerta">Hay {errores.length} fila(s) con errores. Corrígelas en el Excel y vuelve a subirlo: no se importa nada hasta que el archivo esté limpio.</p>
              <ul className="mt-2 text-sm grid gap-1">{errores.slice(0, 30).map((e, i) => <li key={i}>Fila {e.fila}: {e.error}</li>)}</ul>
            </div>
          )}
          <ul className="mt-4 max-h-80 overflow-auto divide-y divide-line text-sm">
            {plan.slice(0, 300).map((p) => <li key={p.fila} className="flex gap-3 py-1.5"><span className="text-muted w-14">Fila {p.fila}</span><span className="flex-1">{p.nombre}</span><span className={p.accion === "crear" ? "text-cruz font-semibold" : "text-muted"}>{p.accion === "crear" ? "Nuevo" : "Actualiza"}</span>{p.existencias > 0 && <span className="num w-24 text-right">+{p.existencias} und</span>}</li>)}
          </ul>
          {estado !== "hecho" && <button onClick={importar} disabled={errores.length > 0 || estado === "importando" || plan.length === 0} className="btn-primario mt-4">{estado === "importando" ? "Importando…" : `Importar ${prod(plan.length)}`}</button>}
          {estado === "hecho" && <a href="/productos" className="btn-oscuro mt-4">Ver productos</a>}
        </section>
      )}
    </div>
  );
}
