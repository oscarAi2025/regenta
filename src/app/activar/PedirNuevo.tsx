"use client";
import { useState } from "react";

/** Botón para pedir un enlace nuevo cuando el de la invitación venció o ya se usó (llega al correo de la cuenta). */
export function PedirNuevo({ token }: { token: string }) {
  const [msg, setMsg] = useState(""), [enviando, setEnviando] = useState(false);
  async function pedir() {
    setEnviando(true);
    const r = await fetch("/api/activar/nuevo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token }) }).catch(() => null);
    const j = await r?.json().catch(() => ({}));
    setMsg(j?.mensaje ?? j?.error ?? "Sin conexión. Inténtalo de nuevo."); setEnviando(false);
  }
  if (msg) return <p role="status" className="mt-4 rounded-xl bg-cruz-soft text-cruz px-4 py-3 font-semibold">{msg}</p>;
  return <button onClick={pedir} disabled={enviando} className="btn-oscuro h-12 mt-4 w-full disabled:opacity-60">{enviando ? "Enviando…" : "Envíame un enlace nuevo"}</button>;
}
