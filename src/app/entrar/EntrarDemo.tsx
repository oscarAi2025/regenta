"use client";
import { useState } from "react";

const DEMO = [
  { uid: "00000000-0000-4000-8000-000000000002", nombre: "Laura", rol: "Cajera", texto: "Vende y cobra. No ve costos ni puede anular." },
  { uid: "00000000-0000-4000-8000-000000000001", nombre: "Carlos", rol: "Dueño", texto: "Ve todo: márgenes, costos, auditoría y anulaciones." },
  { uid: "00000000-0000-4000-8000-000000000003", nombre: "Andrés", rol: "Bodega", texto: "Recibe mercancía y ajusta inventario. No vende." },
];

export function EntrarDemo() {
  const [cargando, setCargando] = useState<string | null>(null);
  const [error, setError] = useState("");
  async function entrar(uid: string) {
    setCargando(uid); setError("");
    const r = await fetch("/api/sesion", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ uid }) });
    if (r.ok) { location.href = (await r.json()).rol === "bodeguero" ? "/inventario" : "/caja"; return; }
    setError((await r.json().catch(() => ({}))).error ?? "No se pudo entrar"); setCargando(null);
  }
  return (
    <div className="mt-6">
      <p className="text-muted">Droguería Demo · elige con qué usuario entrar:</p>
      <ul className="mt-4 grid gap-3">
        {DEMO.map((u) => (
          <li key={u.uid}>
            <button onClick={() => entrar(u.uid)} disabled={!!cargando}
              className="w-full text-left bg-surface border border-line rounded-xl px-5 py-4 hover:border-ink transition-colors disabled:opacity-60 flex items-center gap-4">
              <span className="grid place-items-center size-11 rounded-full bg-paper font-cond text-xl text-ink shrink-0" style={{ fontWeight: 700 }}>{u.nombre[0]}</span>
              <span className="flex-1">
                <span className="block font-semibold">{u.nombre} <span className="text-muted font-normal">· {u.rol}</span></span>
                <span className="block text-sm text-muted">{u.texto}</span>
              </span>
              <span className="text-sm text-cruz font-semibold">{cargando === u.uid ? "Entrando…" : "Entrar"}</span>
            </button>
          </li>
        ))}
      </ul>
      {error && <p role="alert" className="mt-4 text-alerta">{error}</p>}
    </div>
  );
}
