"use client";
import Link from "next/link";
import { useState } from "react";

export function Activar({ token }: { token: string }) {
  const [clave, setClave] = useState(""), [repetir, setRepetir] = useState("");
  const [error, setError] = useState(""), [listo, setListo] = useState(""), [enviando, setEnviando] = useState(false);
  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (enviando) return;
    setEnviando(true); setError("");
    try {
      const r = await fetch("/api/activar", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token, clave, repetir }) });
      const j = await r.json();
      if (!r.ok) { setError(j.error ?? "No se pudo activar"); return; }
      setListo(j.email);
    } catch { setError("Sin conexión con el servidor."); } finally { setEnviando(false); }
  }
  if (!token) return <p className="mt-6 text-alerta">Este enlace está incompleto. Pide uno nuevo por WhatsApp.</p>;
  if (listo) return (
    <div className="mt-6 grid gap-4">
      <p className="rounded-xl bg-cruz-soft text-cruz px-4 py-3 font-semibold">Listo. Tu cuenta {listo} está activa.</p>
      <Link href="/entrar" className="btn-oscuro h-12">Entrar a Regenta</Link>
    </div>
  );
  return (
    <form onSubmit={guardar} className="mt-6 grid gap-3">
      <div><label htmlFor="v-clave" className="etiqueta">Contraseña nueva</label><input id="v-clave" type="password" required minLength={10} autoComplete="new-password" className="campo" value={clave} onChange={(e) => setClave(e.target.value)} />
        <p className="mt-1 text-xs text-muted">Mínimo 10 caracteres, con letras y números.</p></div>
      <div><label htmlFor="v-repetir" className="etiqueta">Repítela</label><input id="v-repetir" type="password" required autoComplete="new-password" className="campo" value={repetir} onChange={(e) => setRepetir(e.target.value)} /></div>
      {error && <p role="alert" className="text-alerta text-sm font-semibold">{error}</p>}
      <button disabled={enviando} className="btn-oscuro h-12 disabled:opacity-60">{enviando ? "Guardando…" : "Activar mi cuenta"}</button>
    </form>
  );
}
