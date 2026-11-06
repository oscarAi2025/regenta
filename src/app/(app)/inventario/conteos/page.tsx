import Link from "next/link";
import { redirect } from "next/navigation";
import { comoUsuario, puestoDeTrabajo } from "@/lib/db";
import { leerSesion, puede } from "@/lib/sesion";
import { cajaElegida } from "@/lib/caja-elegida";
import { Cabecera } from "@/components/ui/Cabecera";
import { IniciarConteo } from "./IniciarConteo";

export const metadata = { title: "Conteo físico" };

type Conteo = { id: string; numero: number; estado: string; alcance: string; filtro: string | null; resumen: { con_diferencia?: number } | null; ajuste: number | null;
  inicio: string; fin: string | null; lotes: number; contados: number; responsable: string | null; esta_sede: boolean };
const ALCANCE: Record<string, string> = { todo: "Todo el inventario", laboratorio: "Laboratorio", categoria: "Categoría" };

export default async function Conteos() {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puede.moverInventario(s.rol)) redirect("/inventario?aviso=permiso");
  const d = await comoUsuario(s, async (c) => {
    const { sede_id } = await puestoDeTrabajo(c, s.empresa, await cajaElegida());
    const conteos: Conteo[] = (await c.query(`select k.id, k.numero, k.estado, k.alcance, k.filtro, k.resumen, aj.numero ajuste,
        to_char(k.creado at time zone 'America/Bogota', 'DD/MM/YYYY HH24:MI') inicio, to_char(k.cerrado at time zone 'America/Bogota', 'DD/MM/YYYY HH24:MI') fin,
        (select count(*) from conteo_lineas cl where cl.conteo_id = k.id)::int lotes, (select count(*) from conteo_lineas cl where cl.conteo_id = k.id and cl.contado is not null)::int contados,
        mi.nombre responsable, k.sede_id = $2 esta_sede
      from conteos k left join ajustes aj on aj.id = k.ajuste_id left join miembros mi on mi.empresa_id = k.empresa_id and mi.user_id = k.usuario_id
      where k.empresa_id = $1 order by k.creado desc limit 60`, [s.empresa, sede_id])).rows;
    const opciones = (await c.query(`select array(select distinct trim(p.laboratorio) from productos p join v_stock_lotes st on st.producto_id = p.id
          where p.empresa_id = $1 and st.sede_id = $2 and st.unidades > 0 and coalesce(trim(p.laboratorio), '') <> '' order by 1) laboratorios,
        array(select distinct trim(p.categoria) from productos p join v_stock_lotes st on st.producto_id = p.id
          where p.empresa_id = $1 and st.sede_id = $2 and st.unidades > 0 and coalesce(trim(p.categoria), '') <> '' order by 1) categorias`, [s.empresa, sede_id])).rows[0];
    return { conteos, laboratorios: opciones.laboratorios as string[], categorias: opciones.categorias as string[] };
  });
  const abierto = d.conteos.find((k) => k.estado === "abierto" && k.esta_sede);
  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo="Conteo físico" sub="Toma de inventario: cuenta lo que hay en la estantería, mira las diferencias por lote y ajusta todo en un solo paso.">
        <Link href="/inventario" className="btn-borde">Volver a inventario</Link>
      </Cabecera>
      {abierto ? (
        <section className="tarjeta p-4 sm:p-5 flex flex-wrap items-center gap-4 border-aviso" aria-labelledby="abierto-t">
          <div className="flex-1 min-w-[220px]">
            <h2 id="abierto-t" className="titulo text-xl">Conteo N.º {abierto.numero} en curso</h2>
            <p className="text-sm text-muted num">{abierto.alcance === "todo" ? ALCANCE.todo : `${ALCANCE[abierto.alcance]}: ${abierto.filtro}`} · {abierto.contados.toLocaleString("es-CO")} de {abierto.lotes.toLocaleString("es-CO")} lotes contados · empezó {abierto.inicio}</p>
          </div>
          <Link href={`/inventario/conteos/${abierto.id}`} className="btn-primario">Seguir contando</Link>
        </section>
      ) : (
        <IniciarConteo laboratorios={d.laboratorios} categorias={d.categorias} />
      )}
      <section aria-labelledby="conteos-t" className="grid gap-3">
        <h2 id="conteos-t" className="titulo text-2xl">Conteos anteriores</h2>
        {d.conteos.length === 0 ? <p className="tarjeta p-8 text-center text-muted">Todavía no has hecho ningún conteo.</p> : (
          <ul className="tarjeta divide-y divide-line">
            {d.conteos.map((k) => (
              <li key={k.id} className="px-4 py-3 flex flex-wrap items-center gap-x-4 gap-y-1">
                <div className="flex-1 min-w-[200px]">
                  <p className="font-semibold">Conteo N.º {k.numero} · <span className={k.estado === "abierto" ? "text-aviso" : k.estado === "anulado" ? "text-muted" : "text-cruz"}>{k.estado}</span></p>
                  <p className="text-sm text-muted num">{k.alcance === "todo" ? ALCANCE.todo : `${ALCANCE[k.alcance]}: ${k.filtro}`} · {k.inicio}{k.fin ? ` → ${k.fin}` : ""} · {String(k.responsable ?? "").split(" (")[0]}</p>
                </div>
                <p className="text-sm num">{k.estado === "cerrado"
                  ? <>{Number(k.resumen?.con_diferencia ?? 0).toLocaleString("es-CO")} con diferencia{k.ajuste ? ` · ajuste N.º ${k.ajuste}` : " · sin ajuste"}</>
                  : <>{k.contados.toLocaleString("es-CO")} de {k.lotes.toLocaleString("es-CO")} contados</>}</p>
                <Link href={`/inventario/conteos/${k.id}`} className="btn-borde h-9 px-3 text-sm" aria-label={`Ver conteo N.º ${k.numero}`}>Ver</Link>
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
