"use client";
import { Fragment, useEffect, useRef, useState, type ReactNode } from "react";
import { usePathname } from "next/navigation";
import { Isotipo } from "@/components/Marca";

type Msg = { role: "user" | "assistant"; content: string; herramientas?: string[]; error?: boolean };
const SUGERENCIAS = ["¿Qué debo pedir esta semana?", "¿Qué se me puede vencer antes de venderse?", "¿Cuánto vendí ayer y cómo me pagaron?", "¿Tengo algo con alerta del INVIMA?", "¿Qué días vendo más?"];
const NOMBRES: Record<string, string> = { resumen_ventas: "ventas", buscar_producto: "productos", pedido_sugerido: "pedido sugerido", riesgo_vencimiento: "vencimientos", sin_rotacion: "rotación", alertas_invima: "alertas INVIMA", patron_semanal: "patrón semanal" };
// En estas pantallas el botón flotante taparía las acciones de abajo: la IA se abre con Ctrl+K o desde el buscador.
const SIN_BOTON = ["/caja", "/turno", "/productos/nuevo", "/productos/importar", "/inventario/recibir"];

/** Negritas (**así**) y listas (- o 1.) del texto de la IA, sin interpretar HTML. */
function Formato({ texto }: { texto: string }) {
  const negritas = (l: string) => l.split(/(\*\*[^*]+\*\*)/g).map((p, i) => (p.startsWith("**") && p.endsWith("**") && p.length > 4 ? <strong key={i}>{p.slice(2, -2)}</strong> : <Fragment key={i}>{p}</Fragment>));
  const bloques: ReactNode[] = [];
  let lista: { ordenada: boolean; items: string[] } | null = null;
  const cerrar = () => {
    if (!lista) return;
    const L = lista.ordenada ? "ol" : "ul";
    bloques.push(<L key={bloques.length} className={`${lista.ordenada ? "list-decimal" : "list-disc"} pl-5 grid gap-0.5`}>{lista.items.map((x, i) => <li key={i}>{negritas(x)}</li>)}</L>);
    lista = null;
  };
  for (const linea of texto.split("\n")) {
    const m = linea.match(/^\s*(?:([-*•])|(\d+)[.)])\s+(.*)$/);
    if (m) { const ordenada = !!m[2]; if (!lista || lista.ordenada !== ordenada) { cerrar(); lista = { ordenada, items: [] }; } lista.items.push(m[3]); continue; }
    cerrar();
    const t = linea.replace(/^#{1,4}\s+/, "");
    if (t.trim()) bloques.push(<p key={bloques.length} className={linea.startsWith("#") ? "font-semibold" : ""}>{negritas(t)}</p>);
  }
  cerrar();
  return <div className="grid gap-2 leading-relaxed">{bloques}</div>;
}

/** Regenta IA: botón flotante y panel de conversación. Se abre también con el evento «regenta-ia» (desde Ctrl+K o el inicio).
 *  La respuesta llega en flujo: se ve escribirse mientras la IA consulta los datos. En el celular ocupa la pantalla
 *  completa y se cierra con el botón «atrás» del teléfono; el botón flotante se esconde mientras se baja por la página. */
export function Asistente({ activa }: { activa: boolean }) {
  const ruta = usePathname();
  const [abierto, setAbierto] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [texto, setTexto] = useState("");
  const [pensando, setPensando] = useState(false);
  const [consultas, setConsultas] = useState<string[]>([]);
  const [oculto, setOculto] = useState(false);
  const fin = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLTextAreaElement>(null);
  const corte = useRef<AbortController | null>(null);
  const enHistorial = useRef(false);

  function abrir() {
    setAbierto(true);
    // En el celular, «atrás» cierra el panel en vez de salir de la página.
    if (!enHistorial.current && window.matchMedia("(max-width: 639px)").matches) { history.pushState({ ...history.state, regentaIA: true }, ""); enHistorial.current = true; }
  }
  function cerrar() {
    setAbierto(false);
    if (enHistorial.current) { enHistorial.current = false; history.back(); }
  }

  async function preguntar(q: string) {
    const pregunta = q.trim(); if (!pregunta || pensando) return;
    const nuevos: Msg[] = [...msgs, { role: "user", content: pregunta }];
    setMsgs([...nuevos, { role: "assistant", content: "" }]); setTexto(""); setPensando(true); setConsultas([]);
    const poner = (m: Partial<Msg>) => setMsgs((ms) => [...ms.slice(0, -1), { ...ms[ms.length - 1], ...m }]);
    const ctl = new AbortController(); corte.current = ctl;
    let acumulado = "";
    try {
      const r = await fetch("/api/ia", { method: "POST", headers: { "content-type": "application/json" }, signal: ctl.signal,
        body: JSON.stringify({ mensajes: nuevos.filter((m) => m.content && !m.error).slice(-16).map(({ role, content }) => ({ role, content })) }) });
      if (!r.ok || !r.body) { const j = await r.json().catch(() => ({})); poner({ content: j.error ?? "No pude responder ahora.", error: true }); return; }
      const lector = r.body.getReader(); const dec = new TextDecoder(); let resto = "";
      for (;;) {
        const { value, done } = await lector.read();
        if (done) break;
        resto += dec.decode(value, { stream: true });
        const lineas = resto.split("\n"); resto = lineas.pop() ?? "";
        for (const l of lineas) {
          if (!l.trim()) continue;
          const e = JSON.parse(l);
          if (e.t === "texto") { acumulado += e.d; poner({ content: acumulado }); }
          else if (e.t === "limpiar") { acumulado = ""; poner({ content: "" }); }
          else if (e.t === "consulta") setConsultas((c) => [...c, NOMBRES[e.h] ?? e.h]);
          else if (e.t === "fin") poner(e.error ? { content: e.error, error: true } : { content: e.respuesta, herramientas: e.herramientas });
        }
      }
    } catch (err) {
      if ((err as Error).name === "AbortError") poner({ content: acumulado ? acumulado + " …" : "Detenido.", error: !acumulado });
      else poner({ content: acumulado || "Sin conexión: revisa internet e inténtalo otra vez.", error: !acumulado });
    } finally { setPensando(false); setConsultas([]); corte.current = null; }
  }

  useEffect(() => {
    const ev = (e: Event) => { abrir(); const q = (e as CustomEvent<string>).detail; if (q && activa) void preguntar(q); else setTimeout(() => campo.current?.focus(), 50); };
    window.addEventListener("regenta-ia", ev);
    return () => window.removeEventListener("regenta-ia", ev);
  });
  useEffect(() => { fin.current?.scrollIntoView({ block: "end" }); }, [msgs, consultas]);
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === "Escape" && abierto && cerrar();
    const atras = () => { if (enHistorial.current) { enHistorial.current = false; setAbierto(false); } };
    window.addEventListener("keydown", esc); window.addEventListener("popstate", atras);
    return () => { window.removeEventListener("keydown", esc); window.removeEventListener("popstate", atras); };
  });
  // Botón flotante: se esconde al bajar (para leer sin estorbo) y vuelve al subir o al quedarse quieto.
  useEffect(() => {
    let y = 0, quieto: ReturnType<typeof setTimeout> | undefined;
    const mover = (e: Event) => {
      const el = e.target === document ? document.scrollingElement : (e.target as HTMLElement);
      const ny = el?.scrollTop ?? 0;
      if (Math.abs(ny - y) > 8) setOculto(ny > y && ny > 80);
      y = ny; clearTimeout(quieto); quieto = setTimeout(() => setOculto(false), 1200);
    };
    document.addEventListener("scroll", mover, { capture: true, passive: true });
    return () => { document.removeEventListener("scroll", mover, { capture: true }); clearTimeout(quieto); };
  }, []);
  useEffect(() => { const t = campo.current; if (t) { t.style.height = "auto"; t.style.height = Math.min(t.scrollHeight, 120) + "px"; } }, [texto]);

  const ultimo = msgs[msgs.length - 1];
  const escribiendo = pensando && ultimo?.role === "assistant" && !!ultimo.content;

  return (
    <>
      {!abierto && !SIN_BOTON.some((r) => ruta.startsWith(r)) && (
        <button onClick={() => { abrir(); setTimeout(() => campo.current?.focus(), 50); }} aria-label="Abrir Regenta IA"
          className={`fixed z-40 right-3 bottom-[calc(1rem+env(safe-area-inset-bottom))] lg:right-5 lg:bottom-5 size-12 lg:size-auto lg:h-12 lg:pl-2 lg:pr-4 rounded-full bg-ink text-white shadow-[0_10px_24px_-10px_rgba(16,42,67,.7)] inline-flex items-center justify-center gap-2 font-semibold hover:brightness-125 transition-[transform,opacity] duration-200 motion-reduce:transition-none ${oculto ? "translate-y-24 opacity-0 lg:translate-y-0 lg:opacity-100" : ""}`}>
          <span className="rounded-full bg-white/10 p-1"><Isotipo size={22} claro /></span><span className="hidden lg:inline">Regenta IA</span>
        </button>
      )}
      {abierto && (
        <section role="dialog" aria-modal="true" aria-label="Regenta IA"
          className="fixed z-50 inset-0 h-[100dvh] sm:inset-auto sm:right-4 sm:bottom-4 sm:w-[420px] sm:h-[600px] sm:max-h-[calc(100dvh-2rem)] bg-surface sm:rounded-2xl sm:shadow-2xl sm:border border-line flex flex-col">
          <header className="flex items-center gap-3 px-3 sm:px-4 h-14 border-b border-line pt-[env(safe-area-inset-top)] box-content sm:box-border sm:pt-0">
            <button onClick={cerrar} className="sm:hidden size-10 -ml-1 grid place-items-center text-ink" aria-label="Volver">
              <svg aria-hidden viewBox="0 0 24 24" className="size-6" fill="none" stroke="currentColor" strokeWidth="2"><path d="M15 18l-6-6 6-6" strokeLinecap="round" strokeLinejoin="round" /></svg>
            </button>
            <Isotipo size={26} />
            <div className="flex-1 min-w-0"><p className="titulo text-lg leading-none">Regenta IA</p><p className="text-xs text-muted truncate">{pensando ? (consultas.length ? `Consultando ${[...new Set(consultas)].join(", ")}…` : "Pensando…") : "Responde con los datos de tu droguería"}</p></div>
            {msgs.length > 0 && !pensando && <button onClick={() => setMsgs([])} className="text-sm font-semibold text-muted hover:text-ink px-2 h-10">Nueva</button>}
            <button onClick={cerrar} className="hidden sm:block text-muted hover:text-ink text-2xl leading-none px-2" aria-label="Cerrar">×</button>
          </header>
          <div className="flex-1 overflow-y-auto overscroll-contain px-4 py-4 grid content-start gap-3">
            {!activa && <p className="rounded-xl bg-aviso-soft text-aviso px-4 py-3 text-sm font-semibold">Regenta IA todavía no está activada en esta cuenta. Pídela al equipo de Regenta por WhatsApp.</p>}
            {msgs.length === 0 && (
              <div className="grid gap-3">
                <p className="text-muted">Pregúntame como le preguntarías a tu regente: consulto tus ventas, lotes, predicciones y alertas, y te respondo con cifras.</p>
                <div className="flex gap-2 overflow-x-auto -mx-4 px-4 pb-1 sm:flex-wrap sm:overflow-visible sm:mx-0 sm:px-0 [scrollbar-width:none]">
                  {SUGERENCIAS.map((s) => <button key={s} disabled={!activa} onClick={() => preguntar(s)} className="shrink-0 text-left text-sm rounded-full border border-line px-3.5 py-2 hover:border-ink disabled:opacity-50">{s}</button>)}
                </div>
              </div>
            )}
            {msgs.map((m, i) => m.role === "user"
              ? <div key={i} className="justify-self-end max-w-[85%] rounded-2xl rounded-br-md bg-ink text-white px-3.5 py-2"><p className="whitespace-pre-wrap">{m.content}</p></div>
              : (m.content || !pensando || i < msgs.length - 1) && (
                <div key={i} className={`max-w-[95%] ${m.error ? "text-alerta" : ""}`}>
                  <Formato texto={m.content} />
                  {m.herramientas && m.herramientas.length > 0 && <p className="mt-1 text-xs text-muted">Consultó: {[...new Set(m.herramientas)].map((h) => NOMBRES[h] ?? h).join(", ")}</p>}
                </div>
              ))}
            {pensando && !escribiendo && (
              <p className="text-muted flex items-center gap-2" role="status">
                <span className="inline-flex gap-1" aria-hidden>{[0, 1, 2].map((k) => <span key={k} className="size-1.5 rounded-full bg-muted animate-pulse" style={{ animationDelay: `${k * 150}ms` }} />)}</span>
                {consultas.length ? `Consultando ${[...new Set(consultas)].join(", ")}…` : "Pensando…"}
              </p>
            )}
            <div ref={fin} />
          </div>
          <form onSubmit={(e) => { e.preventDefault(); void preguntar(texto); }} className="border-t border-line p-2.5 sm:p-3 pb-[calc(0.625rem+env(safe-area-inset-bottom))] sm:pb-3 flex items-end gap-2">
            <label htmlFor="ia-texto" className="sr-only">Tu pregunta</label>
            <textarea id="ia-texto" ref={campo} rows={1} value={texto} disabled={!activa} onChange={(e) => setTexto(e.target.value)} enterKeyHint="send"
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void preguntar(texto); } }}
              placeholder={activa ? "Escribe tu pregunta…" : "No activada"} className="campo min-h-11 py-2.5 resize-none flex-1 text-base" />
            {pensando
              ? <button type="button" onClick={() => corte.current?.abort()} className="btn-borde h-11 px-4">Detener</button>
              : <button disabled={!activa || !texto.trim()} className="btn-primario h-11 px-3 sm:px-4" aria-label="Enviar">
                  <span className="hidden sm:inline">Enviar</span>
                  <svg aria-hidden viewBox="0 0 24 24" className="size-5 sm:hidden" fill="none" stroke="currentColor" strokeWidth="2.2"><path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </button>}
          </form>
        </section>
      )}
    </>
  );
}
