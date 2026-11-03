"use client";
import { useState } from "react";

/** Renovación automática con tarjeta: el dueño la puede cancelar (lo pagado sigue vigente hasta su vencimiento). */
export function Renovacion({ cancelada }: { cancelada: boolean }) {
  const [estado, setEstado] = useState<"" | "confirmar" | "enviando">("");
  const [msg, setMsg] = useState(cancelada ? "La renovación automática está cancelada: el plan sigue activo hasta su vencimiento." : "");
  async function cancelar() {
    setEstado("enviando");
    const r = await fetch("/api/suscripcion", { method: "POST" }).catch(() => null);
    const j = await r?.json().catch(() => ({}));
    setMsg(r?.ok ? j.mensaje : j?.error ?? "Sin conexión: inténtalo de nuevo."); setEstado("");
  }
  if (msg) return <p className="text-sm text-muted mt-2">{msg}</p>;
  return estado === "confirmar" || estado === "enviando"
    ? <p className="text-sm mt-2">¿Cancelar la renovación automática? <button onClick={cancelar} disabled={estado === "enviando"} className="font-semibold text-alerta">{estado === "enviando" ? "Cancelando…" : "Sí, cancelar"}</button> · <button onClick={() => setEstado("")} className="font-semibold">No</button></p>
    : <p className="text-sm text-muted mt-2">Se renueva solo con tarjeta. <button onClick={() => setEstado("confirmar")} className="font-semibold text-cruz">Cancelar la renovación</button></p>;
}
