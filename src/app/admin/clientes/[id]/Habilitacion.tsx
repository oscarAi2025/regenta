"use client";
import { useCallback, useEffect, useState } from "react";

type Software = { id: number; tipo: number; produccion: boolean; identificacion: string; estado: string | null; detalle: string | null };
type Resolucion = { tipo_documento: number; prefijo: string; numero: string; desde: number; hasta: number; vence: string | null; activa: boolean };
type Estado = {
  configurado: boolean; conectado?: boolean;
  principal?: { nit: string; nombre: string; es_este: boolean; mismo_nit: boolean };
  certificado?: { nombre: string; vence: string } | null; software?: Software[]; resoluciones?: Resolucion[];
};

const TIPO: Record<number, string> = { 1: "Factura electrónica y notas", 2: "Nómina electrónica", 3: "Documento soporte", 4: "POS electrónico" };
const DOC: Record<number, string> = { 7: "Factura", 4: "Nota débito", 5: "Nota crédito", 11: "Documento soporte", 15: "Nota de ajuste DS", 20: "POS electrónico", 93: "Nota débito POS", 94: "Nota crédito POS" };

/** Habilitación DIAN del cliente en MATIAS: certificado, software, set de pruebas y numeraciones, sin salir de la consola. */
export function Habilitacion({ empresa }: { empresa: string }) {
  const [e, setE] = useState<Estado | null>(null);
  const [error, setError] = useState("");
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [ocupado, setOcupado] = useState("");
  const [f, setF] = useState({ tipo: 1, identificacion: "", pin: "", testsetid: "" });

  const cargar = useCallback(async () => {
    setError("");
    const r = await fetch(`/api/admin/clientes/${empresa}/habilitacion`, { cache: "no-store" }).catch(() => null);
    const j = await r?.json().catch(() => null);
    if (r?.ok) setE(j); else setError(j?.error ?? "No se pudo consultar MATIAS");
  }, [empresa]);
  useEffect(() => { void cargar(); }, [cargar]);

  async function accion(cuerpo: Record<string, unknown>, clave: string) {
    setOcupado(clave); setMsg(null);
    const r = await fetch(`/api/admin/clientes/${empresa}/habilitacion`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) }).catch(() => null);
    const j = await r?.json().catch(() => ({}));
    setOcupado("");
    setMsg(r?.ok ? { ok: true, t: j.mensaje } : { ok: false, t: j?.error ?? "No se pudo completar" });
    if (r?.ok) { if (clave === "software") setF({ tipo: 1, identificacion: "", pin: "", testsetid: "" }); await cargar(); if (clave === "principal") setTimeout(() => location.reload(), 900); }
  }

  const registrados = new Set((e?.software ?? []).filter((s) => s.identificacion || s.produccion).map((s) => s.tipo));
  const tipoSel = registrados.has(f.tipo) ? [1, 3, 4].find((t) => !registrados.has(t)) ?? f.tipo : f.tipo;
  return (
    <section className="tarjeta p-5 grid gap-4" aria-label="Habilitación DIAN">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="titulo text-xl">Habilitación DIAN en MATIAS</h2>
        <button onClick={() => void cargar()} className="btn-borde h-9 text-sm">Actualizar</button>
      </div>
      {error && <p role="alert" className="text-sm font-semibold text-alerta">{error}</p>}
      {!e && !error && <p className="text-muted">Consultando MATIAS…</p>}
      {e && !e.configurado && <p className="text-muted">El servidor está en modo simulado: la habilitación se hace cuando Regenta emita con MATIAS (REGENTA_DIAN=matias y MATIAS_TOKEN).</p>}
      {e?.configurado && e.principal && (
        <>
          {e.principal.mismo_nit && !e.principal.es_este && (
            <div className="rounded-xl border border-line p-4 grid gap-2">
              <p className="font-semibold">Este cliente tiene el NIT de la cuenta principal ({e.principal.nombre})</p>
              <p className="text-sm text-muted">Factura con la cuenta principal de MATIAS (el certificado y el software de esa cuenta), sin UUID de cliente.</p>
              <div><button onClick={() => accion({ accion: "principal" }, "principal")} disabled={!!ocupado} className="btn-oscuro h-10 text-sm">{ocupado === "principal" ? "Conectando…" : "Usar la cuenta principal"}</button></div>
            </div>
          )}
          {!e.conectado ? <p className="text-muted">Conecta el cliente en MATIAS (su UUID, abajo) para ver su habilitación.</p> : (
            <>
              <dl className="grid sm:grid-cols-2 gap-3 text-sm">
                <div className="rounded-xl border border-line p-3"><dt className="etiqueta">Cuenta</dt><dd className="font-semibold">{e.principal.es_este ? `Principal · NIT ${e.principal.nit}` : "Cliente de la casa de software"}</dd></div>
                <div className="rounded-xl border border-line p-3"><dt className="etiqueta">Certificado de firma</dt>
                  <dd className={`font-semibold ${e.certificado ? "text-cruz" : "text-alerta"}`}>{e.certificado ? `Cargado · vence ${e.certificado.vence}` : "Sin certificado: súbelo (.p12 y su contraseña) en el portal de MATIAS"}</dd></div>
              </dl>
              <div>
                <h3 className="font-semibold">Software DIAN</h3>
                {e.software?.length ? (
                  <ul className="mt-2 grid gap-2">{e.software.map((s) => (
                    <li key={s.id} className="rounded-xl border border-line p-3 grid gap-1 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold">{TIPO[s.tipo] ?? `Tipo ${s.tipo}`}</span>
                        <span className={`pastilla h-8 text-[13px] ${s.produccion ? "bg-cruz-soft text-cruz" : "bg-aviso-soft text-aviso"}`}>{s.produccion ? "Producción" : "Habilitación (pruebas)"}</span>
                      </div>
                      <span className="num text-muted break-all">{s.identificacion || "Sin el ID de la DIAN todavía"}</span>
                      <span>Set de pruebas: <b>{s.estado ?? "sin iniciar"}</b>{s.detalle ? <span className="text-muted"> · {s.detalle}</span> : null}</span>
                      {!s.produccion && !!s.identificacion && s.tipo !== 2 && <div><button onClick={() => accion({ accion: "pruebas", software: s.id }, `pruebas${s.id}`)} disabled={!!ocupado} className="btn-oscuro h-9 text-sm mt-1">{ocupado === `pruebas${s.id}` ? "Iniciando…" : "Iniciar set de pruebas"}</button></div>}
                      {s.produccion && s.tipo !== 2 && <div><button onClick={() => accion({ accion: "sincronizar", tipo: s.tipo }, `sinc${s.tipo}`)} disabled={!!ocupado} className="btn-borde h-9 text-sm mt-1">{ocupado === `sinc${s.tipo}` ? "Consultando la DIAN…" : "Traer numeraciones de la DIAN"}</button></div>}
                    </li>
                  ))}</ul>
                ) : <p className="text-sm text-muted mt-1">Ningún software registrado todavía.</p>}
              </div>
              {[1, 3, 4].some((t) => !registrados.has(t)) && (
                <details className="rounded-xl border border-line p-4">
                  <summary className="cursor-pointer font-semibold">Registrar el software que asignó la DIAN</summary>
                  <p className="text-sm text-muted mt-2">En el portal de habilitación de la DIAN, con el usuario del representante legal: modo de operación «Software propio». Copia aquí el ID del software, su PIN y el TestSetId.</p>
                  <div className="mt-3 grid sm:grid-cols-2 gap-3">
                    <label className="grid text-sm"><span className="etiqueta">Tipo</span>
                      <select className="campo" value={tipoSel} onChange={(x) => setF({ ...f, tipo: Number(x.target.value) })}>
                        {[1, 3, 4].filter((t) => !registrados.has(t)).map((t) => <option key={t} value={t}>{TIPO[t]}</option>)}
                      </select></label>
                    <label className="grid text-sm"><span className="etiqueta">ID del software (DIAN)</span>
                      <input className="campo num" value={f.identificacion} onChange={(x) => setF({ ...f, identificacion: x.target.value })} placeholder="96ab0f7c-2ab0-4de4-…" autoComplete="off" /></label>
                    <label className="grid text-sm"><span className="etiqueta">PIN del software</span>
                      <input className="campo num" value={f.pin} onChange={(x) => setF({ ...f, pin: x.target.value.replace(/\D/g, "").slice(0, 5) })} inputMode="numeric" placeholder="5 dígitos" autoComplete="off" /></label>
                    <label className="grid text-sm"><span className="etiqueta">TestSetId</span>
                      <input className="campo num" value={f.testsetid} onChange={(x) => setF({ ...f, testsetid: x.target.value })} placeholder="6142be76-4d36-…" autoComplete="off" /></label>
                  </div>
                  <button onClick={() => accion({ accion: "software", tipo: tipoSel, identificacion: f.identificacion, pin: f.pin, testsetid: f.testsetid }, "software")}
                    disabled={!!ocupado} className="btn-oscuro h-10 text-sm mt-3">{ocupado === "software" ? "Registrando…" : "Registrar software en MATIAS"}</button>
                </details>
              )}
              {!!e.resoluciones?.length && (
                <div>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <h3 className="font-semibold">Numeraciones en MATIAS</h3>
                    <button onClick={() => accion({ accion: "notas" }, "notas")} disabled={!!ocupado} className="btn-borde h-9 text-sm">{ocupado === "notas" ? "Configurando…" : "Configurar las notas en MATIAS"}</button>
                  </div>
                  <ul className="mt-2 grid gap-1 text-sm">{e.resoluciones.map((r) => (
                    <li key={`${r.tipo_documento}${r.prefijo}${r.numero}`} className="flex flex-wrap justify-between gap-2"><span className="font-semibold">{DOC[r.tipo_documento] ?? `Tipo ${r.tipo_documento}`} {r.prefijo}</span>
                      <span className="num text-muted">{r.numero} · {r.desde}–{r.hasta}{r.vence ? ` · vence ${r.vence}` : ""}</span></li>
                  ))}</ul>
                </div>
              )}
            </>
          )}
        </>
      )}
      {msg && <p role="status" className={`text-sm font-semibold ${msg.ok ? "text-cruz" : "text-alerta"}`}>{msg.t}</p>}
    </section>
  );
}
