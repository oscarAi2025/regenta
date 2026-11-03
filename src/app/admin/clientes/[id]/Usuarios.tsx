"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Enlace } from "@/components/admin/Enlace";

type U = { user_id: string; nombre: string; email: string | null; rol: string; rol_nombre: string; activo: boolean; activada: boolean; ultimo: string };

/** Usuarios del cliente: agregar con enlace de invitación, desactivar o generar un enlace nuevo (contraseña olvidada). */
export function Usuarios({ empresa, usuarios }: { empresa: string; usuarios: U[] }) {
  const [f, setF] = useState({ nombre: "", email: "", rol: "cajero" });
  const [enlace, setEnlace] = useState<{ url: string; nombre: string } | null>(null);
  const [error, setError] = useState("");
  const [correo, setCorreo] = useState<{ id: string; v: string } | null>(null);
  const router = useRouter();
  async function llamar(metodo: string, cuerpo: unknown, nombre: string) {
    setError("");
    try {
      const r = await fetch(`/api/admin/clientes/${empresa}/usuarios`, { method: metodo, headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) });
      const j = await r.json();
      if (!r.ok) { setError(j.error ?? "No se pudo"); return; }
      if (j.enlace) setEnlace({ url: j.enlace, nombre });
      router.refresh();
      return true;
    } catch { setError("Sin conexión"); }
  }
  return (
    <section className="tarjeta p-5 grid gap-4" aria-label="Usuarios">
      <h2 className="titulo text-xl">Usuarios</h2>
      <div className="overflow-x-auto">
        <table className="w-full text-[15px] min-w-[680px]">
          <thead className="text-left text-sm text-muted border-b border-line"><tr><th className="py-2 pr-3 font-semibold">Nombre</th><th className="py-2 pr-3 font-semibold">Rol</th><th className="py-2 pr-3 font-semibold">Acceso</th><th className="py-2 font-semibold">Acciones</th></tr></thead>
          <tbody className="divide-y divide-line">
            {usuarios.map((u) => (
              <tr key={u.user_id} className={u.activo ? "" : "text-muted"}>
                <td className="py-2.5 pr-3"><p className="font-semibold">{u.nombre}</p><p className="text-sm text-muted">{u.email ?? "sin cuenta (usuario de demo)"}</p></td>
                <td className="py-2.5 pr-3">
                  <label className="sr-only" htmlFor={`rol-${u.user_id}`}>Rol de {u.nombre}</label>
                  <select id={`rol-${u.user_id}`} className="campo h-9 text-sm w-40" value={u.rol} disabled={!u.email} onChange={(e) => llamar("PATCH", { cuenta_id: u.user_id, rol: e.target.value }, u.nombre)}>
                    <option value="dueno">Dueño</option><option value="admin">Administrador</option><option value="cajero">Cajera/o</option><option value="bodeguero">Bodega</option>
                  </select>
                </td>
                <td className="py-2.5 pr-3 text-sm">{!u.activo ? "Desactivado" : u.activada ? `Último ingreso: ${u.ultimo}` : "Falta activar (enlace pendiente)"}</td>
                <td className="py-2.5"><div className="flex flex-wrap gap-2">
                  {u.email && <button onClick={() => llamar("PATCH", { cuenta_id: u.user_id, enlace: true }, u.nombre)} className="btn-borde h-9 text-sm">{u.activada ? "Restablecer contraseña" : "Nuevo enlace"}</button>}
                  {u.email && (correo?.id === u.user_id
                    ? <form onSubmit={async (e) => { e.preventDefault(); if (await llamar("PATCH", { cuenta_id: u.user_id, email: correo.v }, u.nombre)) setCorreo(null); }} className="flex gap-2">
                        <label className="sr-only" htmlFor={`correo-${u.user_id}`}>Correo nuevo de {u.nombre}</label>
                        <input id={`correo-${u.user_id}`} type="email" required className="campo h-9 text-sm w-56" value={correo.v} onChange={(e) => setCorreo({ id: u.user_id, v: e.target.value })} />
                        <button className="btn-oscuro h-9 text-sm">Guardar correo</button><button type="button" onClick={() => setCorreo(null)} className="text-sm text-muted">Cancelar</button>
                      </form>
                    : <button onClick={() => setCorreo({ id: u.user_id, v: u.email ?? "" })} className="btn-borde h-9 text-sm">Cambiar correo</button>)}
                  <button onClick={() => llamar("PATCH", { cuenta_id: u.user_id, activo: !u.activo }, u.nombre)} className={`${u.activo ? "btn-peligro" : "btn-primario"} h-9 text-sm`}>{u.activo ? "Desactivar" : "Activar"}</button>
                </div></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {enlace && <Enlace enlace={enlace.url} nombre={enlace.nombre} />}
      <form onSubmit={async (e) => { e.preventDefault(); if (await llamar("POST", f, f.nombre)) setF({ nombre: "", email: "", rol: "cajero" }); }} className="grid sm:grid-cols-[1fr_1fr_160px_auto] gap-2 items-end border-t border-line pt-4">
        <div><label htmlFor="u-nombre" className="etiqueta">Nombre</label><input id="u-nombre" required className="campo" value={f.nombre} onChange={(e) => setF({ ...f, nombre: e.target.value })} /></div>
        <div><label htmlFor="u-email" className="etiqueta">Correo</label><input id="u-email" required type="email" className="campo" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></div>
        <div><label htmlFor="u-rol" className="etiqueta">Rol</label><select id="u-rol" className="campo" value={f.rol} onChange={(e) => setF({ ...f, rol: e.target.value })}><option value="cajero">Cajera/o</option><option value="bodeguero">Bodega</option><option value="admin">Administrador</option><option value="dueno">Dueño</option></select></div>
        <button className="btn-oscuro h-11">Agregar usuario</button>
      </form>
      {error && <p role="alert" className="text-alerta text-sm font-semibold">{error}</p>}
    </section>
  );
}
