"use client";
import { useState } from "react";

// Reenvío a la DIAN desde la lista de documentos: usa la misma ruta que «Reenviar a la DIAN» del detalle de la venta
// (solo dueño o administrador; reenvía los documentos rechazados de esa venta con los datos actuales).

async function reenviarVenta(venta: string): Promise<string | null> {
  const r = await fetch(`/api/ventas/${venta}/reenviar`, { method: "POST" }).catch(() => null);
  if (!r) return "Sin conexión: revisa internet e intenta de nuevo.";
  if (r.ok) return null;
  return (await r.json().catch(() => ({}))).error ?? "No se pudo reenviar";
}

export function ReenviarDoc({ venta, numero }: { venta: string; numero: string }) {
  const [enviando, setEnviando] = useState(false);
  const [error, setError] = useState("");
  async function reenviar() {
    setEnviando(true); setError("");
    const e = await reenviarVenta(venta);
    if (!e) { location.reload(); return; }
    setError(e); setEnviando(false);
  }
  return (
    <span className="inline-grid gap-1">
      <button onClick={reenviar} disabled={enviando} aria-label={`Reenviar ${numero} a la DIAN`} className="btn-primario h-9 px-3 text-sm">{enviando ? "Reenviando…" : "Reenviar"}</button>
      {error && <span role="alert" className="text-xs text-alerta max-w-[220px]">{error}</span>}
    </span>
  );
}

/** Reenvía, una tras otra, todas las ventas con documentos rechazados del filtro actual. */
export function ReenviarTodos({ ventas, n }: { ventas: string[]; n: number }) {
  const [hechas, setHechas] = useState<number | null>(null);
  const [errores, setErrores] = useState<string[]>([]);
  async function reenviar() {
    setHechas(0); setErrores([]);
    const malos: string[] = [];
    for (const [i, v] of ventas.entries()) {
      const e = await reenviarVenta(v);
      if (e) malos.push(e);
      setHechas(i + 1);
    }
    if (!malos.length) { location.reload(); return; }
    setErrores([...new Set(malos)]); setHechas(null);
  }
  const ocupado = hechas !== null;
  return (
    <div className="grid gap-1 justify-items-start">
      <button onClick={reenviar} disabled={ocupado} className="btn-primario h-10 text-sm">
        {ocupado ? `Reenviando ${hechas} de ${ventas.length}…` : n === 1 ? "Reenviar el rechazado" : `Reenviar los ${n} rechazados`}
      </button>
      {errores.length > 0 && <p role="alert" className="text-sm text-alerta">{errores.join(" · ")}</p>}
    </div>
  );
}
