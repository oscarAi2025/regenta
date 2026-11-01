"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";

/** Botón de una sola acción de la consola: llama a la API, muestra el resultado y refresca la pantalla. */
export function Accion({ url, metodo = "POST", cuerpo, texto, confirmar, clase = "btn-borde h-10 text-sm", ir }: { url: string; metodo?: string; cuerpo?: unknown; texto: string; confirmar?: string; clase?: string; ir?: string }) {
  const [estado, setEstado] = useState<"" | "enviando" | "pregunta">("");
  const [msg, setMsg] = useState("");
  const router = useRouter();
  async function hacer() {
    if (confirmar && estado !== "pregunta") { setEstado("pregunta"); return; }
    setEstado("enviando"); setMsg("");
    try {
      const r = await fetch(url, { method: metodo, headers: { "content-type": "application/json" }, body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) { setMsg(j.error ?? "No se pudo"); setEstado(""); return; }
      if (j.ir || ir) { location.href = j.ir ?? ir; return; }
      setMsg(j.mensaje ?? ""); setEstado(""); router.refresh();
    } catch { setMsg("Sin conexión"); setEstado(""); }
  }
  return (
    <span className="inline-flex flex-wrap items-center gap-2">
      <button onClick={hacer} disabled={estado === "enviando"} className={`${clase} disabled:opacity-60`}>{estado === "enviando" ? "…" : estado === "pregunta" ? confirmar : texto}</button>
      {estado === "pregunta" && <button onClick={() => setEstado("")} className="text-sm text-muted">Cancelar</button>}
      {msg && <span role="status" className="text-sm text-muted">{msg}</span>}
    </span>
  );
}
