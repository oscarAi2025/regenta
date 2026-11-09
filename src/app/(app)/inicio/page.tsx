import Link from "next/link";
import { redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion, puede } from "@/lib/sesion";
import { Cabecera, Dato, pesos } from "@/components/ui/Cabecera";
import { EstadoDian } from "@/components/ui/EstadoDian";
import { Isotipo } from "@/components/Marca";
import { PreguntarIA } from "@/components/app/PreguntarIA";
import { MEDIO } from "@/lib/formato";
import { hoyBogota, resultados } from "@/lib/reportes";

export const metadata = { title: "Inicio" };

// $1,4 M · $850 mil: legible en barras angostas.
const corto = (n: number) => (n >= 1e6 ? `$${(n / 1e6).toLocaleString("es-CO", { maximumFractionDigits: 1 })} M` : n >= 1e3 ? `$${Math.round(n / 1e3)} mil` : pesos(n));

export default async function Inicio() {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  const costos = puede.verCostos(s.rol);
  const d = await comoUsuario(s, async (c) => {
    const hoy = (await c.query(`
      select count(*)::int ventas, coalesce(sum(total), 0)::float total, coalesce(avg(total), 0)::float promedio
      from ventas where empresa_id = $1 and estado = 'cerrada' and creado >= date_trunc('day', now() at time zone 'America/Bogota') at time zone 'America/Bogota'`, [s.empresa])).rows[0];
    const medios = (await c.query(`
      select p.medio, sum(p.valor - case when p.medio = 'efectivo' and p.primero_efectivo then v.cambio else 0 end)::float valor
      from (select *, row_number() over (partition by venta_id, medio order by id) = 1 primero_efectivo from pagos) p join ventas v on v.id = p.venta_id
      where v.empresa_id = $1 and v.estado = 'cerrada' and v.creado >= date_trunc('day', now() at time zone 'America/Bogota') at time zone 'America/Bogota'
      group by p.medio order by 2 desc`, [s.empresa])).rows;
    const semana = (await c.query(`
      select to_char(d, 'YYYY-MM-DD') dia, coalesce(sum(v.total), 0)::float total
      from generate_series((now() at time zone 'America/Bogota')::date - 6, (now() at time zone 'America/Bogota')::date, '1 day') d
      left join ventas v on v.empresa_id = $1 and v.estado = 'cerrada' and (v.creado at time zone 'America/Bogota')::date = d
      group by d order by d`, [s.empresa])).rows as { dia: string; total: number }[];
    // Utilidad de hoy con las mismas reglas del estado de resultados: neta de devoluciones y sin los lotes sin costo.
    const margen = costos ? await resultados(c, s.empresa, { desde: hoyBogota(), hasta: hoyBogota() }) : null;
    const alertas = (await c.query(`
      select
        (select count(distinct producto_id) from v_stock_lotes where empresa_id = $1 and unidades > 0 and vence between current_date and current_date + 30)::int vencen,
        (select count(*) from productos p where empresa_id = $1 and activo and coalesce((select sum(unidades) from v_stock_vigente where producto_id = p.id), 0) <= 0)::int agotados,
        (select count(*) from productos p where empresa_id = $1 and activo and stock_minimo > 0
           and coalesce((select sum(unidades) from v_stock_vigente where producto_id = p.id), 0) between 1 and p.stock_minimo * p.unidades_por_caja)::int bajos,
        (select count(*) from documentos_dian where empresa_id = $1 and estado in ('pendiente', 'enviando'))::int dian_pend,
        (select count(*) from documentos_dian where empresa_id = $1 and estado = 'rechazado')::int dian_rech`, [s.empresa])).rows[0];
    const ultimas = (await c.query(`
      select v.id, v.prefijo || v.numero numero, v.total::float, v.estado, to_char(v.creado at time zone 'America/Bogota', 'HH24:MI') hora, d.estado dian
      from ventas v left join documentos_dian d on d.venta_id = v.id and d.tipo = v.tipo_doc
      where v.empresa_id = $1 order by v.creado desc limit 6`, [s.empresa])).rows;
    // Una sola pasada por la predicción (cada función recorre 8 semanas de movimientos).
    const pred = puede.moverInventario(s.rol) ? (await c.query(`
      with p as materialized (select * from prediccion_productos($1)), r as materialized (select * from riesgo_vencimiento($1))
      select (select count(*) from p where sugerido_unidades > 0 and venta_dia > 0)::int pedir,
             (select count(*) from p where venta_dia > 0 and dias_cobertura < 7)::int agotan,
             (select coalesce(json_agg(x), '[]') from (select nombre, floor(dias_cobertura)::int dias from p where venta_dia > 0 and dias_cobertura < 7 order by dias_cobertura, venta_dia desc limit 3) x) agotan_top,
             (select count(*) from r)::int lotes,
             (select coalesce(sum(valor_en_riesgo), 0) from r)::float riesgo,
             (select json_build_object('nombre', nombre, 'lote', lote, 'unidades', unidades_en_riesgo, 'valor', valor_en_riesgo, 'dias', dias) from r order by coalesce(valor_en_riesgo, unidades_en_riesgo) desc limit 1) top_riesgo`, [s.empresa])).rows[0] as
      { pedir: number; agotan: number; agotan_top: { nombre: string; dias: number }[]; lotes: number; riesgo: number; top_riesgo: { nombre: string; lote: string; unidades: number; valor: number | null; dias: number } | null } : null;
    const hoyPatron = (await c.query(`select nombre, frente_al_promedio from patron_semanal($1) where dia = extract(isodow from (now() at time zone 'America/Bogota'))::int`, [s.empresa])).rows[0] as { nombre: string; frente_al_promedio: number | null } | undefined;
    const invima = (await c.query(`select count(*) filter (where nivel is not null and revisada is null)::int pendientes,
      count(*) filter (where nivel = 'lote' and revisada is null)::int lote from alertas_empresa($1)`, [s.empresa])).rows[0];
    // Primeros pasos del dueño (desaparecen al completarse).
    const pasos = s.rol === "dueno" ? (await c.query(`select e.demo,
        exists (select 1 from productos where empresa_id = $1 and activo) productos,
        exists (select 1 from v_stock_vigente v join productos p on p.id = v.producto_id where p.empresa_id = $1 and v.unidades > 0) inventario,
        (select count(*) from miembros where empresa_id = $1 and activo) > 1 equipo,
        exists (select 1 from resoluciones_dian where empresa_id = $1 and activa and tipo = 'pos' and not pruebas) dian,
        exists (select 1 from ventas where empresa_id = $1) venta
      from empresas e where e.id = $1`, [s.empresa])).rows[0] : null;
    return { hoy, medios, semana, margen, alertas, ultimas, pred, invima, hoyPatron, pasos };
  });
  const max = Math.max(1, ...d.semana.map((x) => x.total));
  const hora = Number(new Date().toLocaleString("en-US", { timeZone: "America/Bogota", hour: "numeric", hour12: false }));
  const saludo = hora < 5 ? "Buenas noches" : hora < 12 ? "Buenos días" : hora < 19 ? "Buenas tardes" : "Buenas noches";
  const ganancia = d.margen ? d.margen.utilidad_bruta : null;

  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo={`${saludo}, ${s.nombre.split(" (")[0]}`} sub={new Date().toLocaleDateString("es-CO", { timeZone: "America/Bogota", weekday: "long", day: "numeric", month: "long" })}>
        {puede.vender(s.rol) && <Link href="/caja" className="btn-primario">Abrir caja</Link>}
        {puede.moverInventario(s.rol) && <Link href="/inventario/recibir" className="btn-borde">Recibir mercancía</Link>}
      </Cabecera>

      {d.pasos && !d.pasos.demo && !(d.pasos.productos && d.pasos.inventario && d.pasos.equipo && d.pasos.dian && d.pasos.venta) && (
        <section className="tarjeta p-5" aria-label="Primeros pasos">
          <h2 className="titulo text-xl">Primeros pasos</h2>
          <p className="text-sm text-muted mt-1">Deja tu droguería lista. Cada paso se marca solo cuando lo haces.</p>
          <ol className="mt-3 grid sm:grid-cols-2 lg:grid-cols-5 gap-2">
            {([["productos", "Carga tus productos", "/productos/importar"], ["inventario", "Recibe tu inventario por lote", "/inventario/recibir"],
               ["equipo", "Crea a tu equipo", "/equipo"], ["dian", "Habilitación DIAN (la hacemos contigo)", "/equipo"], ["venta", "Haz tu primera venta", "/caja"]] as const).map(([k, t, href], i) => (
              <li key={k}>
                <Link href={href} className={`flex items-center gap-2 rounded-xl border-2 p-3 text-sm h-full ${d.pasos![k] ? "border-cruz bg-cruz-soft" : "border-line hover:border-ink"}`}>
                  <span aria-hidden="true" className={`grid place-items-center w-7 h-7 rounded-full shrink-0 font-semibold ${d.pasos![k] ? "bg-cruz text-cruz-ink" : "bg-line"}`}>{d.pasos![k] ? "✓" : i + 1}</span>
                  <span className={d.pasos![k] ? "line-through text-muted" : "font-semibold"}>{t}</span>
                  <span className="sr-only">{d.pasos![k] ? "(hecho)" : "(pendiente)"}</span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3" aria-label="Hoy">
        <Dato titulo="Vendido hoy" valor={pesos(d.hoy.total)} tono="cruz" nota={`${d.hoy.ventas} venta${d.hoy.ventas === 1 ? "" : "s"}`} />
        <Dato titulo="Ticket promedio" valor={pesos(d.hoy.promedio)} />
        {ganancia !== null ? <Dato titulo="Ganancia bruta hoy" valor={pesos(ganancia)} nota={<>{d.margen!.margen !== null ? `Margen ${Math.round(d.margen!.margen)} % sobre la venta sin IVA` : "Sin ventas con costo todavía"}
            {d.margen!.sin_costo.netas > 0 && <span className="block text-aviso">{pesos(d.margen!.sin_costo.netas)} vendidos sin costo registrado</span>}</>} />
          : <Dato titulo="Ventas de hoy" valor={d.hoy.ventas} />}
        <Dato titulo="Por vencer en 30 días" valor={d.alertas.vencen} tono={d.alertas.vencen ? "alerta" : undefined} nota={<Link className="inline-block underline" href="/inventario">Ver lotes</Link>} />
      </section>

      {d.invima.pendientes > 0 && (
        <Link href="/alertas" className={`rounded-2xl p-5 flex flex-wrap items-center gap-4 ${d.invima.lote ? "bg-alerta text-white" : "bg-aviso-soft text-aviso"} hover:brightness-105`}>
          <p className="flex-1 min-w-60"><b className="titulo text-xl">{d.invima.lote ? `Tienes en existencias un lote con alerta del INVIMA` : `${d.invima.pendientes} alerta${d.invima.pendientes === 1 ? "" : "s"} del INVIMA coincide${d.invima.pendientes === 1 ? "" : "n"} con tu inventario`}</b>
            <span className="block mt-1 opacity-90">Revísalo ahora y deja constancia de lo que hiciste.</span></p>
          <span className={d.invima.lote ? "btn bg-white text-alerta" : "btn-oscuro"}>Revisar alertas</span>
        </Link>
      )}

      {d.pred && (
        <section className="rounded-2xl bg-ink text-white p-5 sm:p-6 grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)] gap-6" aria-label="Prioridades de hoy">
          <div>
            <div className="flex items-center gap-2"><Isotipo size={26} claro /><h2 className="titulo text-2xl">Tus prioridades de hoy</h2></div>
            <ol className="mt-4 grid gap-3 text-white/85">
              {d.invima.lote > 0 && <li><Link href="/alertas" className="block hover:underline"><b className="text-[#ffb4ab]">Separa el lote con alerta del INVIMA</b> que tienes en existencias.</Link></li>}
              {d.pred.agotan > 0 && <li><Link href="/prediccion" className="block hover:underline"><b className="text-white">{d.pred.agotan} productos se agotan esta semana</b>{d.pred.agotan_top.length ? `: ${d.pred.agotan_top.map((x) => x.nombre.split(" ").slice(0, 3).join(" ")).join(", ")}` : ""}. Tu pedido sugerido tiene {d.pred.pedir} productos.</Link></li>}
              {d.pred.top_riesgo && <li><Link href="/prediccion?ver=vencimiento" className="block hover:underline"><b className="text-white">Mueve el lote {d.pred.top_riesgo.lote}</b> de {d.pred.top_riesgo.nombre.split(" ").slice(0, 4).join(" ")}: vence en {d.pred.top_riesgo.dias} días y {d.pred.top_riesgo.unidades} unidades no alcanzarían a venderse{d.pred.top_riesgo.valor ? ` (${pesos(d.pred.top_riesgo.valor)})` : ""}.</Link></li>}
              {d.hoyPatron?.frente_al_promedio != null && Math.abs(d.hoyPatron.frente_al_promedio) >= 10 && <li>Los {d.hoyPatron.nombre}{d.hoyPatron.nombre.endsWith("s") ? "" : "s"} sueles vender <b className="text-white">{d.hoyPatron.frente_al_promedio > 0 ? "+" : ""}{d.hoyPatron.frente_al_promedio} %</b> frente a tu promedio.</li>}
            </ol>
          </div>
          <div className="grid content-start gap-3">
            <div className="grid grid-cols-2 gap-3">
              <Link href="/prediccion" className="rounded-xl bg-white/10 p-3 hover:bg-white/15 min-w-0"><p className="text-sm text-white/70">Para pedir</p><p className="num titulo text-[clamp(20px,6.5vw,30px)] leading-tight [overflow-wrap:anywhere]">{d.pred.pedir}</p></Link>
              <Link href="/prediccion?ver=vencimiento" className="rounded-xl bg-white/10 p-3 hover:bg-white/15 min-w-0"><p className="text-sm text-white/70">Se vencerían</p><p className="num titulo text-[clamp(20px,6.5vw,30px)] leading-tight [overflow-wrap:anywhere]">{costos ? pesos(d.pred.riesgo) : `${d.pred.lotes} lotes`}</p></Link>
            </div>
            <PreguntarIA pregunta="Explícame mis prioridades de hoy en la droguería y qué hago primero" />
          </div>
        </section>
      )}

      <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)] gap-5">
        <section className="tarjeta p-5" aria-label="Últimos 7 días">
          <h2 className="titulo text-xl">Ventas de los últimos 7 días</h2>
          <div className="mt-5 h-44 flex items-end gap-2 sm:gap-4">
            {d.semana.map((x, i) => (
              <div key={x.dia} className="flex-1 h-full flex flex-col justify-end items-center gap-1.5">
                <span className="num text-[11px] text-muted whitespace-nowrap">{x.total ? corto(x.total) : ""}</span>
                <div className={`w-full rounded-t-md ${i === d.semana.length - 1 ? "bg-cruz" : "bg-ink/80"}`} style={{ height: `${Math.max(2, (x.total / max) * 100)}%`, opacity: i === d.semana.length - 1 ? 1 : 0.8, background: i === d.semana.length - 1 ? undefined : "var(--ink)" }} />
                <span className="text-[12px] text-muted capitalize">{new Date(x.dia + "T12:00:00").toLocaleDateString("es-CO", { weekday: "short" }).replace(".", "")}</span>
              </div>
            ))}
          </div>
        </section>
        <section className="tarjeta p-5" aria-label="Medios de pago hoy">
          <h2 className="titulo text-xl">Cómo te pagaron hoy</h2>
          {d.medios.length ? (
            <ul className="mt-4 grid gap-3">
              {d.medios.map((m) => (
                <li key={m.medio}>
                  <div className="flex justify-between text-sm"><span>{MEDIO[m.medio] ?? m.medio}</span><span className="num font-semibold">{pesos(m.valor)}</span></div>
                  <div className="mt-1 h-2 rounded-full bg-paper"><div className="h-2 rounded-full bg-ink" style={{ width: `${(m.valor / Math.max(1, d.hoy.total)) * 100}%` }} /></div>
                </li>
              ))}
            </ul>
          ) : <p className="mt-4 text-muted">Todavía no hay ventas hoy.</p>}
        </section>
      </div>

      <div className="grid grid-cols-[minmax(0,1fr)] lg:grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-5">
        <section className="tarjeta p-5" aria-label="Pendientes">
          <h2 className="titulo text-xl">Para revisar</h2>
          <ul className="mt-3 divide-y divide-line">
            {[
              { n: d.alertas.vencen, t: "productos con lotes que vencen en 30 días", href: "/inventario", tono: "text-alerta" },
              { n: d.alertas.agotados, t: "productos agotados", href: "/inventario?ver=agotados", tono: "text-ink" },
              { n: d.alertas.bajos, t: "productos por debajo del mínimo", href: "/productos?ver=bajos", tono: "text-aviso" },
              { n: d.alertas.dian_rech, t: "documentos rechazados por la DIAN", href: "/ventas?dian=rechazado", tono: "text-alerta" },
              { n: d.alertas.dian_pend, t: "documentos esperando a la DIAN", href: "/ventas?dian=pendiente", tono: "text-aviso" },
            ].map((x) => (
              <li key={x.t}><Link href={x.href} className="flex items-center gap-3 py-2.5 hover:underline"><span className={`num titulo text-2xl w-12 ${x.n ? x.tono : "text-muted"}`}>{x.n}</span><span className={x.n ? "" : "text-muted"}>{x.t}</span></Link></li>
            ))}
          </ul>
        </section>
        <section className="tarjeta p-5" aria-label="Últimas ventas">
          <div className="flex justify-between items-baseline"><h2 className="titulo text-xl">Últimas ventas</h2><Link href="/ventas" className="text-sm font-semibold text-cruz">Ver todas</Link></div>
          {d.ultimas.length ? (
            <ul className="mt-3 divide-y divide-line">
              {d.ultimas.map((v) => (
                <li key={v.id}><Link href={`/ventas/${v.id}`} className="flex items-center gap-3 py-2.5 hover:bg-paper/60 rounded-lg px-1">
                  <span className="num text-muted w-12">{v.hora}</span>
                  <span className="num font-semibold flex-1 min-w-0 truncate">{v.numero}</span>
                  {v.estado === "anulada" ? <span className="text-sm text-alerta">Anulada</span> : <EstadoDian e={v.dian} />}
                  <span className={`num font-semibold w-24 text-right ${v.estado === "anulada" ? "line-through text-muted" : ""}`}>{pesos(v.total)}</span>
                </Link></li>
              ))}
            </ul>
          ) : <p className="mt-4 text-muted">Todavía no hay ventas. <Link href="/caja" className="underline">Abre la caja</Link> para empezar.</p>}
        </section>
      </div>
    </main>
  );
}

