"use client";
import { useState } from "react";

export function MiCuenta() {
  const [f, setF] = useState({ actual: "", nueva: "", repetir: "" });
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null), [enviando, setEnviando] = useState(false);
  async function enviar(cuerpo: unknown) {
    setEnviando(true); setMsg(null);
    const r = await fetch("/api/cuenta", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) }).catch(() => null);
    const j = await r?.json().catch(() => ({}));
    setMsg({ ok: !!r?.ok, t: j?.mensaje ?? j?.error ?? "Sin conexión" }); setEnviando(false);
    if (r?.ok) setF({ actual: "", nueva: "", repetir: "" });
  }
  return (
    <>
      <form onSubmit={(e) => { e.preventDefault(); enviar({ accion: "clave", ...f }); }} className="tarjeta p-5 grid gap-3" aria-labelledby="clave-t">
        <h2 id="clave-t" className="titulo text-xl">Cambiar contraseña</h2>
        <div><label htmlFor="c-actual" className="etiqueta">Contraseña actual</label><input id="c-actual" type="password" required autoComplete="current-password" className="campo" value={f.actual} onChange={(e) => setF({ ...f, actual: e.target.value })} /></div>
        <div><label htmlFor="c-nueva" className="etiqueta">Contraseña nueva</label><input id="c-nueva" type="password" required minLength={10} autoComplete="new-password" className="campo" value={f.nueva} onChange={(e) => setF({ ...f, nueva: e.target.value })} />
          <p className="mt-1 text-xs text-muted">Mínimo 10 caracteres, con letras y números.</p></div>
        <div><label htmlFor="c-repetir" className="etiqueta">Repítela</label><input id="c-repetir" type="password" required autoComplete="new-password" className="campo" value={f.repetir} onChange={(e) => setF({ ...f, repetir: e.target.value })} /></div>
        <button disabled={enviando} className="btn-oscuro h-12 disabled:opacity-60">{enviando ? "Guardando…" : "Cambiar contraseña"}</button>
      </form>
      <section className="tarjeta p-5 flex flex-wrap items-center justify-between gap-3" aria-labelledby="sesiones-t">
        <div><h2 id="sesiones-t" className="titulo text-xl">Sesiones abiertas</h2><p className="text-sm text-muted">¿Dejaste Regenta abierto en otro computador o celular? Ciérralo desde aquí; este equipo sigue dentro.</p></div>
        <button onClick={() => enviar({ accion: "cerrar_otras" })} disabled={enviando} className="btn-borde disabled:opacity-60">Cerrar sesión en los demás equipos</button>
      </section>
      {msg && <p role={msg.ok ? "status" : "alert"} className={`font-semibold ${msg.ok ? "text-cruz" : "text-alerta"}`}>{msg.t}</p>}
    </>
  );
}
