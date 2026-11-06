"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { AREAS, dec, rangoTexto, type Area, type Rango } from "@/lib/temperatura-comun";

const num = (t: string) => { const v = t.trim().replace(",", "."); return v === "" ? null : /^-?\d+(\.\d+)?$/.test(v) ? Number(v) : NaN; };

/** Rangos aceptables por área. Los define cada droguería (vienen valores de partida); dueño y administrador los cambian. */
export function Rangos({ rangos, editable, demo = false }: { rangos: Rango[]; editable: boolean; demo?: boolean }) {
  const router = useRouter();
  const [editando, setEditando] = useState<Area | null>(null);
  const [v, setV] = useState({ tmin: "", tmax: "", hmin: "", hmax: "" });
  const [msg, setMsg] = useState<{ ok: boolean; t: string } | null>(null);
  const [enviando, setEnviando] = useState(false);
  function editar(r: Rango) {
    setEditando(r.area); setMsg(null);
    setV({ tmin: dec(r.temp_min), tmax: dec(r.temp_max), hmin: r.hum_min === null ? "" : dec(r.hum_min), hmax: r.hum_max === null ? "" : dec(r.hum_max) });
  }
  async function guardar(e: React.FormEvent) {
    e.preventDefault();
    const c = { area: editando, temp_min: num(v.tmin), temp_max: num(v.tmax), hum_min: num(v.hmin), hum_max: num(v.hmax) };
    if ([c.temp_min, c.temp_max, c.hum_min, c.hum_max].some((x) => Number.isNaN(x)) || c.temp_min === null || c.temp_max === null) { setMsg({ ok: false, t: "Escribe solo números (por ejemplo 2 u 8,5)" }); return; }
    setEnviando(true); setMsg(null);
    const r = await fetch("/api/temperatura", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(c) }).catch(() => null);
    setEnviando(false);
    if (!r) { setMsg({ ok: false, t: "Sin conexión: revisa internet e intenta de nuevo." }); return; }
    if (!r.ok) { setMsg({ ok: false, t: (await r.json().catch(() => ({}))).error ?? "No se pudo guardar" }); return; }
    setEditando(null); setMsg({ ok: true, t: "Rango guardado. Aplica a los registros que se hagan desde ahora." });
    router.refresh();
  }
  const campo = (k: keyof typeof v, etiqueta: string) => (
    <label className="grid gap-1 text-sm font-semibold">{etiqueta}
      <input id={`r-${k}`} inputMode="decimal" autoComplete="off" value={v[k]} onChange={(e) => setV({ ...v, [k]: e.target.value })} className="campo num font-normal" />
    </label>
  );
  return (
    <section className="tarjeta p-5" aria-label="Rangos">
      <h2 className="titulo text-xl">Rangos de tu droguería</h2>
      <p className="text-sm text-muted mt-1">Cada registro se compara con el rango configurado por tu droguería{demo ? ". En la demo quedan fijos para que todos los visitantes vean lo mismo; en tu droguería el dueño o el administrador los ajustan aquí." : editable ? ". Ajústalo según tu procedimiento interno." : "; lo cambian el dueño o el administrador."}</p>
      <ul className="mt-3 grid gap-3">
        {rangos.map((r) => (
          <li key={r.area} className="rounded-xl border border-line p-3">
            {editando === r.area ? (
              <form onSubmit={guardar} className="grid gap-3" aria-label={`Editar rango de ${AREAS[r.area]}`}>
                <p className="font-semibold">{AREAS[r.area]}</p>
                <div className="grid grid-cols-2 gap-3">{campo("tmin", "Temperatura mínima (°C)")}{campo("tmax", "Temperatura máxima (°C)")}</div>
                <div className="grid grid-cols-2 gap-3">{campo("hmin", "Humedad mínima (%)")}{campo("hmax", "Humedad máxima (%)")}</div>
                {r.area === "frio" && <p className="text-xs text-muted">Deja la humedad vacía si en la nevera no la controlas.</p>}
                <div className="flex gap-2">
                  <button disabled={enviando} className="btn-primario flex-1">{enviando ? "Guardando…" : "Guardar rango"}</button>
                  <button type="button" onClick={() => { setEditando(null); setMsg(null); }} className="btn-borde">Cancelar</button>
                </div>
              </form>
            ) : (
              <div className="flex items-start justify-between gap-3">
                <div className="text-sm">
                  <p className="font-semibold text-[15px]">{AREAS[r.area]}</p>
                  <p className="num">Temperatura: {rangoTexto(r.temp_min, r.temp_max, "°C")}</p>
                  <p className="num">Humedad: {rangoTexto(r.hum_min, r.hum_max, "%")}</p>
                  {!r.personalizado && <p className="text-xs text-muted">Valores de partida: revísalos.</p>}
                </div>
                {editable && <button type="button" onClick={() => editar(r)} aria-label={`Cambiar rango de ${AREAS[r.area]}`} className="btn-borde h-9 px-3 text-sm">Cambiar</button>}
              </div>
            )}
          </li>
        ))}
      </ul>
      {msg && <p role={msg.ok ? "status" : "alert"} className={`mt-3 text-sm font-semibold ${msg.ok ? "text-cruz" : "text-alerta"}`}>{msg.t}</p>}
    </section>
  );
}
