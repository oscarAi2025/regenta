import Link from "next/link";
import { redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion, puede } from "@/lib/sesion";
import { Cabecera, Dato, pesos, existenciasTexto } from "@/components/ui/Cabecera";
import { Pedido, type LineaPedido } from "./Pedido";

export const metadata = { title: "Predicción" };

const fecha = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" });
const semana = (v: number) => (v * 7 >= 10 ? `${Math.round(v * 7)}` : (v * 7).toLocaleString("es-CO", { maximumFractionDigits: 1 }));

type Riesgo = { lote_id: string; producto_id: string; nombre: string; laboratorio: string | null; unidades_por_caja: number; lote: string; vence: string; dias: number; unidades: number; venta_dia: number; unidades_en_riesgo: number; valor_en_riesgo: number | null };
type Quieto = { id: string; nombre: string; laboratorio: string | null; unidades_por_caja: number; existencias: number; ultima_venta: string | null; valor: number | null };

export default async function Prediccion({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puede.moverInventario(s.rol)) redirect("/caja?aviso=permiso");
  const { ver = "pedido" } = await searchParams;
  const costos = puede.verCostos(s.rol);
  const d = await comoUsuario(s, async (c) => {
    const historia = (await c.query(`select coalesce(current_date - min((creado at time zone 'America/Bogota')::date), 0)::int dias from ventas where empresa_id = $1 and origen is null`, [s.empresa])).rows[0].dias as number;
    // Una sola pasada por la predicción; los filtros se hacen aquí.
    const todos = (await c.query(`select producto_id id, nombre, laboratorio, unidades_por_caja upc, existencias, venta_dia::float, dias_cobertura::float, tendencia::float,
        sugerido_unidades, sugerido_cajas, ultima_venta::text from prediccion_productos($1)`, [s.empresa])).rows as (LineaPedido & { sugerido_unidades: number; ultima_venta: string | null })[];
    const pedido = todos.filter((p) => p.sugerido_unidades > 0 && p.venta_dia > 0)
      .sort((a, b) => (a.dias_cobertura ?? -1) - (b.dias_cobertura ?? -1) || b.venta_dia - a.venta_dia).slice(0, 150);
    const agotan7 = todos.filter((p) => p.venta_dia > 0 && (p.dias_cobertura ?? 0) < 7).length;
    const riesgo: Riesgo[] = (await c.query(`select lote_id, producto_id, nombre, laboratorio, unidades_por_caja, lote, vence::text, dias, unidades, venta_dia::float, unidades_en_riesgo, valor_en_riesgo::float
      from riesgo_vencimiento($1) order by coalesce(valor_en_riesgo, unidades_en_riesgo) desc, vence limit 150`, [s.empresa])).rows;
    const limite45 = new Date(Date.now() - 45 * 864e5).toISOString().slice(0, 10);
    const sinRot = todos.filter((p) => p.existencias > 0 && (!p.ultima_venta || p.ultima_venta < limite45));
    const valores = costos && sinRot.length ? new Map<string, number>((await c.query(`select l.producto_id, sum(l.unidades * lc.costo_unidad)::float v from v_stock_lotes l join lote_costos lc on lc.lote_id = l.lote_id
      where l.producto_id = any($1) and l.unidades > 0 group by 1`, [sinRot.map((p) => p.id)])).rows.map((r) => [r.producto_id, r.v])) : null;
    const quietos: Quieto[] = sinRot.map((p) => ({ id: p.id, nombre: p.nombre, laboratorio: p.laboratorio, unidades_por_caja: p.upc, existencias: p.existencias, ultima_venta: p.ultima_venta, valor: valores?.get(p.id) ?? null }))
      .sort((a, b) => (b.valor ?? 0) - (a.valor ?? 0) || b.existencias - a.existencias).slice(0, 150);
    const patron = (await c.query(`select nombre, frente_al_promedio from patron_semanal($1)`, [s.empresa])).rows as { nombre: string; frente_al_promedio: number | null }[];
    return { historia, pedido, agotan7, riesgo, quietos, patron };
  });
  const enRiesgo = d.riesgo.reduce((a, r) => a + (r.valor_en_riesgo ?? 0), 0);
  const quieto = d.quietos.reduce((a, q) => a + (q.valor ?? 0), 0);
  const tabs = [["pedido", `Pedido sugerido (${d.pedido.length})`], ["vencimiento", `Se pueden vencer (${d.riesgo.length})`], ["quietos", `Sin rotación (${d.quietos.length})`]] as const;

  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo="Predicción" sub={`Calculado con tus ventas reales de las últimas 8 semanas, vendiendo primero lo que vence antes.`} />
      {d.historia < 21 && (
        <p className="rounded-xl bg-aviso-soft text-aviso px-4 py-3 font-semibold">Llevas {d.historia} días vendiendo con Regenta. Las predicciones se vuelven confiables desde las 3 semanas de ventas; mientras tanto tómalas como una guía.</p>
      )}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Dato titulo="Para pedir" valor={d.pedido.length} tono={d.pedido.length ? "cruz" : undefined} nota="productos con venta que no alcanzan 18 días" />
        <Dato titulo="Se agotan en 7 días" valor={d.agotan7} tono={d.agotan7 ? "alerta" : undefined} nota="al ritmo de venta actual" />
        <Dato titulo="Se vencerían sin venderse" valor={costos ? pesos(enRiesgo) : d.riesgo.reduce((a, r) => a + r.unidades_en_riesgo, 0) + " und"} tono={d.riesgo.length ? "alerta" : undefined} nota={`${d.riesgo.length} lotes en los próximos 6 meses`} />
        <Dato titulo="Capital sin rotación" valor={costos ? pesos(quieto) : d.quietos.length} tono={d.quietos.length ? "aviso" : undefined} nota="sin ventas en 45 días" />
      </div>

      {d.patron.some((x) => x.frente_al_promedio !== null) && (
        <section className="tarjeta p-5 grid md:grid-cols-[auto_1fr] gap-5 items-center" aria-label="Patrón semanal">
          <div><h2 className="titulo text-xl">Tu semana</h2><p className="text-sm text-muted max-w-56">Cuánto vendes cada día frente a tu promedio. Úsalo para el turno y para recibir pedidos antes del día fuerte.</p></div>
          <ol className="grid grid-cols-7 gap-2 items-end h-28">
            {d.patron.map((x) => { const v = x.frente_al_promedio ?? 0; return (
              <li key={x.nombre} className="grid gap-1 justify-items-center h-full content-end">
                <span className={`text-xs num font-semibold ${v >= 10 ? "text-cruz" : v <= -10 ? "text-aviso" : "text-muted"}`}>{v > 0 ? "+" : ""}{v} %</span>
                <span className={`w-full rounded-t-md ${v >= 10 ? "bg-cruz" : v <= -10 ? "bg-aviso" : "bg-ink/40"}`} style={{ height: `${Math.max(8, 50 + v * 0.8)}%` }} />
                <span className="text-xs text-muted capitalize">{x.nombre.slice(0, 3)}</span>
              </li>); })}
          </ol>
        </section>
      )}

      <nav className="flex flex-wrap gap-1 tarjeta p-1 w-fit" aria-label="Vista">
        {tabs.map(([k, t]) => <Link key={k} href={`?ver=${k}`} aria-current={ver === k ? "page" : undefined} className={`px-3.5 py-2 rounded-xl text-sm font-semibold ${ver === k ? "bg-ink text-white" : "text-muted"}`}>{t}</Link>)}
      </nav>

      {ver === "pedido" && <Pedido lineas={d.pedido} />}

      {ver === "vencimiento" && (
        <section className="grid gap-3">
          <p className="text-muted max-w-3xl">Lotes que, al ritmo de venta actual, no alcanzarán a venderse antes de su fecha. Actúa antes: ponlos en exhibición, ofrécelos con descuento, muévelos a otra sede o pide cambio al proveedor si tu acuerdo lo permite.</p>
          <div className="tarjeta overflow-x-auto">
            <table className="w-full text-sm min-w-[760px]">
              <thead className="text-left text-muted border-b border-line"><tr><th className="px-4 py-3">Producto</th><th className="px-4 py-3">Lote · vence</th><th className="px-4 py-3 text-right">Hay</th><th className="px-4 py-3 text-right">Vende por semana</th><th className="px-4 py-3 text-right">Se vencerían</th>{costos && <th className="px-4 py-3 text-right">Valor a costo</th>}</tr></thead>
              <tbody className="divide-y divide-line">
                {d.riesgo.map((r) => (
                  <tr key={r.lote_id}>
                    <td className="px-4 py-3"><p className="font-semibold">{r.nombre}</p><p className="text-muted">{r.laboratorio ?? "Genérico"}</p></td>
                    <td className="px-4 py-3"><span className={`rounded-md px-2 py-0.5 font-semibold ${r.dias <= 30 ? "bg-alerta-soft text-alerta" : r.dias <= 90 ? "bg-aviso-soft text-aviso" : "bg-paper"}`}>{r.lote} · {fecha(r.vence)}</span><p className="text-muted mt-1">en {r.dias} días</p></td>
                    <td className="px-4 py-3 text-right num">{r.unidades} und</td>
                    <td className="px-4 py-3 text-right num">{r.venta_dia > 0 ? `${semana(r.venta_dia)} und` : <span className="text-alerta">sin ventas</span>}</td>
                    <td className="px-4 py-3 text-right num font-semibold text-alerta">{r.unidades_en_riesgo} und</td>
                    {costos && <td className="px-4 py-3 text-right num font-semibold">{r.valor_en_riesgo !== null ? pesos(r.valor_en_riesgo) : "—"}</td>}
                  </tr>
                ))}
                {d.riesgo.length === 0 && <tr><td colSpan={6} className="px-4 py-8 text-center text-muted">Con tu ritmo de venta actual, todo lo que tienes se alcanza a vender antes de vencer.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {ver === "quietos" && (
        <section className="grid gap-3">
          <p className="text-muted max-w-3xl">Productos con existencias que no se venden hace más de 45 días. Es plata parada en la estantería: no los vuelvas a pedir y decide si los rotas, los devuelves o los liquidas.</p>
          <div className="tarjeta overflow-x-auto">
            <table className="w-full text-sm min-w-[620px]">
              <thead className="text-left text-muted border-b border-line"><tr><th className="px-4 py-3">Producto</th><th className="px-4 py-3">Existencias</th><th className="px-4 py-3">Última venta</th>{costos && <th className="px-4 py-3 text-right">Valor a costo</th>}</tr></thead>
              <tbody className="divide-y divide-line">
                {d.quietos.map((q) => (
                  <tr key={q.id}>
                    <td className="px-4 py-3"><p className="font-semibold">{q.nombre}</p><p className="text-muted">{q.laboratorio ?? "Genérico"}</p></td>
                    <td className="px-4 py-3 num">{existenciasTexto(q.existencias, q.unidades_por_caja)}</td>
                    <td className="px-4 py-3">{q.ultima_venta ? fecha(q.ultima_venta) : <span className="text-muted">No se ha vendido en 8 semanas</span>}</td>
                    {costos && <td className="px-4 py-3 text-right num font-semibold">{q.valor !== null ? pesos(q.valor) : "—"}</td>}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </main>
  );
}
