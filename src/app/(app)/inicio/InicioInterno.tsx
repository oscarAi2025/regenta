import Link from "next/link";
import { comoUsuario } from "@/lib/db";
import { puede, type Sesion } from "@/lib/sesion";
import { Cabecera, Dato } from "@/components/ui/Cabecera";
import { saludoPersonal } from "@/lib/saludo";
import { DESTINATARIOS, numeroEntrega } from "@/lib/entregas";
import { puedeEntregar } from "@/lib/entregas-datos";

const und = (n: number) => n.toLocaleString("es-CO");

/** Inicio de la droguería interna (sin DIAN): lo que salió hoy, lo que se vence, lo que hay que pedir y las últimas
 *  entregas. No hay ventas, caja ni DIAN. */
export async function InicioInterno({ s }: { s: Sesion }) {
  const entrega = puedeEntregar(s.rol);
  const d = await comoUsuario(s, async (c) => {
    const hoy = (await c.query(`select count(*)::int entregas, coalesce(sum(unidades), 0)::int unidades from entregas
      where empresa_id = $1 and anulada is null and (creado at time zone 'America/Bogota')::date = (now() at time zone 'America/Bogota')::date`, [s.empresa])).rows[0];
    const alertas = (await c.query(`select
        (select count(distinct producto_id) from v_stock_lotes where empresa_id = $1 and unidades > 0 and vence between current_date and current_date + 30)::int vencen,
        (select count(*) from v_stock_lotes where empresa_id = $1 and unidades > 0 and vence < current_date)::int vencidos,
        (select count(*) from productos p where empresa_id = $1 and activo and coalesce((select sum(unidades) from v_stock_vigente where producto_id = p.id), 0) <= 0)::int agotados`, [s.empresa])).rows[0];
    const invima = (await c.query(`select count(*) filter (where nivel is not null and revisada is null)::int pendientes from alertas_empresa($1)`, [s.empresa])).rows[0];
    const pedir = puede.moverInventario(s.rol)
      ? (await c.query(`select count(*) filter (where sugerido_unidades > 0 and venta_dia > 0)::int n from prediccion_productos($1)`, [s.empresa])).rows[0].n as number : null;
    const ultimas = entrega ? (await c.query(`select id, numero, destinatario, destinatario_tipo, servicio, unidades, anulada is not null anulada,
        to_char(creado at time zone 'America/Bogota', 'DD/MM HH24:MI') hora from entregas where empresa_id = $1 order by creado desc limit 6`, [s.empresa])).rows : [];
    const pasos = s.rol === "dueno" ? (await c.query(`select
        exists (select 1 from productos where empresa_id = $1 and activo) productos,
        exists (select 1 from v_stock_vigente v join productos p on p.id = v.producto_id where p.empresa_id = $1 and v.unidades > 0) inventario,
        (select count(*) from miembros where empresa_id = $1 and activo) > 1 equipo,
        exists (select 1 from entregas where empresa_id = $1) entrega`, [s.empresa])).rows[0] : null;
    return { hoy, alertas, invima, pedir, ultimas, pasos };
  });
  const hora = Number(new Date().toLocaleString("en-US", { timeZone: "America/Bogota", hour: "numeric", hour12: false }));
  const saludo = hora < 5 ? "Buenas noches" : hora < 12 ? "Buenos días" : hora < 19 ? "Buenas tardes" : "Buenas noches";
  const personal = await saludoPersonal(s.uid);
  const p = d.pasos;
  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo={personal ?? `${saludo}, ${s.nombre.split(" (")[0]}`} sub={new Date().toLocaleDateString("es-CO", { timeZone: "America/Bogota", weekday: "long", day: "numeric", month: "long" })}>
        {entrega && <Link href="/entregas/nueva" className="btn-primario">Nueva entrega</Link>}
        {puede.moverInventario(s.rol) && <Link href="/inventario/recibir" className="btn-borde">Recibir mercancía</Link>}
      </Cabecera>

      {p && !(p.productos && p.inventario && p.equipo && p.entrega) && (
        <section className="tarjeta p-5" aria-label="Primeros pasos">
          <h2 className="titulo text-xl">Primeros pasos</h2>
          <p className="text-sm text-muted mt-1">Deja tu droguería interna lista. Cada paso se marca solo cuando lo haces.</p>
          <ol className="mt-3 grid sm:grid-cols-2 lg:grid-cols-4 gap-2">
            {([["productos", "Carga tus productos", "/productos/importar"], ["inventario", "Recibe tu inventario por lote", "/inventario/recibir"],
               ["equipo", "Crea a tu equipo", "/equipo"], ["entrega", "Registra tu primera entrega", "/entregas/nueva"]] as const).map(([k, t, href], i) => (
              <li key={k}>
                <Link href={href} className={`flex items-center gap-2 rounded-xl border-2 p-3 text-sm h-full ${p[k] ? "border-cruz bg-cruz-soft" : "border-line hover:border-ink"}`}>
                  <span aria-hidden="true" className={`grid place-items-center w-7 h-7 rounded-full shrink-0 font-semibold ${p[k] ? "bg-cruz text-cruz-ink" : "bg-line"}`}>{p[k] ? "✓" : i + 1}</span>
                  <span className={p[k] ? "line-through text-muted" : "font-semibold"}>{t}</span>
                  <span className="sr-only">{p[k] ? "(hecho)" : "(pendiente)"}</span>
                </Link>
              </li>
            ))}
          </ol>
        </section>
      )}

      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3" aria-label="Hoy">
        <Dato titulo="Entregas hoy" valor={und(d.hoy.entregas)} tono="cruz" nota={`${und(d.hoy.unidades)} unidades`} />
        <Dato titulo="Se vencen en 30 días" valor={und(d.alertas.vencen)} tono={d.alertas.vencen ? "aviso" : undefined} nota="productos" />
        <Dato titulo="Lotes vencidos con existencias" valor={und(d.alertas.vencidos)} tono={d.alertas.vencidos ? "alerta" : undefined} nota="no se entregan: dales de baja" />
        {d.pedir !== null
          ? <Dato titulo="Para pedir" valor={und(d.pedir)} nota="según el consumo de las entregas" />
          : <Dato titulo="Agotados" valor={und(d.alertas.agotados)} tono={d.alertas.agotados ? "alerta" : undefined} />}
      </section>

      <div className="flex flex-wrap gap-2 text-sm">
        {d.invima.pendientes > 0 && <Link href="/alertas" className="rounded-xl bg-alerta-soft text-alerta px-3 py-2 font-semibold">{d.invima.pendientes} alerta{d.invima.pendientes === 1 ? "" : "s"} del INVIMA por revisar</Link>}
        {d.alertas.vencen > 0 && <Link href="/inventario" className="rounded-xl bg-aviso-soft text-aviso px-3 py-2 font-semibold">Ver lo que se vence</Link>}
        {d.pedir ? <Link href="/prediccion" className="rounded-xl bg-cruz-soft text-cruz px-3 py-2 font-semibold">Ver el pedido sugerido</Link> : null}
      </div>

      {entrega && (
        <section className="tarjeta p-5" aria-label="Últimas entregas">
          <div className="flex justify-between items-baseline"><h2 className="titulo text-xl">Últimas entregas</h2><Link href="/entregas" className="text-sm font-semibold text-cruz">Ver todas</Link></div>
          {d.ultimas.length ? (
            <ul className="mt-3 divide-y divide-line">{d.ultimas.map((e) => (
              <li key={e.id}><Link href={`/entregas/${e.id}`} className="flex items-center gap-3 py-2.5 hover:bg-paper/60 rounded-lg px-1">
                <span className="num text-muted w-24 shrink-0 hidden sm:inline">{e.hora}</span>
                <span className="num font-semibold w-14 shrink-0">{numeroEntrega(e.numero)}</span>
                <span className="flex-1 min-w-0 truncate">{e.destinatario}<span className="text-muted"> · {e.servicio ?? DESTINATARIOS[e.destinatario_tipo as keyof typeof DESTINATARIOS]}</span></span>
                <span className={`num shrink-0 ${e.anulada ? "text-alerta font-semibold" : "text-muted"}`}>{e.anulada ? "Anulada" : `${und(e.unidades)} und`}</span>
              </Link></li>
            ))}</ul>
          ) : <p className="mt-4 text-muted">Todavía no hay entregas. <Link href="/entregas/nueva" className="underline">Registra la primera</Link>.</p>}
        </section>
      )}
    </main>
  );
}
