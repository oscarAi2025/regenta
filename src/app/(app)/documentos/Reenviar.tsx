"use client";
import { useState } from "react";

// Reenvío a la DIAN desde la lista de documentos: los de una venta usan la misma ruta que «Reenviar a la DIAN» del detalle
// de la venta; el documento soporte, su nota de ajuste y la nota débito se reenvían uno por uno. Solo dueño o administrador.

async function reenviar(url: string): Promise<string | null> {
  const r = await fetch(url, { method: "POST" }).catch(() => null);
  if (!r) return "Sin conexión: revisa internet e intenta de nuevo.";
  if (r.ok) return null;
  return (await r.json().catch(() => ({}))).error ?? "No se pudo reenviar";
}

export function ReenviarDoc({ url, numero }: { url: string; numero: string }) {
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  async function uno() {
    setEnviando(true); setError("");
    const e = await reenviar(url);
    if (!e) { location.reload(); return; }
    setError(e); setEnviando(false);
  }
  return (
    <span className="inline-grid gap-1">
      <button onClick={uno} disabled={enviando} aria-label={`Reenviar ${numero} a la DIAN`} className="btn-primario h-9 px-3 text-sm">{enviando ? "Reenviando…" : "Reenviar"}</button>
      {error && <span role="alert" className="text-xs text-alerta max-w-[220px]">{error}</span>}
    </span>
  );
}

/** Reenvía, uno tras otro, todos los documentos rechazados del filtro actual (por venta o por documento). */
export function ReenviarTodos({ rutas, n }: { rutas: string[]; n: number }) {
  const [hechas, setHechas] = useState<number | null>(null);
  const [errores, setErrores] = useState<string[]>([]);
  async function todos() {
    setHechas(0); setErrores([]);
    const malos: string[] = [];
    for (const [i, v] of rutas.entries()) {
      const e = await reenviar(v);
      if (e) malos.push(e);
      setHechas(i + 1);
    }
    if (!malos.length) { location.reload(); return; }
    setErrores([...new Set(malos)]); setHechas(null);
  }
  const ocupado = hechas !== null;
  return (
    <div className="grid gap-1 justify-items-start">
      <button onClick={todos} disabled={ocupado} className="btn-primario h-10 text-sm">
        {ocupado ? `Reenviando ${hechas} de ${rutas.length}…` : n === 1 ? "Reenviar el rechazado" : `Reenviar los ${n} rechazados`}
      </button>
      {errores.length > 0 && <p role="alert" className="text-sm text-alerta">{errores.join(" · ")}</p>}
    </div>
  );
}
