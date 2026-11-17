import Link from "next/link";
import { redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion } from "@/lib/sesion";
import { Cabecera, Dato } from "@/components/ui/Cabecera";
import { existenciasTexto } from "@/lib/formato";
import { atajos, rango } from "@/lib/reportes";
import { modoDe } from "@/lib/modo";
import { DESTINATARIOS, numeroEntrega } from "@/lib/entregas";
import { consumo, listaEntregas, puedeEntregar } from "@/lib/entregas-datos";

export const metadata = { title: "Entregas internas" };

const und = (n: number) => n.toLocaleString("es-CO");
const dmaHora = (f: string) => { const [d, h] = f.split(" "); return `${d.split("-").reverse().join("/")} ${h}`; };

export default async function Entregas({ searchParams }: { searchParams: Promise<{ desde?: string; hasta?: string; q?: string }> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puedeEntregar(s.rol)) redirect("/inicio?aviso=permiso");
  const sp = await searchParams;
  const r = rango(sp.desde, sp.hasta);
  const q = (sp.q ?? "").trim().slice(0, 60);
  const d = await comoUsuario(s, async (c) => (await modoDe(c, s.empresa)) === "interno"
    ? { lista: await listaEntregas(c, s.empresa, r.desde, r.hasta, q), con: await consumo(c, s.empresa, r.desde, r.hasta) } : null);
  if (!d) redirect("/caja");
  const filtro = `desde=${r.desde}&hasta=${r.hasta}`;
  const mismoDia = r.desde === r.hasta;
  const fecha = (f: string) => new Date(f + "T12:00:00").toLocaleDateString("es-CO", { day: "numeric", month: "long", year: "numeric" });

  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo="Entregas internas" sub={mismoDia ? fecha(r.desde) : `Del ${fecha(r.desde)} al ${fecha(r.hasta)}`}>
        <a href={`/api/entregas?${filtro}&formato=excel`} className="btn-borde">Descargar Excel</a>
        <Link href="/entregas/nueva" className="btn-primario">Nueva entrega</Link>
      </Cabecera>

      <form className="tarjeta p-4 grid gap-3 sm:flex sm:flex-wrap sm:items-end" aria-label="Filtrar entregas">
        <label className="grid text-sm text-muted">Desde<input type="date" name="desde" defaultValue={r.desde} className="campo sm:w-auto" /></label>
        <label className="grid text-sm text-muted">Hasta<input type="date" name="hasta" defaultValue={r.hasta} className="campo sm:w-auto" /></label>
        <label className="grid text-sm text-muted sm:flex-1 sm:min-w-56">Buscar<input type="search" name="q" defaultValue={q} placeholder="Quién recibe, documento, servicio o EI-12" className="campo" /></label>
        <button className="btn-oscuro">Ver</button>
        <p className="flex flex-wrap gap-x-3 gap-y-1 text-sm w-full">{atajos().map(([t, a, b]) => <Link key={t} href={`/entregas?desde=${a}&hasta=${b}`} className="font-semibold text-cruz underline-offset-4 hover:underline">{t}</Link>)}</p>
      </form>

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-3">
        <Dato titulo="Entregas" valor={und(d.con.entregas)} nota="sin contar las anuladas" />
        <Dato titulo="Unidades entregadas" valor={und(d.con.unidades)} tono="cruz" />
        <Dato titulo="Servicios o áreas" valor={und(d.con.porServicio.length)} />
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-2 gap-5">
        <section className="tarjeta p-5 min-w-0" aria-labelledby="servicio-titulo">
          <h2 id="servicio-titulo" className="titulo text-xl">Consumo por servicio o área</h2>
          {d.con.porServicio.length ? (
            <ul className="mt-3 divide-y divide-line">{d.con.porServicio.map((x) => (
              <li key={x.servicio} className="py-2 flex justify-between gap-3"><span className="min-w-0 [overflow-wrap:anywhere]">{x.servicio}</span>
                <span className="num text-muted shrink-0">{und(x.unidades)} und · {x.entregas} entrega{x.entregas === 1 ? "" : "s"}</span></li>
            ))}</ul>
          ) : <p className="mt-2 text-muted">Sin entregas en estas fechas.</p>}
        </section>
        <section className="tarjeta p-5 min-w-0" aria-labelledby="producto-titulo">
          <h2 id="producto-titulo" className="titulo text-xl">Lo que más sale</h2>
          {d.con.porProducto.length ? (
            <ul className="mt-3 divide-y divide-line">{d.con.porProducto.slice(0, 10).map((x) => (
              <li key={x.id} className="py-2 flex justify-between gap-3"><Link href={`/productos/${x.id}`} className="min-w-0 [overflow-wrap:anywhere] hover:underline">{x.nombre}</Link>
                <span className="num text-muted shrink-0">{existenciasTexto(x.unidades, x.unidades_por_caja)}</span></li>
            ))}</ul>
          ) : <p className="mt-2 text-muted">Sin entregas en estas fechas.</p>}
        </section>
      </div>

      <section className="tarjeta p-5 min-w-0" aria-labelledby="lista-titulo">
        <h2 id="lista-titulo" className="titulo text-xl">Entregas</h2>
        {d.lista.length ? (
          <ul className="mt-3 grid gap-2">{d.lista.map((e) => (
            <li key={e.id}>
              <Link href={`/entregas/${e.id}`} className={`rounded-xl border border-line p-3 text-sm grid sm:grid-cols-[6rem_1fr_auto] gap-1 sm:gap-3 hover:border-ink ${e.anulada ? "opacity-70" : ""}`}>
                <span className="num font-semibold">{numeroEntrega(e.numero)}</span>
                <span className="min-w-0 [overflow-wrap:anywhere]">
                  <span className="font-semibold">{e.destinatario}</span>
                  <span className="text-muted"> · {DESTINATARIOS[e.destinatario_tipo as keyof typeof DESTINATARIOS] ?? e.destinatario_tipo}{e.servicio && e.servicio !== e.destinatario ? ` · ${e.servicio}` : ""} · autoriza {e.autoriza}</span>
                  <span className="block text-muted num">{dmaHora(e.fecha)} · registró {e.usuario}</span>
                </span>
                <span className={`num sm:text-right ${e.anulada ? "text-alerta font-semibold" : "text-muted"}`}>{e.anulada ? "Anulada" : `${und(e.unidades)} und · ${e.productos} producto${e.productos === 1 ? "" : "s"}`}</span>
              </Link>
            </li>
          ))}</ul>
        ) : (
          <p className="mt-2 text-muted">{q ? "Ninguna entrega coincide con la búsqueda." : <>Sin entregas en estas fechas. <Link href="/entregas/nueva" className="underline">Registra la primera</Link>.</>}</p>
        )}
      </section>
    </main>
  );
}
