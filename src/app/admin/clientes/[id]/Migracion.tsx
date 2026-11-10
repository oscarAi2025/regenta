"use client";
import { useState } from "react";

type Archivo = { productos?: unknown[]; clientes?: unknown[]; proveedores?: unknown[]; ventas?: unknown[] };
type Paso = { parte: string; resumen: Record<string, number>; cambios?: { nombre: string; accion: string; antes: number; despues: number }[] };
const PARTES = ["clientes", "proveedores", "productos", "ventas"] as const;
const NOMBRE: Record<string, string> = { clientes: "Clientes", proveedores: "Proveedores", productos: "Productos y existencias", ventas: "Historial de ventas y cartera" };
const ETIQUETA: Record<string, string> = {
  crear: "nuevos", completar: "completados", iguales: "sin cambios", actualizar: "ya existían", por_ean: "por código de barras", por_nombre: "por nombre",
  lotes_nuevos: "lotes que entran", lotes_ajustados: "lotes ajustados", en_cero: "productos que quedan en cero", unidades: "unidades finales", valor_costo: "valor a costo",
  historial_nuevas: "documentos al historial", historial_ya_estaban: "ya estaban", historial_actualizadas: "puestos al día con Alegra (estado o saldo)",
  plazo_recortado: "con plazo de más de 180 días (queda su vencimiento de Alegra)", cartera_nuevas: "facturas a cartera", cartera_ya_estaban: "en cartera ya", saldo_cartera: "saldo de cartera", sin_cliente: "sin cliente",
};
const LOTE = 250;

/** Migración desde Alegra: se sube el archivo convertido (productos, clientes, proveedores y ventas), se simula y luego
 *  se aplica por partes. El sistema anterior manda: las existencias quedan exactamente como en el archivo. */
export function Migracion({ empresa }: { empresa: string }) {
  const [datos, setDatos] = useState<Archivo | null>(null);
  const [nombre, setNombre] = useState("");
  const [pasos, setPasos] = useState<Paso[]>([]);
  const [error, setError] = useState("");
  const [ocupado, setOcupado] = useState<"" | "simular" | "aplicar">("");
  const [simulado, setSimulado] = useState(false);
  const [listo, setListo] = useState(false);

  async function leer(f: File | undefined) {
    setError(""); setPasos([]); setSimulado(false); setListo(false); setDatos(null);
    if (!f) return;
    try {
      const j = JSON.parse(await f.text()) as Archivo;
      if (!PARTES.some((p) => Array.isArray(j[p]) && j[p]!.length)) throw new Error();
      setDatos(j); setNombre(f.name);
    } catch { setError("El archivo no es una migración válida (JSON con productos, clientes, proveedores o ventas)"); }
  }

  async function correr(simular: boolean) {
    if (!datos) return;
    setOcupado(simular ? "simular" : "aplicar"); setError(""); setPasos([]); if (simular) setListo(false);
    const hechos: Paso[] = [];
    try {
      for (const parte of PARTES) {
        const filas = datos[parte];
        if (!filas?.length) continue;
        // Al simular las ventas, los clientes aún no existen: se simula igual (la cartera cuenta las que entrarían).
        const trozos = parte === "ventas" ? Array.from({ length: Math.ceil(filas.length / LOTE) }, (_, i) => filas.slice(i * LOTE, (i + 1) * LOTE)) : [filas];
        const total: Paso = { parte, resumen: {} };
        for (const t of trozos) {
          const r = await fetch(`/api/admin/clientes/${empresa}/migracion`, { method: "POST", headers: { "content-type": "application/json" },
            body: JSON.stringify({ parte, simular, ...(parte === "productos" ? { reemplazar: true } : {}), filas: t }) });
          const j = await r.json().catch(() => ({}));
          if (!r.ok) throw new Error(`${NOMBRE[parte]}: ${j.error ?? `error ${r.status}`}`);
          for (const [k, v] of Object.entries(j.resumen as Record<string, number>)) total.resumen[k] = (total.resumen[k] ?? 0) + v;
          if (j.cambios) total.cambios = j.cambios;
        }
        hechos.push(total); setPasos([...hechos]);
      }
      if (simular) setSimulado(true); else setListo(true);
    } catch (e) { setError((e as Error).message + (simular ? "" : ". Lo aplicado antes de este paso quedó guardado: corrige y vuelve a aplicar (no se duplica nada).")); }
    setOcupado("");
  }

  const cuenta = (p: string) => datos?.[p as keyof Archivo]?.length ?? 0;
  return (
    <section className="tarjeta p-5 grid gap-4" aria-label="Migración desde Alegra">
      <div>
        <h2 className="titulo text-xl">Migración desde Alegra</h2>
        <p className="text-sm text-muted">Sube el archivo de migración. Primero se simula; al aplicar, las existencias quedan exactamente como en Alegra (lo demás, en cero, con un ajuste numerado), el historial queda para consulta y lo que se debía entra a la cartera. Nada va a la DIAN ni a la caja. Se puede repetir sin duplicar.</p>
      </div>
      <label className="grid gap-1 text-sm font-semibold w-fit">Archivo de migración (.json)
        <input type="file" accept=".json,application/json" onChange={(e) => void leer(e.target.files?.[0])} className="text-sm font-normal" data-prueba="archivo-migracion" />
      </label>
      {datos && <p className="text-sm">{nombre}: {PARTES.filter((p) => cuenta(p)).map((p) => `${cuenta(p).toLocaleString("es-CO")} ${p}`).join(" · ")}</p>}
      {error && <p role="alert" className="text-sm font-semibold text-alerta">{error}</p>}
      <div className="flex flex-wrap gap-2">
        <button className="btn-borde" disabled={!datos || !!ocupado} onClick={() => void correr(true)}>{ocupado === "simular" ? "Simulando…" : "Simular"}</button>
        <button className="btn-primario" disabled={!datos || !simulado || !!ocupado || listo} onClick={() => void correr(false)}>{ocupado === "aplicar" ? "Aplicando…" : "Aplicar migración"}</button>
      </div>
      {pasos.length > 0 && (
        <div role="status" className="grid gap-3">
          <p className="font-semibold">{listo ? "Migración aplicada" : ocupado === "aplicar" ? "Aplicando…" : simulado ? "Simulación (no se ha cambiado nada)" : "Simulando…"}</p>
          {pasos.map((p) => (
            <div key={p.parte} className="rounded-xl border border-line p-3 text-sm">
              <p className="font-semibold">{NOMBRE[p.parte]}</p>
              <p className="num">{Object.entries(p.resumen).filter(([, v]) => v).map(([k, v]) => `${(k === "valor_costo" || k === "saldo_cartera" ? "$" : "") + Math.round(v).toLocaleString("es-CO")} ${ETIQUETA[k] ?? k}`).join(" · ") || "sin cambios"}</p>
              {p.cambios && p.cambios.length > 0 && (
                <details className="mt-1"><summary className="cursor-pointer text-muted">{p.cambios.length} productos cambian de existencias</summary>
                  <ul className="mt-1 max-h-64 overflow-auto num">{p.cambios.map((c, i) => <li key={i}>{c.nombre}: {c.antes} → {c.despues} ({c.accion})</li>)}</ul>
                </details>
              )}
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
