"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { Isotipo } from "@/components/Marca";

type Msg = { role: "user" | "assistant"; content: string; herramientas?: string[] };
const SUGERENCIAS = ["¿Qué debo pedir esta semana?", "¿Qué se me puede vencer antes de venderse?", "¿Cuánto vendí ayer y cómo me pagaron?", "¿Tengo algo con alerta del INVIMA?", "¿Qué días vendo más?"];
const NOMBRES: Record<string, string> = { resumen_ventas: "ventas", buscar_producto: "productos", pedido_sugerido: "pedido sugerido", riesgo_vencimiento: "vencimientos", sin_rotacion: "rotación", alertas_invima: "alertas INVIMA", patron_semanal: "patrón semanal" };

/** Regenta IA: botón flotante y panel de conversación. Se abre también con el evento «regenta-ia» (desde Ctrl+K o el inicio). */
export function Asistente({ activa }: { activa: boolean }) {
  const ruta = usePathname();
  const [abierto, setAbierto] = useState(false);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [texto, setTexto] = useState("");
  const [pensando, setPensando] = useState(false);
  const fin = useRef<HTMLDivElement>(null);
  const campo = useRef<HTMLTextAreaElement>(null);

  async function preguntar(q: string) {
    const pregunta = q.trim(); if (!pregunta || pensando) return;
    const nuevos: Msg[] = [...msgs, { role: "user", content: pregunta }];
    setMsgs(nuevos); setTexto(""); setPensando(true);
    try {
      const r = await fetch("/api/ia", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ mensajes: nuevos.slice(-12).map(({ role, content }) => ({ role, content })) }) });
      const j = await r.json().catch(() => ({}));
      setMsgs([...nuevos, { role: "assistant", content: r.ok ? j.respuesta : j.error ?? "No pude responder ahora.", herramientas: j.herramientas }]);
    } catch { setMsgs([...nuevos, { role: "assistant", content: "Sin conexión: revisa internet e inténtalo otra vez." }]); }
    setPensando(false);
  }

  useEffect(() => {
    const abrir = (e: Event) => { setAbierto(true); const q = (e as CustomEvent<string>).detail; if (q && activa) void preguntar(q); else setTimeout(() => campo.current?.focus(), 50); };
    window.addEventListener("regenta-ia", abrir);
    return () => window.removeEventListener("regenta-ia", abrir);
  });
  useEffect(() => { fin.current?.scrollIntoView({ block: "end" }); }, [msgs, pensando]);
  useEffect(() => { const esc = (e: KeyboardEvent) => e.key === "Escape" && setAbierto(false); window.addEventListener("keydown", esc); return () => window.removeEventListener("keydown", esc); }, []);

  return (
    <>
      {!abierto && !ruta.startsWith("/caja") && (
        <button onClick={() => { setAbierto(true); setTimeout(() => campo.current?.focus(), 50); }} aria-label="Abrir Regenta IA" className="fixed z-40 right-3 bottom-4 lg:right-5 lg:bottom-5 size-14 lg:size-auto lg:h-12 lg:pl-2 lg:pr-4 rounded-full bg-ink text-white shadow-[0_12px_30px_-10px_rgba(16,42,67,.7)] inline-flex items-center justify-center gap-2 font-semibold hover:brightness-125">
          <span className="rounded-full bg-white/10 p-1"><Isotipo size={26} claro /></span><span className="hidden lg:inline">Regenta IA</span>
        </button>
      )}
      {abierto && (
        <section role="dialog" aria-modal="true" aria-label="Regenta IA" className="fixed z-50 inset-x-0 bottom-0 sm:inset-auto sm:right-4 sm:bottom-4 sm:w-[420px] h-[85vh] sm:h-[600px] bg-surface sm:rounded-2xl rounded-t-2xl shadow-2xl border border-line flex flex-col">
          <header className="flex items-center gap-3 px-4 h-14 border-b border-line">
            <Isotipo size={28} />
            <div className="flex-1"><p className="titulo text-lg leading-none">Regenta IA</p><p className="text-xs text-muted">Responde con los datos de tu droguería</p></div>
            <button onClick={() => setAbierto(false)} className="text-muted hover:text-ink text-2xl leading-none px-2" aria-label="Cerrar">×</button>
          </header>
          <div className="flex-1 overflow-y-auto px-4 py-4 grid content-start gap-3">
            {!activa && <p className="rounded-xl bg-aviso-soft text-aviso px-4 py-3 text-sm font-semibold">Regenta IA todavía no está activada en esta cuenta. Pídela al equipo de Regenta por WhatsApp.</p>}
            {msgs.length === 0 && (
              <div className="grid gap-2">
                <p className="text-muted">Pregúntame como le preguntarías a tu regente. Yo consulto tus ventas, lotes, predicciones y alertas, y te respondo con cifras.</p>
                {SUGERENCIAS.map((s) => <button key={s} disabled={!activa} onClick={() => preguntar(s)} className="text-left rounded-xl border border-line px-3 py-2 hover:border-ink disabled:opacity-50">{s}</button>)}
              </div>
            )}
            {msgs.map((m, i) => (
              <div key={i} className={m.role === "user" ? "justify-self-end max-w-[85%] rounded-2xl rounded-br-md bg-ink text-white px-3.5 py-2" : "max-w-[92%]"}>
                <p className="whitespace-pre-wrap leading-relaxed">{m.content}</p>
                {m.herramientas && m.herramientas.length > 0 && <p className="mt-1 text-xs text-muted">Consultó: {[...new Set(m.herramientas)].map((h) => NOMBRES[h] ?? h).join(", ")}</p>}
              </div>
            ))}
            {pensando && <p className="text-muted" role="status">Consultando tus datos…</p>}
            <div ref={fin} />
          </div>
          <form onSubmit={(e) => { e.preventDefault(); void preguntar(texto); }} className="border-t border-line p-3 flex gap-2">
            <label htmlFor="ia-texto" className="sr-only">Tu pregunta</label>
            <textarea id="ia-texto" ref={campo} rows={1} value={texto} disabled={!activa} onChange={(e) => setTexto(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); void preguntar(texto); } }}
              placeholder={activa ? "Escribe tu pregunta…" : "No activada"} className="campo h-11 py-2.5 resize-none flex-1" />
            <button disabled={!activa || pensando || !texto.trim()} className="btn-primario h-11 px-4">Enviar</button>
          </form>
        </section>
      )}
    </>
  );
}
