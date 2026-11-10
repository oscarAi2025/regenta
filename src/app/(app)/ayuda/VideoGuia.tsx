"use client";
import { useRef, useState } from "react";

const mmss = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, "0")}`;

/** Video formativo con su índice: tocar un capítulo salta a ese minuto y lo reproduce. */
export function VideoGuia({ capitulos }: { capitulos: { n: number; titulo: string; t: number }[] }) {
  const video = useRef<HTMLVideoElement>(null);
  const [actual, setActual] = useState(0);
  function ir(t: number) {
    const v = video.current; if (!v) return;
    v.currentTime = t; void v.play().catch(() => {});
    v.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  function avance() {
    const t = video.current?.currentTime ?? 0;
    const n = [...capitulos].reverse().find((c) => t >= c.t - 0.2)?.n ?? 0;
    if (n !== actual) setActual(n);
  }
  return (
    <section className="grid xl:grid-cols-[minmax(0,1fr)_320px] gap-4" aria-label="Video formativo">
      <div className="tarjeta overflow-hidden bg-ink">
        <video ref={video} controls preload="metadata" playsInline poster="/manual/regenta-video-portada.jpg" onTimeUpdate={avance}
          className="block w-full aspect-video bg-ink" aria-label="Video formativo de Regenta, con voz y subtítulos">
          <source src="/manual/regenta-video-formativo.mp4" type="video/mp4" />
          Tu navegador no reproduce este video: <a href="/manual/regenta-video-formativo.mp4">descárgalo aquí</a>.
        </video>
      </div>
      <nav className="tarjeta p-3 xl:max-h-[min(70vh,560px)] xl:overflow-y-auto" aria-label="Capítulos del video">
        <p className="px-2 pt-1 pb-2 text-sm font-semibold text-muted">Capítulos · toca uno para ir directo</p>
        <ol className="grid gap-0.5">
          {capitulos.map((c) => (
            <li key={c.n}>
              <button onClick={() => ir(c.t)} aria-current={actual === c.n ? "step" : undefined}
                className={`w-full flex items-baseline gap-3 rounded-lg px-2 py-1.5 text-left text-[15px] ${actual === c.n ? "bg-cruz-soft text-cruz font-semibold" : "hover:bg-paper"}`}>
                <span className="num text-sm text-muted w-10 shrink-0">{mmss(c.t)}</span>
                <span className="min-w-0">{c.n}. {c.titulo}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>
    </section>
  );
}
