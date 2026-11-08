"use client";
import { useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AREAS, AREA_CORTA, JORNADAS, celdas, dec, diaCorto, diaLargo, fueraDeRango, nombreCorto, rangoTexto,
  type Area, type Celda, type Jornada, type Rango, type Registro,
} from "@/lib/temperatura-comun";

type Slot = { fecha: string; jornada: Jornada; area: Area };
type Props = {
  mes: string; hoy: string; jornada: Jornada; registros: Registro[]; rangos: Rango[]; inicio: Partial<Record<Area, string>>;
  puedeRegistrar: boolean; limite: string; // fecha más antigua que se puede registrar (7 días atrás)
  children?: React.ReactNode; // va debajo del formulario (rangos)
};

const num = (t: string) => { const v = t.trim().replace(",", "."); return v === "" || !/^-?\d+(\.\d+)?$/.test(v) ? null : Number(v); };
const igual = (a: Slot, b: Slot) => a.fecha === b.fecha && a.jornada === b.jornada && a.area === b.area;

/** Planilla del mes: registrar la jornada (con alerta inmediata fuera de rango), ver qué falta y corregir sin borrar. */
export function Planilla({ mes, hoy, jornada, registros: deServidor, rangos, inicio: inicioServidor, puedeRegistrar, limite, children }: Props) {
  const router = useRouter();
  // Los datos del mes vienen del servidor y, al guardar, de la respuesta de la API: la planilla se actualiza al instante.
  const [datos, setDatos] = useState({ registros: deServidor, inicio: inicioServidor });
  const [previos, setPrevios] = useState({ registros: deServidor, inicio: inicioServidor });
  if (previos.registros !== deServidor || previos.inicio !== inicioServidor) {
    setPrevios({ registros: deServidor, inicio: inicioServidor });
    setDatos({ registros: deServidor, inicio: inicioServidor });
  }
  const { registros, inicio } = datos;
  const [slot, setSlot] = useState<Slot>({ fecha: hoy, jornada, area: "general" });
  const [temp, setTemp] = useState(""), [hum, setHum] = useState(""), [accion, setAccion] = useState(""), [obs, setObs] = useState(""), [motivo, setMotivo] = useState("");
  const [verObs, setVerObs] = useState(false);
  const [corrigiendo, setCorrigiendo] = useState<Registro | null>(null);
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [enviando, setEnviando] = useState(false);
  const [vista, setVista] = useState<Area>("general");
  const [elegida, setElegida] = useState<Slot | null>(null);
  const formRef = useRef<HTMLElement>(null), tempRef = useRef<HTMLInputElement>(null), detalleRef = useRef<HTMLElement>(null);

  const rango = rangos.find((r) => r.area === slot.area)!;
  const t = num(temp), h = num(hum);
  const fuera = fueraDeRango(rango, t, h);
  const yaRegistrado = !corrigiendo ? registros.find((r) => r.vigente && igual(r, slot)) : undefined;
  const tabla = useMemo(() => celdas(mes, vista, registros, inicio[vista] ?? null, hoy), [mes, vista, registros, inicio, hoy]);
  const vigentes = registros.filter((r) => r.vigente);
  const faltas = (Object.keys(AREAS) as Area[]).reduce((n, a) => n + Object.values(celdas(mes, a, registros, inicio[a] ?? null, hoy)).reduce((m, d) => m + Object.values(d).filter((c) => c.estado === "falta").length, 0), 0);
  const detalle = elegida ? celdas(mes, elegida.area, registros, inicio[elegida.area] ?? null, hoy)[elegida.fecha]?.[elegida.jornada] : null;

  function limpiar() { setTemp(""); setHum(""); setAccion(""); setObs(""); setMotivo(""); setVerObs(false); setCorrigiendo(null); }
  function irAlFormulario(s: Slot, corregir: Registro | null = null) {
    limpiar(); setMsg(null); setSlot(s); setCorrigiendo(corregir);
    if (corregir) { setTemp(dec(corregir.temperatura)); setHum(corregir.humedad === null ? "" : dec(corregir.humedad)); setObs(corregir.observacion ?? ""); setVerObs(!!corregir.observacion); }
    requestAnimationFrame(() => { formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }); tempRef.current?.focus({ preventScroll: true }); });
  }
  function tocarCelda(dia: string, j: Jornada, c: Celda) {
    const s = { fecha: dia, jornada: j, area: vista };
    if (c.estado === "registrado") { setElegida(s); requestAnimationFrame(() => detalleRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" })); return; }
    if (puedeRegistrar && (c.estado === "falta" || c.estado === "hoy") && dia >= limite) { setElegida(null); irAlFormulario(s); return; }
    setElegida(s);
  }

  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    if (t === null) { setMsg({ ok: false, t: "Escribe la temperatura (por ejemplo 22,5)" }); tempRef.current?.focus(); return; }
    if (hum.trim() && h === null) { setMsg({ ok: false, t: "Revisa la humedad: escribe solo el número (por ejemplo 55)" }); return; }
    if (slot.area === "general" && h === null) { setMsg({ ok: false, t: "Escribe la humedad relativa" }); return; }
    if (fuera.length && accion.trim().length < 5) { setMsg({ ok: false, t: "Escribe la acción correctiva: el valor está fuera del rango configurado por tu droguería" }); return; }
    if (corrigiendo && motivo.trim().length < 4) { setMsg({ ok: false, t: "Escribe el motivo de la corrección" }); return; }
    setEnviando(true); setMsg(null);
    const cuerpo = corrigiendo
      ? { anula_id: corrigiendo.id, motivo, temperatura: t, humedad: h, accion: fuera.length ? accion : null, observacion: obs || null }
      : { ...slot, temperatura: t, humedad: h, accion: fuera.length ? accion : null, observacion: obs || null };
    const r = await fetch("/api/temperatura", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(cuerpo) }).catch(() => null);
    setEnviando(false);
    if (!r) { setMsg({ ok: false, t: "Sin conexión: revisa internet e intenta de nuevo." }); return; }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { setMsg({ ok: false, t: j.error ?? "No se pudo guardar" }); return; }
    const fueCorreccion = !!corrigiendo;
    limpiar();
    setMsg({ ok: true, t: fueCorreccion ? "Corrección guardada. El registro anterior queda en el historial." : j.registro?.fuera_rango ? "Registro guardado fuera de rango, con su acción correctiva." : "Registro guardado." });
    setElegida(fueCorreccion ? slot : null);
    if (j.mes?.mes === mes) setDatos({ registros: j.mes.registros, inicio: j.mes.inicio });
    router.refresh(); // el resto de la pantalla (resumen e informe) también se pone al día
  }

  const etiquetaSlot = `${slot.fecha === hoy ? "Hoy" : diaLargo(slot.fecha).replace(/^./, (x) => x.toUpperCase())}, ${JORNADAS[slot.jornada].toLowerCase()}`;
  const chip = (activo: boolean) => `h-11 px-4 rounded-xl border-2 font-semibold text-[15px] transition-colors ${activo ? "border-ink bg-ink text-white" : "border-line bg-surface hover:border-ink"}`;

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[400px_minmax(0,1fr)] gap-5 items-start">
      <div className="grid gap-5">
        {puedeRegistrar && (
          <section ref={formRef} className={`tarjeta p-5 scroll-mt-4 ${corrigiendo ? "border-aviso" : ""}`} aria-label={corrigiendo ? "Corregir registro" : "Registrar"}>
            <h2 className="titulo text-xl">{corrigiendo ? "Corregir registro" : "Registrar"}</h2>
            <p className="text-sm text-muted">{etiquetaSlot} · {AREAS[slot.area]}</p>
            {corrigiendo ? (
              <p className="mt-3 rounded-xl bg-aviso-soft px-3 py-2 text-sm">
                Se guarda un registro nuevo que reemplaza a <b className="num">{dec(corrigiendo.temperatura)} °C{corrigiendo.humedad !== null ? ` · ${dec(corrigiendo.humedad)} %` : ""}</b> ({nombreCorto(corrigiendo.responsable)}, {corrigiendo.creado}). El anterior no se borra: queda en el historial con el motivo.
              </p>
            ) : (
              <>
                <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="Área">
                  {(Object.keys(AREAS) as Area[]).map((a) => <button key={a} type="button" aria-pressed={slot.area === a} onClick={() => { setSlot({ ...slot, area: a }); setMsg(null); }} className={chip(slot.area === a)}>{AREA_CORTA[a]}</button>)}
                </div>
                <div className="mt-2 flex flex-wrap gap-2" role="group" aria-label="Jornada">
                  {(Object.keys(JORNADAS) as Jornada[]).map((x) => <button key={x} type="button" aria-pressed={slot.jornada === x} onClick={() => { setSlot({ ...slot, jornada: x }); setMsg(null); }} className={chip(slot.jornada === x)}>{JORNADAS[x]}</button>)}
                  {slot.fecha !== hoy && <button type="button" onClick={() => setSlot({ ...slot, fecha: hoy })} className="h-11 px-3 text-sm font-semibold text-cruz">Volver a hoy</button>}
                </div>
              </>
            )}

            {yaRegistrado ? (
              <div className="mt-4 rounded-xl border border-line bg-paper/60 p-3 grid gap-2">
                <p className="text-[15px]"><b>Esta jornada ya está registrada:</b> <span className={`num font-semibold ${yaRegistrado.fuera_rango ? "text-alerta" : ""}`}>{dec(yaRegistrado.temperatura)} °C{yaRegistrado.humedad !== null ? ` · ${dec(yaRegistrado.humedad)} %` : ""}</span>, por {nombreCorto(yaRegistrado.responsable)} el {yaRegistrado.creado}.</p>
                <button type="button" onClick={() => irAlFormulario(slot, yaRegistrado)} className="btn-borde justify-self-start h-10">Corregir</button>
              </div>
            ) : (
              <form onSubmit={guardar} className="mt-4 grid gap-3" noValidate>
                <div className="grid grid-cols-2 gap-3">
                  <label className="grid gap-1 text-sm font-semibold">Temperatura (°C)
                    <input ref={tempRef} id="t-temp" inputMode="decimal" autoComplete="off" value={temp} onChange={(e) => setTemp(e.target.value)} placeholder="22,5"
                      aria-invalid={fuera.some((x) => x.startsWith("temperatura")) || undefined} className={`campo num text-xl font-semibold ${fuera.some((x) => x.startsWith("temperatura")) ? "border-alerta" : ""}`} />
                  </label>
                  <label className="grid gap-1 text-sm font-semibold">Humedad relativa (%){slot.area === "frio" && <span className="sr-only"> (opcional)</span>}
                    <input id="t-hum" inputMode="decimal" autoComplete="off" value={hum} onChange={(e) => setHum(e.target.value)} placeholder={slot.area === "frio" ? "Opcional" : "55"}
                      aria-invalid={fuera.some((x) => x.startsWith("humedad")) || undefined} className={`campo num text-xl font-semibold ${fuera.some((x) => x.startsWith("humedad")) ? "border-alerta" : ""}`} />
                  </label>
                </div>
                <p className="text-xs text-muted">Rango configurado por tu droguería: {rangoTexto(rango.temp_min, rango.temp_max, "°C")}{rango.hum_min !== null ? ` · humedad ${rangoTexto(rango.hum_min, rango.hum_max, "%")}` : ""}.</p>
                {fuera.length > 0 && (
                  <div role="alert" className="rounded-xl border-2 border-alerta bg-alerta-soft p-3 grid gap-2">
                    <p className="font-semibold text-alerta">Fuera del rango configurado por tu droguería: {fuera.join(" y ")}.</p>
                    <label className="grid gap-1 text-sm font-semibold">Acción correctiva (obligatoria)
                      <textarea id="t-accion" value={accion} onChange={(e) => setAccion(e.target.value)} rows={2} maxLength={500} required
                        placeholder="Ej.: se encendió el aire, se movieron los productos a la otra nevera y se avisó a la regente" className="campo h-auto py-2 font-normal" />
                    </label>
                  </div>
                )}
                {verObs ? (
                  <label className="grid gap-1 text-sm font-semibold">Observación (opcional)
                    <textarea id="t-obs" value={obs} onChange={(e) => setObs(e.target.value)} rows={2} maxLength={500} className="campo h-auto py-2 font-normal" />
                  </label>
                ) : <button type="button" onClick={() => setVerObs(true)} className="justify-self-start text-sm font-semibold text-cruz py-1.5 -my-1.5">+ Agregar observación</button>}
                {corrigiendo && (
                  <label className="grid gap-1 text-sm font-semibold">Motivo de la corrección
                    <input id="t-motivo" value={motivo} onChange={(e) => setMotivo(e.target.value)} maxLength={300} placeholder="Ej.: se anotó mal el número" className="campo font-normal" />
                  </label>
                )}
                <div className="flex flex-wrap gap-2">
                  <button disabled={enviando} className="btn-primario flex-1">{enviando ? "Guardando…" : corrigiendo ? "Guardar corrección" : "Guardar registro"}</button>
                  {corrigiendo && <button type="button" onClick={() => { limpiar(); setMsg(null); }} className="btn-borde">Cancelar</button>}
                </div>
              </form>
            )}
            <div aria-live="polite">{msg && <p role={msg.ok ? "status" : "alert"} className={`mt-3 text-sm font-semibold ${msg.ok ? "text-cruz" : "text-alerta"}`}>{msg.t}</p>}</div>
          </section>
        )}
        {children}
      </div>

      <div className="grid gap-5 min-w-0">
        <section className="grid grid-cols-3 gap-3" aria-label="Resumen del mes">
          <div className="tarjeta px-4 py-3.5"><p className="text-sm text-muted">Registros</p><p className="num titulo text-[30px] leading-tight">{vigentes.length}</p></div>
          <div className="tarjeta px-4 py-3.5"><p className="text-sm text-muted">Fuera de rango</p><p className={`num titulo text-[30px] leading-tight ${vigentes.some((r) => r.fuera_rango) ? "text-alerta" : ""}`}>{vigentes.filter((r) => r.fuera_rango).length}</p></div>
          <div className="tarjeta px-4 py-3.5"><p className="text-sm text-muted">Sin registro</p><p className={`num titulo text-[30px] leading-tight ${faltas ? "text-aviso" : ""}`}>{faltas}</p></div>
        </section>

        <section className="tarjeta p-4 sm:p-5" aria-label="Planilla del mes">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="titulo text-xl">Planilla del mes</h2>
            <div className="flex gap-1 rounded-xl bg-paper p-1" role="group" aria-label="Área de la planilla">
              {(Object.keys(AREAS) as Area[]).map((a) => <button key={a} type="button" aria-pressed={vista === a} onClick={() => { setVista(a); setElegida(null); }}
                className={`h-9 px-3 rounded-lg text-sm font-semibold ${vista === a ? "bg-surface shadow-sm text-ink" : "text-muted hover:text-ink"}`}>{AREA_CORTA[a]}</button>)}
            </div>
          </div>
          {!inicio[vista] && !registros.some((r) => r.area === vista) && (
            <p className="mt-3 text-sm text-muted">{vista === "frio" ? "Aún no hay registros de la nevera. Si tu droguería maneja cadena de frío, registra su temperatura en cada jornada." : "Aún no hay registros. Empieza con la jornada de hoy: la planilla marcará desde entonces las jornadas que falten."}</p>
          )}
          <table className="mt-3 w-full text-sm">
            <caption className="sr-only">Planilla de {AREAS[vista]}: valores por día y jornada</caption>
            <thead><tr className="text-left text-muted"><th scope="col" className="py-2 pr-2 font-semibold w-[72px]">Día</th><th scope="col" className="py-2 px-1 font-semibold">Mañana</th><th scope="col" className="py-2 pl-1 font-semibold">Tarde</th></tr></thead>
            <tbody className="divide-y divide-line">
              {Object.entries(tabla).map(([dia, js]) => (
                <tr key={dia} className={dia === hoy ? "bg-cruz-soft/40" : ""}>
                  <th scope="row" className={`py-1.5 pr-2 text-left font-medium whitespace-nowrap ${dia === hoy ? "text-ink font-semibold" : "text-muted"}`}>{diaCorto(dia)}</th>
                  {(Object.keys(JORNADAS) as Jornada[]).map((j) => {
                    const c = js[j], v = c.vigente, sel = elegida && igual(elegida, { fecha: dia, jornada: j, area: vista });
                    const corregido = c.historial.length > 1;
                    const base = `w-full min-h-11 rounded-lg px-2 py-1 text-left leading-tight transition-colors ${sel ? "ring-2 ring-ink" : ""}`;
                    const etiqueta = `${diaLargo(dia)}, ${JORNADAS[j].toLowerCase()}`;
                    return (
                      <td key={j} className="py-1 px-1">
                        {c.estado === "registrado" && v ? (
                          <button type="button" onClick={() => tocarCelda(dia, j, c)} aria-label={`${etiqueta}: ${dec(v.temperatura)} grados${v.humedad !== null ? `, ${dec(v.humedad)} % de humedad` : ""}${v.fuera_rango ? ", fuera de rango" : ""}${corregido ? ", corregido" : ""}. Ver detalle`}
                            className={`${base} ${v.fuera_rango ? "bg-alerta-soft text-alerta font-semibold" : "hover:bg-paper"}`}>
                            <span className="num">{v.fuera_rango && "⚠ "}{dec(v.temperatura)} °C{v.humedad !== null && <span className={v.fuera_rango ? "" : "text-muted"}> · {dec(v.humedad)} %</span>}</span>
                            {corregido && <span className="block text-[11px] font-semibold text-aviso">corregido</span>}
                          </button>
                        ) : c.estado === "falta" ? (
                          <button type="button" onClick={() => tocarCelda(dia, j, c)} aria-label={`${etiqueta}: sin registro${puedeRegistrar && dia >= limite ? ". Registrar" : ""}`}
                            className={`${base} bg-aviso-soft text-aviso font-semibold hover:brightness-95`}>Falta</button>
                        ) : c.estado === "hoy" ? (
                          <button type="button" onClick={() => tocarCelda(dia, j, c)} aria-label={`${etiqueta}: pendiente${puedeRegistrar ? ". Registrar" : ""}`}
                            className={`${base} border-2 border-dashed border-line text-muted hover:border-ink`}>Pendiente</button>
                        ) : <span className="block px-2 text-line" aria-label="Sin dato">—</span>}
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        {elegida && detalle && (
          <section ref={detalleRef} className="tarjeta p-5 scroll-mt-4" aria-label="Detalle de la jornada">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div>
                <h2 className="titulo text-xl">{diaLargo(elegida.fecha).replace(/^./, (x) => x.toUpperCase())}, {JORNADAS[elegida.jornada].toLowerCase()}</h2>
                <p className="text-sm text-muted">{AREAS[elegida.area]}</p>
              </div>
              <button type="button" onClick={() => setElegida(null)} className="text-sm font-semibold text-muted hover:text-ink" aria-label="Cerrar detalle">Cerrar</button>
            </div>
            {detalle.historial.length === 0 ? (
              <p className="mt-3 text-muted">{detalle.estado === "falta" ? (elegida.fecha < limite ? "Sin registro. Ya pasaron más de 7 días: no se puede registrar tarde." : "Sin registro.") : "Sin registro."}</p>
            ) : (
              <ol className="mt-3 grid gap-3">
                {[...detalle.historial].reverse().map((r) => (
                  <li key={r.id} className={`rounded-xl border p-3 grid gap-1 text-sm ${r.vigente ? "border-line" : "border-dashed border-line bg-paper/50"}`}>
                    <p className="flex flex-wrap items-baseline justify-between gap-2">
                      <span className={`num text-lg font-semibold ${r.vigente ? (r.fuera_rango ? "text-alerta" : "") : "line-through text-muted"}`}>{dec(r.temperatura)} °C{r.humedad !== null ? ` · ${dec(r.humedad)} %` : ""}</span>
                      <span className={`text-xs font-semibold ${r.vigente ? "text-cruz" : "text-muted"}`}>{r.vigente ? "Vigente" : "Anulado por corrección"}</span>
                    </p>
                    <p className="text-muted">{nombreCorto(r.responsable)} · {r.creado} · rango {rangoTexto(r.temp_min, r.temp_max, "°C")}{r.hum_min !== null ? `, ${rangoTexto(r.hum_min, r.hum_max, "%")}` : ""}</p>
                    {r.fuera_rango && <p><b className="text-alerta">Fuera de rango.</b> Acción correctiva: {r.accion}</p>}
                    {r.observacion && <p>Observación: {r.observacion}</p>}
                    {r.anula_id && <p>Corrige el registro anterior. Motivo: {r.motivo}</p>}
                  </li>
                ))}
              </ol>
            )}
            {puedeRegistrar && detalle.vigente && <button type="button" onClick={() => irAlFormulario(elegida, detalle.vigente!)} className="btn-borde mt-4 h-10">Corregir</button>}
          </section>
        )}
      </div>
    </div>
  );
}
