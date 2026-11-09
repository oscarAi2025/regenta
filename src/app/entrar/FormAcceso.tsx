"use client";
import { useState } from "react";

/** Entrar con correo y contraseña (clientes y equipo de Regenta). */
export function FormAcceso({ consola = false }: { consola?: boolean }) {
  const [email, setEmail] = useState(""), [clave, setClave] = useState("");
  const [error, setError] = useState(""), [enviando, setEnviando] = useState(false), [renovar, setRenovar] = useState("");
  const [opciones, setOpciones] = useState<{ id: string; nombre: string; rol: string }[] | null>(null);
  // Consola: después de la contraseña, el código de 6 cifras de la app de autenticación.
  const [pideCodigo, setPideCodigo] = useState(false), [codigo, setCodigo] = useState("");
  async function entrar(e: React.FormEvent | null, empresa?: string) {
    e?.preventDefault();
    if (enviando) return;
    setEnviando(true); setError("");
    try {
      const r = await fetch("/api/acceso", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, clave, consola, empresa, ...(pideCodigo ? { codigo } : {}) }) });
      const j = await r.json();
      if (j.codigo) { setPideCodigo(true); setCodigo(""); if (j.error) setError(j.error); return; }
      if (!r.ok) { setError(j.error ?? "No se pudo entrar"); setRenovar(typeof j.renovar === "string" && j.renovar.startsWith("/contratar") ? j.renovar : ""); return; }
      if (j.elegir) { setOpciones(j.elegir); return; }
      location.href = j.destino;
    } catch { setError("Sin conexión con el servidor: revisa internet."); } finally { setEnviando(false); }
  }
  const ROL: Record<string, string> = { dueno: "Dueño", admin: "Administrador", cajero: "Cajera/o", bodeguero: "Bodega" };
  if (opciones) return (
    <div className="mt-5 grid gap-2" role="group" aria-label="Elige la droguería">
      <p className="font-semibold">¿A cuál droguería entras?</p>
      {opciones.map((o) => <button key={o.id} onClick={() => entrar(null, o.id)} disabled={enviando} className="btn-borde h-12 justify-between"><span className="truncate">{o.nombre}</span><span className="text-sm text-muted">{ROL[o.rol] ?? o.rol}</span></button>)}
      {error && <p role="alert" className="text-alerta text-sm font-semibold">{error}</p>}
      {error && renovar && <a href={renovar} className="btn-primario h-12">Renovar mi plan</a>}
    </div>
  );
  return (
    <form onSubmit={entrar} className="mt-5 grid gap-3" aria-label="Entrar con tu cuenta">
      <div><label htmlFor="a-email" className="etiqueta">Correo</label><input id="a-email" type="email" required autoComplete="username" className="campo" value={email} onChange={(e) => setEmail(e.target.value)} /></div>
      <div><label htmlFor="a-clave" className="etiqueta">Contraseña</label><input id="a-clave" type="password" required autoComplete="current-password" className="campo" value={clave} onChange={(e) => setClave(e.target.value)} /></div>
      {pideCodigo && <div><label htmlFor="a-codigo" className="etiqueta">Código de tu app de autenticación</label>
        <input id="a-codigo" inputMode="numeric" autoComplete="one-time-code" required autoFocus maxLength={7} className="campo num text-xl tracking-[0.3em]" value={codigo} onChange={(e) => setCodigo(e.target.value.replace(/[^\d ]/g, ""))} /></div>}
      {error && <p role="alert" className="text-alerta text-sm font-semibold">{error}</p>}
      {error && renovar && <a href={renovar} className="btn-primario h-12">Renovar mi plan</a>}
      <button disabled={enviando} className="btn-oscuro h-12 disabled:opacity-60">{enviando ? "Entrando…" : "Entrar"}</button>
      {!consola && <Olvide email={email} />}
    </form>
  );
}

/** Enlace para crear una contraseña nueva, sin salir de la pantalla de entrada. */
function Olvide({ email: inicial }: { email: string }) {
  const [abierto, setAbierto] = useState(false), [email, setEmail] = useState(inicial);
  const [mensaje, setMensaje] = useState(""), [enviando, setEnviando] = useState(false);
  if (!abierto) return <button type="button" onClick={() => { setEmail(inicial); setAbierto(true); }} className="text-sm font-semibold text-cruz text-left py-1.5 -my-1.5 self-start">¿Olvidaste tu contraseña?</button>;
  async function pedir() {
    setEnviando(true); setMensaje("");
    const r = await fetch("/api/restablecer", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    setMensaje(r ? (j.mensaje ?? j.error ?? "No se pudo enviar") : "Sin conexión con el servidor: revisa internet."); setEnviando(false);
  }
  return (
    <div className="border-t border-line pt-3 grid gap-2" aria-label="Crear una contraseña nueva">
      <label htmlFor="r-email" className="etiqueta">Correo de tu cuenta</label>
      <input id="r-email" type="email" className="campo" value={email} onChange={(e) => setEmail(e.target.value)} />
      <button type="button" onClick={pedir} disabled={enviando || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)} className="btn-borde disabled:opacity-60">{enviando ? "Enviando…" : "Enviarme el enlace"}</button>
      {mensaje && <p role="status" className="text-sm">{mensaje}</p>}
    </div>
  );
}
