"use client";
import { useState } from "react";

const ROL: Record<string, string> = { dueno: "Dueño", admin: "Administrador", cajero: "Cajera/o", bodeguero: "Bodega", vendedor: "Vendedor" };
type Miembro = { user_id: string; nombre: string; rol: string; activo: boolean; email: string; activo_cuenta: boolean };

async function enviar(url: string, metodo: string, cuerpo: unknown) {
  const r = await fetch(url, { method: metodo, headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) }).catch(() => null);
  if (!r) return { error: "Sin conexión: revisa internet e intenta de nuevo." };
  const j = await r.json().catch(() => ({}));
  return r.ok ? j : { error: j.error ?? "No se pudo guardar" };
}

export function Configuracion({ inicial, demo }: { inicial: Record<string, string | number>; demo: boolean }) {
  const [d, setD] = useState(inicial);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null), [enviando, setEnviando] = useState(false);
  const campo = (k: string, t: string, tipo = "text", ayuda?: string) => (
    <div>
      <label htmlFor={`cf-${k}`} className="etiqueta">{t}</label>
      <input id={`cf-${k}`} type={tipo} className="campo" value={String(d[k] ?? "")} disabled={demo}
        onChange={(e) => setD({ ...d, [k]: tipo === "number" ? Number(e.target.value) : e.target.value })} />
      {ayuda && <p className="text-xs text-muted mt-1">{ayuda}</p>}
    </div>
  );
  async function guardar(e: React.FormEvent) {
    e.preventDefault(); setEnviando(true); setMsg(null);
    const r = await enviar("/api/configuracion", "PATCH", d);
    setMsg(r.error ? { ok: false, t: r.error } : { ok: true, t: "Datos guardados" }); setEnviando(false);
  }
  return (
    <form onSubmit={guardar} className="tarjeta p-5" aria-label="Datos de la droguería">
      <h2 className="titulo text-xl">Datos de la droguería</h2>
      <p className="text-sm text-muted mt-1">Salen en el tiquete y en los correos. NIT, razón social y régimen de IVA los cambia soporte, porque van en tu habilitación ante la DIAN.</p>
      <div className="mt-4 grid sm:grid-cols-2 gap-3">
        {campo("nombre_comercial", "Nombre comercial")}
        {campo("telefono", "Teléfono")}
        {campo("direccion", "Dirección")}
        {campo("ciudad", "Ciudad")}
        {campo("email", "Correo de la droguería", "email")}
        {campo("descuento_max_cajero", "Descuento máximo de la cajera (%)", "number", "Por encima de este porcentaje solo autoriza el dueño o el administrador.")}
        {campo("egreso_max_cajero", "Salida de caja máxima de la cajera ($)", "number", "Gastos o retiros mayores los registra el dueño o el administrador.")}
      </div>
      {msg && <p role={msg.ok ? "status" : "alert"} className={`mt-3 text-sm font-semibold ${msg.ok ? "text-cruz" : "text-alerta"}`}>{msg.t}</p>}
      {!demo && <button disabled={enviando} className="btn-primario mt-4">{enviando ? "Guardando…" : "Guardar datos"}</button>}
    </form>
  );
}

export function Equipo({ miembros, demo, tope, plan }: { miembros: Miembro[]; demo: boolean; tope: number | null; plan: string }) {
  const [abierto, setAbierto] = useState(false);
  const [n, setN] = useState({ nombre: "", email: "", rol: "cajero" });
  const [msg, setMsg] = useState<{ ok: boolean; t: string; enlace?: string } | null>(null), [enviando, setEnviando] = useState(false);
  const activos = miembros.filter((m) => m.activo).length;
  async function invitar(e: React.FormEvent) {
    e.preventDefault(); setEnviando(true); setMsg(null);
    const r = await enviar("/api/equipo", "POST", n);
    if (r.error) { setMsg({ ok: false, t: r.error }); setEnviando(false); return; }
    setMsg({ ok: true, t: r.mensaje, enlace: r.enlace }); setEnviando(false); setN({ nombre: "", email: "", rol: "cajero" });
    setTimeout(() => location.reload(), r.enlace ? 6000 : 1200);
  }
  async function cambiar(cuenta_id: string, cambio: Record<string, unknown>) {
    const r = await enviar("/api/equipo", "PATCH", { cuenta_id, ...cambio });
    if (r.error) { setMsg({ ok: false, t: r.error }); return; }
    if (r.enlace) { setMsg({ ok: true, t: r.mensaje, enlace: r.enlace }); return; }
    location.reload();
  }
  return (
    <section className="tarjeta p-5" aria-label="Equipo">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="titulo text-xl">Equipo</h2>
          <p className="text-sm text-muted">{activos} usuario{activos === 1 ? "" : "s"} activo{activos === 1 ? "" : "s"}{tope ? ` de ${tope} en tu plan` : " · usuarios ilimitados en tu plan"}. Cada persona entra con su correo y su contraseña: así la auditoría sabe quién hizo qué.
            {plan === "esencial" && " Con Pro, usuarios ilimitados."}</p>
        </div>
        {!abierto && (tope !== null && activos >= tope && !demo
          ? <a href="/contratar?plan=pro" className="btn-borde">Pasar a Pro para más usuarios</a>
          : <button onClick={() => setAbierto(true)} className="btn-primario">Agregar persona</button>)}
      </div>
      {abierto && (
        <form onSubmit={invitar} className="mt-4 grid sm:grid-cols-[1fr_1fr_auto_auto] gap-2 items-end" aria-label="Agregar persona">
          <div><label htmlFor="eq-nombre" className="etiqueta">Nombre</label><input id="eq-nombre" className="campo" required value={n.nombre} onChange={(e) => setN({ ...n, nombre: e.target.value })} /></div>
          <div><label htmlFor="eq-email" className="etiqueta">Correo</label><input id="eq-email" type="email" required className="campo" value={n.email} onChange={(e) => setN({ ...n, email: e.target.value })} /></div>
          <div><label htmlFor="eq-rol" className="etiqueta">Rol</label>
            <select id="eq-rol" className="campo" value={n.rol} onChange={(e) => setN({ ...n, rol: e.target.value })}>
              <option value="cajero">Cajera/o</option><option value="admin">Administrador</option><option value="bodeguero">Bodega</option><option value="vendedor">Vendedor</option>
            </select></div>
          <button disabled={enviando} className="btn-primario">{enviando ? "Enviando…" : "Invitar"}</button>
        </form>
      )}
      {msg && (
        <div role={msg.ok ? "status" : "alert"} className={`mt-3 text-sm ${msg.ok ? "" : "text-alerta font-semibold"}`}>
          {msg.t}
          {msg.enlace && <p className="mt-1 break-all"><span className="text-muted">Enlace (vence en 7 días): </span><a className="text-cruz font-semibold" href={`https://wa.me/?text=${encodeURIComponent("Tu acceso a Regenta: " + msg.enlace)}`} target="_blank" rel="noreferrer">Enviar por WhatsApp</a></p>}
        </div>
      )}
      <ul className="mt-4 divide-y divide-line">
        {miembros.map((m) => (
          <li key={m.user_id} className="py-3 flex flex-wrap items-center gap-3">
            <div className="flex-1 min-w-48">
              <p className={`font-semibold ${m.activo ? "" : "text-muted line-through"}`}>{m.nombre}</p>
              <p className="text-sm text-muted break-all">{m.email} · {ROL[m.rol] ?? m.rol}{!m.activo_cuenta ? " · aún no crea su contraseña" : ""}</p>
            </div>
            {!demo && m.rol !== "dueno" && (
              <div className="flex flex-wrap gap-2">
                {m.activo && <select aria-label={`Rol de ${m.nombre}`} className="campo h-10 w-auto" value={m.rol} onChange={(e) => cambiar(m.user_id, { rol: e.target.value })}>
                  <option value="cajero">Cajera/o</option><option value="admin">Administrador</option><option value="bodeguero">Bodega</option><option value="vendedor">Vendedor</option>
                </select>}
                {m.activo && <button onClick={() => cambiar(m.user_id, { enlace: true })} className="btn-borde">Enviar enlace de acceso</button>}
                <button onClick={() => cambiar(m.user_id, { activo: !m.activo })} className={m.activo ? "btn-peligro" : "btn-borde"}>{m.activo ? "Desactivar" : "Reactivar"}</button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
