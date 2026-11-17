"use client";
/** Cerrar la sesión de consulta (computador de mostrador compartido). */
export function Salir() {
  return <button className="text-sm text-muted underline" onClick={async () => { await fetch("/api/sesion", { method: "DELETE" }); location.href = "/entrar"; }}>Cerrar sesión</button>;
}
