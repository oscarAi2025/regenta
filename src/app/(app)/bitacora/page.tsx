import { redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion } from "@/lib/sesion";
import { Cabecera } from "@/components/ui/Cabecera";
import { puedeResultados } from "@/lib/gastos";
import { POR_PAGINA, TIPOS_BITACORA, bitacora, filtroBitacora } from "@/lib/bitacora";
import { Pestanas } from "../reportes/Pestanas";

export const metadata = { title: "Bitácora" };

const TONO: Record<string, string> = { anulacion: "bg-alerta-soft text-alerta", devolucion: "bg-aviso-soft text-aviso", turno: "bg-alerta-soft text-alerta", descuento: "bg-aviso-soft text-aviso" };

export default async function Bitacora({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puedeResultados(s.rol)) redirect("/inicio?aviso=permiso");
  const f = filtroBitacora(await searchParams);
  const { datos, usuarios } = await comoUsuario(s, async (c) => ({
    datos: await bitacora(c, s.empresa, f),
    usuarios: (await c.query(`select user_id::text id, nombre from miembros where empresa_id = $1 order by nombre`, [s.empresa])).rows as { id: string; nombre: string }[],
  }));
  const enlace = (cambios: Partial<typeof f>) => {
    const x = { ...f, ...cambios };
    const u = new URLSearchParams(Object.entries({ tipo: x.tipo, usuario: x.usuario, desde: x.desde, hasta: x.hasta, pagina: x.pagina > 1 ? String(x.pagina) : "" }).filter(([, v]) => v) as [string, string][]);
    return `/bitacora${u.size ? "?" + u : ""}`;
  };
  const filtrado = !!(f.tipo || f.usuario || f.desde || f.hasta);
  const nombre = (n: string) => n.split(" (")[0];
  const desde = (f.pagina - 1) * POR_PAGINA + 1, hasta = Math.min(datos.total, f.pagina * POR_PAGINA);

  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo="Bitácora" sub="Quién cambió qué y cuándo: precios, anulaciones, devoluciones, descuentos, ajustes, cajas y crédito." />
      <Pestanas actual="/bitacora" />
      <nav aria-label="Tipo de evento" className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin]">
        {([["", "Todo"], ...Object.entries(TIPOS_BITACORA).map(([k, x]) => [k, x.nombre])] as [string, string][]).map(([k, t]) => (
          <a key={k || "todo"} href={enlace({ tipo: k, pagina: 1 })} aria-current={f.tipo === k ? "page" : undefined}
            className={`shrink-0 px-3 py-1.5 rounded-lg text-sm font-semibold border ${f.tipo === k ? "bg-ink text-white border-ink" : "bg-surface text-muted border-line hover:text-ink"}`}>{t}</a>
        ))}
      </nav>
      <form className="tarjeta p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1.3fr)_150px_150px_auto] lg:items-end" role="search" aria-label="Filtrar la bitácora">
        <div><label htmlFor="b-tipo" className="etiqueta">Tipo</label>
          <select id="b-tipo" name="tipo" defaultValue={f.tipo} className="campo"><option value="">Todo</option>{Object.entries(TIPOS_BITACORA).map(([k, x]) => <option key={k} value={k}>{x.nombre}</option>)}</select></div>
        <div><label htmlFor="b-usuario" className="etiqueta">Usuario</label>
          <select id="b-usuario" name="usuario" defaultValue={f.usuario} className="campo"><option value="">Todos</option>{usuarios.map((u) => <option key={u.id} value={u.id}>{nombre(u.nombre)}</option>)}</select></div>
        <div><label htmlFor="b-desde" className="etiqueta">Desde</label><input id="b-desde" name="desde" type="date" defaultValue={f.desde} className="campo" /></div>
        <div><label htmlFor="b-hasta" className="etiqueta">Hasta</label><input id="b-hasta" name="hasta" type="date" defaultValue={f.hasta} className="campo" /></div>
        <div className="flex gap-2"><button className="btn-oscuro">Filtrar</button>{filtrado && <a href="/bitacora" className="btn-borde">Limpiar</a>}</div>
      </form>

      <section className="tarjeta" aria-label="Eventos">
        <div className="flex flex-wrap justify-between items-baseline gap-2 px-4 pt-4">
          <h2 className="titulo text-xl">{f.tipo ? TIPOS_BITACORA[f.tipo].nombre : "Todos los eventos"}</h2>
          <p className="text-sm text-muted num">{datos.total ? `${desde}–${hasta} de ${datos.total}` : "Sin eventos"}</p>
        </div>
        {datos.filas.length === 0 ? (
          <p className="px-4 py-10 text-center text-muted">{f.pagina > 1 ? <>No hay eventos en esta página. <a href={enlace({ pagina: 1 })} className="underline">Volver a la primera</a></>
            : filtrado ? "No hay eventos con ese filtro." : "Todavía no hay eventos para revisar."}</p>
        ) : (
          <ol className="divide-y divide-line mt-2" aria-label="Lista de eventos">
            {datos.filas.map((x) => (
              <li key={x.clave} className="px-4 py-3 grid gap-1 sm:grid-cols-[150px_minmax(0,1fr)] sm:gap-4">
                <div className="text-sm text-muted"><span className="num">{x.fecha}</span><span className="block font-semibold text-ink">{x.usuario}</span></div>
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2"><b>{x.titulo}</b>{x.tipo_nombre && <span className={`rounded-md px-2 py-0.5 text-xs font-semibold ${TONO[x.tipo] ?? "bg-paper text-muted"}`}>{x.tipo_nombre}</span>}</p>
                  <p className="text-[15px] break-words">{x.detalle}</p>
                </div>
              </li>
            ))}
          </ol>
        )}
        {datos.paginas > 1 && (
          <nav aria-label="Páginas" className="flex flex-wrap items-center justify-between gap-2 px-4 py-3 border-t border-line">
            {f.pagina > 1 ? <a href={enlace({ pagina: f.pagina - 1 })} className="btn-borde" rel="prev">Anterior</a> : <span />}
            <span className="text-sm text-muted num">Página {f.pagina} de {datos.paginas}</span>
            {f.pagina < datos.paginas ? <a href={enlace({ pagina: f.pagina + 1 })} className="btn-borde" rel="next">Siguiente</a> : <span />}
          </nav>
        )}
      </section>
    </main>
  );
}
