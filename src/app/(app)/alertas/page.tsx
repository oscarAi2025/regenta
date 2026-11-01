import { redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion, puede } from "@/lib/sesion";
import { Cabecera, Dato } from "@/components/ui/Cabecera";
import { Revisar } from "./Revisar";

export const metadata = { title: "Alertas INVIMA" };

type Fila = { alerta_id: number; numero: string; tipo: string; titulo: string; motivo: string | null; fecha: string; url: string; pdf: string | null; recomendacion: string | null;
  producto_id: string | null; producto: string | null; nivel: "lote" | "registro" | "nombre" | null; lote: string | null; unidades: number | null; revisada: string | null; revisada_el: string | null };

const fecha = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" });
const NIVEL = { lote: ["Tienes este lote", "bg-alerta text-white"], registro: ["Mismo registro sanitario", "bg-alerta-soft text-alerta"], nombre: ["Revisa: mismo producto por nombre", "bg-aviso-soft text-aviso"] } as const;
const RESULTADO: Record<string, string> = { separado: "Producto separado", sin_lote: "Revisado: no se tiene el lote", no_aplica: "Revisado: no es el mismo producto" };

export default async function Alertas() {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  const filas: Fila[] = await comoUsuario(s, async (c) => (await c.query(`select alerta_id::int, numero, tipo, titulo, motivo, fecha::text, url, pdf, recomendacion, producto_id, producto, nivel, lote, unidades, revisada,
    to_char(revisada_el at time zone 'America/Bogota', 'DD/MM/YYYY HH24:MI') revisada_el from alertas_empresa($1) order by fecha desc, numero desc`, [s.empresa])).rows);
  const ultima = await comoUsuario(s, async (c) => (await c.query(`select to_char(max(creado) at time zone 'America/Bogota', 'DD/MM/YYYY HH24:MI') t from alertas_invima`)).rows[0].t as string | null);
  const alertas = [...new Map(filas.map((f) => [f.alerta_id, f])).values()];
  const orden = { lote: 0, registro: 1, nombre: 2 } as const;
  // Primero lo pendiente y lo más seguro (tienes el lote), luego lo revisado.
  const cruces = filas.filter((f) => f.nivel).sort((a, b) => Number(!!a.revisada) - Number(!!b.revisada) || orden[a.nivel!] - orden[b.nivel!]);
  const pendientes = cruces.filter((f) => !f.revisada);
  const gestiona = puede.moverInventario(s.rol);

  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo="Alertas INVIMA" sub={`Alertas sanitarias de medicamentos publicadas por el INVIMA en el último año, cruzadas con tu inventario por lote, registro sanitario y nombre.${ultima ? ` Última actualización: ${ultima}.` : ""}`} />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Dato titulo="Te tocan y falta revisar" valor={pendientes.length} tono={pendientes.length ? "alerta" : "cruz"} nota={pendientes.length ? "revísalas hoy" : "todo revisado"} />
        <Dato titulo="Tienes el lote alertado" valor={cruces.filter((f) => f.nivel === "lote" && !f.revisada).length} tono={cruces.some((f) => f.nivel === "lote" && !f.revisada) ? "alerta" : undefined} />
        <Dato titulo="Coincidencias revisadas" valor={cruces.length - pendientes.length} />
        <Dato titulo="Alertas del año" valor={alertas.length} />
      </div>

      {cruces.length > 0 && (
        <section className="grid gap-3" aria-label="Alertas que tocan tu inventario">
          <h2 className="titulo text-2xl">Tocan tu inventario</h2>
          {cruces.map((f) => (
            <article key={`${f.alerta_id}-${f.producto_id}`} className={`tarjeta p-5 grid gap-3 ${!f.revisada && f.nivel === "lote" ? "border-2 border-alerta" : ""}`}>
              <div className="flex flex-wrap items-center gap-2 text-sm">
                <span className={`rounded-md px-2 py-0.5 font-semibold ${NIVEL[f.nivel!][1]}`}>{NIVEL[f.nivel!][0]}</span>
                <span className="text-muted">Alerta {f.numero} · {fecha(f.fecha)}{f.motivo ? ` · ${f.motivo}` : ""}</span>
              </div>
              <p className="font-semibold text-lg leading-snug">{f.titulo}</p>
              <p><span className="text-muted">Tu producto:</span> <b>{f.producto}</b>{f.lote ? <> · lote <b>{f.lote}</b> · {f.unidades} und en existencias</> : null}</p>
              {f.recomendacion && <p className="text-sm bg-paper rounded-lg px-3 py-2">{f.recomendacion}</p>}
              <div className="flex flex-wrap items-center gap-3">
                {f.revisada ? <p className="text-cruz font-semibold">{RESULTADO[f.revisada]} · {f.revisada_el}</p> : gestiona ? <Revisar alerta={f.alerta_id} producto={f.producto_id!} nivel={f.nivel!} /> : <p className="text-aviso font-semibold">Avísale al regente o al dueño.</p>}
                <a href={f.url} target="_blank" rel="noopener" className="text-sm font-semibold text-cruz underline ml-auto">Ver alerta oficial</a>
              </div>
            </article>
          ))}
        </section>
      )}

      <section className="tarjeta overflow-x-auto" aria-label="Todas las alertas">
        <h2 className="titulo text-xl px-5 pt-4">Todas las alertas de medicamentos</h2>
        <ul className="divide-y divide-line mt-2">
          {alertas.map((a) => (
            <li key={a.alerta_id} className="px-5 py-3 flex flex-wrap gap-x-4 gap-y-1 items-baseline">
              <span className="text-sm text-muted w-28 shrink-0">{a.numero} · {fecha(a.fecha)}</span>
              <span className="flex-1 min-w-60">{a.titulo}{a.tipo === "informe" ? <span className="text-muted text-sm"> · informe de seguridad</span> : a.motivo ? <span className="text-muted text-sm"> · {a.motivo}</span> : null}</span>
              <a href={a.url} target="_blank" rel="noopener" className="text-sm font-semibold text-cruz underline">Ver</a>
            </li>
          ))}
        </ul>
      </section>
    </main>
  );
}
