"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { pesos } from "@/lib/formato";
import { wa } from "@/lib/sitio";

// Embudo dentro de la droguería de demostración: barra fija con la oferta, un recorrido de 3 pasos que guía al
// visitante a lo que vende (caja, vencimientos, INVIMA), un aviso después de cada venta y una oferta al terminar el
// recorrido, al intentar irse o a los 3 minutos. Cada oferta sale una sola vez por visita.

type Paso = { id: string; titulo: string; detalle: string; href: string; roles: string[] };
const PASOS: Paso[] = [
  { id: "venta", titulo: "Haz una venta en la caja", detalle: "Busca «acetaminofén» y cobra. Mira cómo sale el tiquete POS electrónico.", href: "/caja", roles: ["dueno", "admin", "cajero"] },
  { id: "prediccion", titulo: "Mira qué se te va a vencer", detalle: "La plata que estás a punto de perder y qué pedir esta semana.", href: "/prediccion", roles: ["dueno", "admin", "bodeguero"] },
  { id: "alertas", titulo: "Revisa las alertas del INVIMA", detalle: "Cruzadas con tus lotes: solo te avisa lo que te toca.", href: "/alertas", roles: ["dueno", "admin", "cajero", "bodeguero"] },
];

const CLAVE = "regenta_demo_v1";
/** Consola → Visitas a la demo (08/11/2026): cada paso del visitante (pantallas, ventas, ofertas, clics). Nunca bloquea. */
const evento = (tipo: string, detalle?: string) => { try { void fetch("/api/demo/evento", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ tipo, detalle: detalle?.slice(0, 240) }), keepalive: true }).catch(() => {}); } catch {} };
type Estado = { hechos: string[]; ofertas: string[]; cerrada?: boolean; inicio: number };
const leer = (): Estado => {
  try { const j = JSON.parse(sessionStorage.getItem(CLAVE) ?? "null"); if (j?.inicio) return j; } catch {}
  return { hechos: [], ofertas: [], inicio: Date.now() };
};
const guardar = (e: Estado) => { try { sessionStorage.setItem(CLAVE, JSON.stringify(e)); } catch {} };

const OFERTAS = {
  completo: { titulo: "Ya lo viste funcionar. Ahora ponlo a vender en tu droguería.", texto: "Lo que acabas de probar es lo mismo que recibes: caja, factura DIAN, vencimientos e INVIMA, con tus productos." },
  salida: { titulo: "Antes de irte: tu droguería puede estar así esta misma semana.", texto: "Te dejamos el certificado digital y la habilitación DIAN incluidos, y capacitamos a tu equipo." },
  tiempo: { titulo: "¿Te imaginas tu mostrador así desde el lunes?", texto: "Cada caja que se te vence es plata que ya pagaste. Regenta te avisa antes y te dice qué ofrecer primero." },
} as const;

export function ModoDemo({ rol, precio, garantia }: { rol: string; precio: number; garantia: string }) {
  const ruta = usePathname();
  const [e, setE] = useState<Estado | null>(null);
  const [oferta, setOferta] = useState<keyof typeof OFERTAS | null>(null);
  const [aviso, setAviso] = useState<string | null>(null);
  const [abierta, setAbierta] = useState(true);
  const dialogo = useRef<HTMLDialogElement>(null);
  const pasos = PASOS.filter((p) => p.roles.includes(rol));

  const actualizar = useCallback((f: (x: Estado) => Estado) => setE((x) => { const n = f(x ?? leer()); guardar(n); return n; }), []);
  const mostrar = useCallback((k: keyof typeof OFERTAS) => {
    const x = leer();
    if (x.ofertas.includes(k) || x.ofertas.length >= 2) return; // nunca más de dos ofertas por visita
    actualizar((y) => ({ ...y, ofertas: [...y.ofertas, k] }));
    setOferta(k);
    evento("oferta", k);
  }, [actualizar]);

  useEffect(() => { const x = leer(); guardar(x); setE(x); setAbierta(!x.cerrada && window.innerWidth >= 640); }, []); // en el celular empieza minimizado

  useEffect(() => { evento("pagina", ruta); }, [ruta]);
  // Clics a Contratar o WhatsApp desde cualquier parte de la demo.
  useEffect(() => {
    const clic = (ev: MouseEvent) => {
      const a = (ev.target as HTMLElement | null)?.closest?.("a");
      const h = a?.getAttribute("href") ?? "";
      if (h.startsWith("/contratar")) evento("contratar", h);
      else if (/wa\.me|whatsapp/i.test(h)) evento("whatsapp", ruta);
    };
    document.addEventListener("click", clic, true);
    return () => document.removeEventListener("click", clic, true);
  }, [ruta]);

  // Paso cumplido al visitar la pantalla (la venta se cumple al vender).
  useEffect(() => {
    const p = PASOS.find((x) => x.id !== "venta" && ruta.startsWith(x.href));
    if (p) actualizar((x) => (x.hechos.includes(p.id) ? x : { ...x, hechos: [...x.hechos, p.id] }));
    // Al llegar a la pantalla de un paso, la guía se recoge para no tapar lo que hay que probar (sigue a un toque).
    if (PASOS.some((x) => ruta.startsWith(x.href))) setAbierta(false);
  }, [ruta, actualizar]);

  useEffect(() => {
    const venta = (ev: Event) => {
      const total = Number((ev as CustomEvent).detail?.total ?? 0);
      actualizar((x) => (x.hechos.includes("venta") ? x : { ...x, hechos: [...x.hechos, "venta"] }));
      evento("venta", pesos(total));
      setAviso(`Venta de ${pesos(total)} registrada, con su tiquete POS electrónico y el inventario descontado del lote que vence antes. Así de rápido en tu mostrador.`);
    };
    window.addEventListener("regenta:venta", venta);
    // Intención de salida (escritorio): el puntero sale por arriba de la ventana.
    const salida = (ev: MouseEvent) => { if (ev.clientY <= 0 && Date.now() - leer().inicio > 20000) mostrar("salida"); };
    document.addEventListener("mouseout", salida);
    const t = setInterval(() => { if (Date.now() - leer().inicio > 180000) mostrar("tiempo"); }, 15000);
    return () => { window.removeEventListener("regenta:venta", venta); document.removeEventListener("mouseout", salida); clearInterval(t); };
  }, [actualizar, mostrar]);

  const hechos = e?.hechos.filter((h) => pasos.some((p) => p.id === h)).length ?? 0;
  useEffect(() => { if (e && pasos.length && hechos === pasos.length) { const t = setTimeout(() => mostrar("completo"), aviso ? 4500 : 800); return () => clearTimeout(t); } }, [hechos, pasos.length, e, mostrar, aviso]);
  useEffect(() => { if (!aviso) return; const t = setTimeout(() => setAviso(null), 9000); return () => clearTimeout(t); }, [aviso]);
  useEffect(() => { const d = dialogo.current; if (!d) return; if (oferta && !d.open) d.showModal(); if (!oferta && d.open) d.close(); }, [oferta]);

  const msjWa = wa("Hola, probé la demo de Regenta y quiero ponerlo en mi droguería.");
  const o = oferta ? OFERTAS[oferta] : null;

  return (
    <>
      {/* Barra de la oferta: siempre visible en la demo. */}
      <div className="lg:sticky lg:top-0 z-30 bg-amber-400 text-[#0b1f33] px-3 sm:px-6 py-2 flex items-center gap-3 shadow-[0_8px_20px_-14px_rgba(0,0,0,.6)]" role="region" aria-label="Estás en la demo">
        <p className="text-sm sm:text-[15px] leading-tight min-w-0">
          <b>Droguería de demostración.</b>
          <span className="hidden md:inline"> Todo lo que ves funciona igual con tus productos · desde <b className="num">{pesos(precio)}</b> al mes, certificado y habilitación DIAN incluidos.</span>
          <span className="md:hidden"> Desde <b className="num">{pesos(precio)}</b>/mes.</span>
        </p>
        <a href={msjWa} className="hidden lg:inline-flex ml-auto h-9 items-center rounded-lg px-3 text-sm font-semibold border-2 border-[#0b1f33]/30 hover:border-[#0b1f33] shrink-0">WhatsApp</a>
        <Link href="/contratar?plan=pro&origen=demo" className="ml-auto lg:ml-0 h-9 inline-flex items-center rounded-lg px-4 text-sm font-bold bg-[#0b1f33] text-white hover:bg-black shrink-0">Contratar ahora</Link>
      </div>

      {/* Recorrido de 3 pasos. */}
      {e && pasos.length > 0 && (
        <div role="complementary" aria-label="Recorrido de la demo" className="fixed z-30 left-3 bottom-3 sm:left-auto sm:right-auto lg:left-[248px] max-w-[calc(100vw-96px)] sm:max-w-sm">
          {abierta ? (
            <div className="rounded-2xl bg-[#0b1f33] text-white shadow-[0_24px_48px_-20px_rgba(0,0,0,.7)] p-4 max-h-[calc(100dvh-1.5rem)] overflow-y-auto overscroll-contain">
              <div className="flex items-center justify-between gap-3">
                <p className="font-cond text-xl leading-tight" style={{ fontWeight: 700 }}>Pruébalo en {pasos.length} pasos</p>
                <button onClick={() => { setAbierta(false); actualizar((x) => ({ ...x, cerrada: true })); }} className="text-white/60 hover:text-white text-sm shrink-0" aria-label="Minimizar el recorrido">Minimizar</button>
              </div>
              <div className="mt-2 h-1.5 rounded-full bg-white/15 overflow-hidden" aria-hidden="true"><div className="h-full bg-amber-400 transition-[width] duration-500" style={{ width: `${(hechos / pasos.length) * 100}%` }} /></div>
              <ol className="mt-3 grid gap-2">
                {pasos.map((p) => {
                  const ok = e.hechos.includes(p.id);
                  return (
                    <li key={p.id}>
                      <Link href={p.href} className={`flex gap-3 rounded-xl p-2 -m-1 hover:bg-white/5 ${ok ? "opacity-70" : ""}`}>
                        <span className={`mt-0.5 size-6 shrink-0 rounded-full grid place-items-center text-[13px] font-bold ${ok ? "bg-emerald-400 text-[#0b1f33]" : "border-2 border-white/40"}`} aria-hidden="true">{ok ? "✓" : ""}</span>
                        <span><span className={`block font-semibold ${ok ? "line-through" : ""}`}>{p.titulo}</span>{!ok && <span className="block text-sm text-white/65 leading-snug">{p.detalle}</span>}</span>
                        <span className="sr-only">{ok ? "(hecho)" : "(pendiente)"}</span>
                      </Link>
                    </li>
                  );
                })}
              </ol>
              <Link href="/contratar?plan=pro&origen=demo" className="mt-3 btn-cta h-11 w-full">{hechos === pasos.length ? "Lo quiero en mi droguería" : "Ya me convenció: contratar"}</Link>
            </div>
          ) : (
            <button onClick={() => { setAbierta(true); actualizar((x) => ({ ...x, cerrada: false })); }} className="rounded-full bg-[#0b1f33] text-white h-11 px-4 font-semibold shadow-lg">
              Guía de la demo · {hechos}/{pasos.length}
            </button>
          )}
        </div>
      )}

      {/* Aviso después de cada venta. */}
      {aviso && (
        <div role="status" className="fixed z-40 bottom-20 left-3 right-3 sm:right-auto lg:left-[248px] sm:max-w-md rounded-2xl bg-emerald-600 text-white p-4 shadow-[0_24px_48px_-20px_rgba(0,0,0,.7)]">
          <p className="font-semibold leading-snug">{aviso}</p>
          <div className="mt-3 flex gap-2">
            <Link href="/contratar?plan=pro&origen=demo-venta" className="h-10 inline-flex items-center rounded-lg px-4 font-bold bg-white text-emerald-800">Quiero esto en mi droguería</Link>
            <button onClick={() => setAviso(null)} className="h-10 px-3 text-white/85 hover:text-white">Seguir probando</button>
          </div>
        </div>
      )}

      {/* La oferta. */}
      <dialog ref={dialogo} onClose={() => setOferta(null)} aria-labelledby="oferta-titulo"
        className="m-auto w-[min(560px,calc(100vw-24px))] rounded-3xl p-0 backdrop:bg-[#0b1f33]/70 backdrop:backdrop-blur-sm">
        {o && (
          <div className="fondo-hero text-white p-6 sm:p-8">
            <h2 id="oferta-titulo" className="font-cond text-[32px] sm:text-[40px] leading-[1]" style={{ fontWeight: 700 }}>{o.titulo}</h2>
            <p className="mt-3 text-white/80 text-lg">{o.texto}</p>
            <ul className="mt-5 grid gap-2 text-[15px]">
              {["Certificado digital y habilitación DIAN incluidos", "Capacitación a tu equipo", "Sin permanencia: cancelas cuando quieras", garantia].map((t) => (
                <li key={t} className="flex gap-2"><span className="text-amber-300 font-bold" aria-hidden="true">✓</span>{t}</li>
              ))}
            </ul>
            <p className="mt-5 text-white/70 text-sm">Desde</p>
            <p className="num font-cond text-[48px] leading-none" style={{ fontWeight: 700 }}>{pesos(precio)}<span className="text-lg font-sans text-white/70" style={{ fontWeight: 400 }}> / mes</span></p>
            <div className="mt-6 grid sm:grid-cols-2 gap-2">
              <Link href={`/contratar?plan=pro&origen=demo-${oferta}`} className="btn-cta h-14 text-lg">Contratar ahora</Link>
              <a href={msjWa} className="btn-vidrio h-14">Hablar por WhatsApp</a>
            </div>
            <DatosContacto />
            <form method="dialog" className="mt-4 text-center"><button className="text-white/65 hover:text-white underline underline-offset-4">Seguir probando la demo</button></form>
          </div>
        )}
      </dialog>
    </>
  );
}

/** «Prefiero que me llamen»: datos mínimos dentro de la oferta; van a Solicitudes de demo unidos a esta visita. */
function DatosContacto() {
  const [abierto, setAbierto] = useState(false);
  const [estado, setEstado] = useState<"" | "enviando" | "ok">("");
  const [error, setError] = useState("");
  async function enviar(ev: React.FormEvent<HTMLFormElement>) {
    ev.preventDefault(); setError(""); setEstado("enviando");
    const f = new FormData(ev.currentTarget);
    try {
      const r = await fetch("/api/demo", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ nombre: f.get("nombre"), drogueria: f.get("drogueria"), ciudad: f.get("ciudad"), telefono: f.get("telefono"), origen: "demo-oferta", web: f.get("web") }) });
      const j = await r.json().catch(() => ({}));
      if (r.ok) { setEstado("ok"); return; }
      setError(j.error ?? "No se pudo enviar. Escríbenos por WhatsApp."); setEstado("");
    } catch { setError("Sin conexión. Inténtalo de nuevo."); setEstado(""); }
  }
  if (estado === "ok") return <p role="status" className="mt-5 rounded-xl bg-white/10 p-3 text-center font-semibold">Listo. Te contactamos para ponerlo en tu droguería.</p>;
  if (!abierto) return <p className="mt-4 text-center"><button type="button" onClick={() => setAbierto(true)} className="text-white/85 hover:text-white font-semibold underline underline-offset-4">Prefiero que me llamen</button></p>;
  const campo = "h-11 w-full rounded-lg bg-white text-[#0b1f33] px-3";
  return (
    <form onSubmit={enviar} className="mt-5 grid gap-2 sm:grid-cols-2" aria-label="Tus datos para llamarte">
      <label className="grid gap-1 text-sm">Tu nombre<input name="nombre" required minLength={2} maxLength={120} autoComplete="name" className={campo} /></label>
      <label className="grid gap-1 text-sm">Droguería<input name="drogueria" required minLength={2} maxLength={160} autoComplete="organization" className={campo} /></label>
      <label className="grid gap-1 text-sm">Ciudad<input name="ciudad" maxLength={80} autoComplete="address-level2" className={campo} /></label>
      <label className="grid gap-1 text-sm">Celular o WhatsApp<input name="telefono" required inputMode="tel" pattern="[0-9 +()-]{7,20}" autoComplete="tel" className={campo} /></label>
      <input name="web" tabIndex={-1} autoComplete="off" className="hidden" aria-hidden="true" />
      {error && <p role="alert" className="sm:col-span-2 text-amber-200 text-sm">{error}</p>}
      <button disabled={estado === "enviando"} className="sm:col-span-2 btn-cta h-12">{estado === "enviando" ? "Enviando…" : "Que me llamen"}</button>
      <p className="sm:col-span-2 text-xs text-white/60">Usamos tus datos solo para contactarte por Regenta. <a href="/privacidad" className="underline">Privacidad</a>.</p>
    </form>
  );
}
