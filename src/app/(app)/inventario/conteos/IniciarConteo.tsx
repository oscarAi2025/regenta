"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

/** Iniciar un conteo físico: todo el inventario o solo un laboratorio o una categoría. */
export function IniciarConteo({ laboratorios, categorias }: { laboratorios: string[]; categorias: string[] }) {
  const router = useRouter();
  const [alcance, setAlcance] = useState<"todo" | "laboratorio" | "categoria">("todo");
  const [filtro, setFiltro] = useState("");
  const [obs, setObs] = useState("");
  const [ciegas, setCiegas] = useState(false);
  const [error, setError] = useState("");
  const [enviando, setEnviando] = useState(false);
  const opciones = alcance === "laboratorio" ? laboratorios : alcance === "categoria" ? categorias : [];

  async function iniciar(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    if (alcance !== "todo" && !filtro) { setError(`Elige ${alcance === "laboratorio" ? "el laboratorio" : "la categoría"} que vas a contar.`); document.getElementById("filtro-conteo")?.focus(); return; }
    setEnviando(true);
    const r = await fetch("/api/inventario/conteos", { method: "POST", headers: { "content-type": "application/json" },
      body: JSON.stringify({ alcance, filtro: alcance === "todo" ? null : filtro, observaciones: obs.trim() || null, a_ciegas: ciegas }) }).catch(() => null);
    const j = await r?.json().catch(() => ({}));
    if (!r?.ok) { setEnviando(false); setError(j?.error ?? "Sin conexión: revisa internet e intenta de nuevo."); return; }
    router.push(`/inventario/conteos/${j.id}`);
  }

  type Alcance = "todo" | "laboratorio" | "categoria";
  const tipos: [Alcance, string][] = [["todo", "Todo el inventario"], ["laboratorio", "Un laboratorio"], ...(categorias.length ? [["categoria", "Una categoría"] as [Alcance, string]] : [])];
  return (
    <form onSubmit={iniciar} className="tarjeta p-4 sm:p-5 grid gap-4" aria-labelledby="iniciar-t">
      <div><h2 id="iniciar-t" className="titulo text-xl">Iniciar un conteo</h2>
        <p className="text-sm text-muted">Entran todos los lotes con existencias. Mientras cuentas puedes seguir vendiendo: al cerrar, Regenta compara con las existencias de ese momento.</p></div>
      <fieldset className="grid gap-2">
        <legend className="etiqueta">¿Qué vas a contar?</legend>
        <div className="flex flex-wrap gap-2">
          {tipos.map(([k, t]) => (
            <label key={k} className={`flex items-center gap-2 rounded-xl border-2 px-3 h-11 cursor-pointer font-semibold text-[15px] has-[:focus-visible]:outline has-[:focus-visible]:outline-[3px] has-[:focus-visible]:outline-marca ${alcance === k ? "border-ink bg-paper" : "border-line bg-surface"}`}>
              <input type="radio" name="alcance" value={k} checked={alcance === k} onChange={() => { setAlcance(k); setFiltro(""); }} className="accent-[var(--ink)] w-4 h-4" />{t}
            </label>
          ))}
        </div>
      </fieldset>
      {alcance !== "todo" && (
        <div className="max-w-md">
          <label htmlFor="filtro-conteo" className="etiqueta">{alcance === "laboratorio" ? "Laboratorio" : "Categoría"}</label>
          <select id="filtro-conteo" value={filtro} onChange={(e) => setFiltro(e.target.value)} className="campo">
            <option value="">Elige…</option>
            {opciones.map((o) => <option key={o} value={o}>{o}</option>)}
          </select>
        </div>
      )}
      <div className="max-w-xl">
        <label htmlFor="obs-conteo" className="etiqueta">Observaciones (opcional)</label>
        <input id="obs-conteo" value={obs} onChange={(e) => setObs(e.target.value)} maxLength={500} className="campo" placeholder="Ej.: conteo de cierre de mes, estantería 1 a 4" />
      </div>
      <label className="flex items-start gap-2.5 text-[15px] max-w-2xl">
        <input type="checkbox" checked={ciegas} onChange={(e) => setCiegas(e.target.checked)} className="mt-1 w-4 h-4 accent-[var(--ink)]" />
        <span><b>Conteo a ciegas</b><span className="block text-sm text-muted">Quien cuenta no ve cuánto dice el sistema: cuenta lo que hay, sin dejarse llevar por la cifra. Las diferencias las ven el dueño y el administrador en el informe y, al cerrar, todos.</span></span>
      </label>
      {error && <p role="alert" className="text-alerta font-semibold">{error}</p>}
      <div><button disabled={enviando} className="btn-primario">{enviando ? "Preparando…" : "Empezar a contar"}</button></div>
    </form>
  );
}
