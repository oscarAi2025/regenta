import { redirect } from "next/navigation";
import { comoUsuario, puestoDeTrabajo } from "@/lib/db";
import { leerSesion } from "@/lib/sesion";
import { Cabecera } from "@/components/ui/Cabecera";
import { cajaElegida } from "@/lib/caja-elegida";
import { CATEGORIAS, puedeResultados } from "@/lib/gastos";
import { filtroGastos, listaGastos } from "@/lib/gastos-datos";
import { hoyBogota } from "@/lib/reportes";
import { Pestanas } from "../reportes/Pestanas";
import { Gastos } from "./Gastos";

export const metadata = { title: "Gastos" };

export default async function PaginaGastos({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puedeResultados(s.rol)) redirect("/inicio?aviso=permiso");
  const f = filtroGastos(await searchParams);
  const caja = await cajaElegida();
  const { filas, puesto } = await comoUsuario(s, async (c) => {
    const p = await puestoDeTrabajo(c, s.empresa, caja);
    const cj = p.caja_id ? (await c.query(`select cj.nombre, exists (select 1 from turnos t where t.caja_id = cj.id and t.estado = 'abierto') turno from cajas cj where cj.id = $1`, [p.caja_id])).rows[0] : null;
    return { filas: await listaGastos(c, s.empresa, f), puesto: cj ? { caja: cj.nombre as string, turno: !!cj.turno } : null };
  });
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString();
  const enlace = (estado: string) => { const u = new URLSearchParams(Object.entries({ ...f, estado }).filter(([, v]) => v) as [string, string][]); return `/gastos${u.size ? "?" + u : ""}`; };
  const filtrado = !!(f.desde || f.hasta || f.categoria || f.q);
  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo="Gastos" sub="Arriendo, servicios, nómina y demás gastos de la droguería. Entran al estado de resultados.">
        <a href={`/api/gastos?${qs ? qs + "&" : ""}formato=excel`} className="btn-borde" download>Descargar en Excel</a>
      </Cabecera>
      <Pestanas actual="/gastos" />
      <Gastos inicial={filas} qs={qs} hoy={hoyBogota()} puesto={puesto} filtrado={filtrado || !!f.estado} filtros={<>
      <nav aria-label="Estado" className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin]">
        {([["", "Todos"], ["vigentes", "Vigentes"], ["anulados", "Anulados"]] as const).map(([k, t]) => <a key={k || "todos"} href={enlace(k)} aria-current={f.estado === k ? "page" : undefined}
          className={`shrink-0 px-3 py-1.5 rounded-lg text-sm font-semibold border ${f.estado === k ? "bg-ink text-white border-ink" : "bg-surface text-muted border-line hover:text-ink"}`}>{t}</a>)}
      </nav>
      <form className="tarjeta p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,1.4fr)_150px_150px_auto] lg:items-end" role="search" aria-label="Filtrar gastos">
        {f.estado && <input type="hidden" name="estado" value={f.estado} />}
        <div><label htmlFor="f-q" className="etiqueta">Buscar</label><input id="f-q" name="q" defaultValue={f.q} className="campo" placeholder="Descripción, referencia o G-12" /></div>
        <div><label htmlFor="f-categoria" className="etiqueta">Categoría</label>
          <select id="f-categoria" name="categoria" defaultValue={f.categoria} className="campo"><option value="">Todas</option>{CATEGORIAS.map(([k, t]) => <option key={k} value={k}>{t}</option>)}</select></div>
        <div><label htmlFor="f-desde" className="etiqueta">Desde</label><input id="f-desde" name="desde" type="date" defaultValue={f.desde} className="campo" /></div>
        <div><label htmlFor="f-hasta" className="etiqueta">Hasta</label><input id="f-hasta" name="hasta" type="date" defaultValue={f.hasta} className="campo" /></div>
        <div className="flex gap-2"><button className="btn-oscuro">Filtrar</button>{filtrado && <a href={enlace(f.estado)} className="btn-borde">Limpiar</a>}</div>
      </form></>} />
    </main>
  );
}
