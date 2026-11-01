"use client";
import { useState } from "react";

export function BotonBaja({ t }: { t: string }) {
  const [estado, setEstado] = useState<"" | "enviando" | "ok" | "error">("");
  async function bajar() {
    setEstado("enviando");
    const r = await fetch(`/api/correo/baja?t=${encodeURIComponent(t)}`, { method: "POST" }).catch(() => null);
    setEstado(r?.ok ? "ok" : "error");
  }
  if (estado === "ok") return <p role="status" className="tarjeta p-4 font-semibold">Listo. No te enviaremos más correos comerciales.</p>;
  return (
    <div className="grid gap-2">
      <button onClick={bajar} disabled={estado === "enviando"} className="btn-oscuro h-12 text-base disabled:opacity-60">{estado === "enviando" ? "…" : "Sí, dejar de recibirlos"}</button>
      {estado === "error" && <p role="alert" className="text-alerta font-semibold">No se pudo. Inténtalo de nuevo o escríbenos.</p>}
    </div>
  );
}
