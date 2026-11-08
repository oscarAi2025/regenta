import Link from "next/link";
import { notFound } from "next/navigation";
import { sinRLS } from "@/lib/db";
import { esUuid } from "@/lib/api";
import { Cabecera } from "@/components/ui/Cabecera";
import { exigirAdmin, fechaHora } from "@/lib/admin-pagina";

export const metadata = { title: "Visita a la demo" };
export const dynamic = "force-dynamic";

const QUE: Record<string, string> = { pagina: "Abrió", venta: "Hizo una venta de", ia: "Preguntó a Regenta IA:", oferta: "Vio la oferta", contratar: "Pulsó Contratar", whatsapp: "Pulsó WhatsApp en", datos: "Dejó sus datos:" };
const PANTALLA: Record<string, string> = { "/inicio": "Inicio", "/caja": "Caja", "/prediccion": "Predicción de vencimientos", "/alertas": "Alertas INVIMA", "/inventario": "Inventario", "/productos": "Productos", "/reportes": "Reportes", "/ventas": "Ventas", "/compras": "Compras", "/pedidos": "Pedidos" };
const OFERTA: Record<string, string> = { completo: "al terminar el recorrido", salida: "al intentar irse", tiempo: "a los 3 minutos" };

/** Línea de tiempo de una visita: lo que hizo el visitante, en orden. */
export default async function Visita({ params }: { params: Promise<{ id: string }> }) {
  await exigirAdmin();
  const { id } = await params;
  if (!esUuid(id)) notFound();
  const d = await sinRLS(async (c) => {
    const v = (await c.query(`select v.*, s.nombre, s.drogueria, s.ciudad lead_ciudad, s.telefono from demo_visitas v left join solicitudes_demo s on s.id = v.solicitud_id where v.id = $1`, [id])).rows[0];
    if (!v) return null;
    const ev = (await c.query(`select tipo, detalle, creado from demo_eventos where visita_id = $1 order by creado, id limit 1000`, [id])).rows;
    const otras = v.visitante ? (await c.query(`select id, creada from demo_visitas where visitante = $1 and id <> $2 order by creada desc limit 10`, [v.visitante, id])).rows : [];
    return { v, ev, otras };
  });
  if (!d) notFound();
  const { v, ev } = d;
  const texto = (e: { tipo: string; detalle: string | null }) => e.tipo === "pagina" ? `${QUE.pagina} ${PANTALLA[e.detalle ?? ""] ?? e.detalle}` : e.tipo === "oferta" ? `${QUE.oferta} ${OFERTA[e.detalle ?? ""] ?? ""}` : e.tipo === "ia" ? `${QUE.ia} «${e.detalle}»` : `${QUE[e.tipo] ?? e.tipo} ${e.detalle ?? ""}`;
  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Link href="/admin/demo" className="text-sm font-semibold text-cruz">← Visitas a la demo</Link>
      <Cabecera titulo={[v.ciudad, v.region, v.pais && v.pais !== "CO" ? v.pais : null].filter(Boolean).join(", ") || "Visita sin ubicación"}
        sub={`${fechaHora(v.creada)} · ${v.dispositivo ?? "dispositivo desconocido"}${v.navegador ? ` · ${v.navegador}` : ""}${v.sistema ? ` en ${v.sistema}` : ""} · desde ${v.origen ?? "directo"}${v.campana ? ` (${v.campana})` : ""}${v.landing ? ` · primera página: ${v.landing}` : ""}`} />
      {v.nombre && (
        <section className="tarjeta p-4 flex flex-wrap items-center gap-3 justify-between">
          <p><b>{v.nombre}</b> · {v.drogueria}{v.lead_ciudad ? ` · ${v.lead_ciudad}` : ""} · {v.telefono}</p>
          <a href={`https://wa.me/57${String(v.telefono).replace(/\D/g, "").slice(-10)}?text=${encodeURIComponent(`Hola ${String(v.nombre).split(" ")[0]}, te escribo de Regenta: vi que probaste la demo para ${v.drogueria}.`)}`} target="_blank" rel="noopener noreferrer" className="btn-primario h-10 text-sm">Escribir por WhatsApp</a>
        </section>
      )}
      <ol className="tarjeta p-5 grid gap-2">
        {ev.map((e, i) => (
          <li key={i} className="grid grid-cols-[4.5rem_minmax(0,1fr)] gap-3 text-sm">
            <span className="num text-muted">{new Date(e.creado).toLocaleTimeString("es-CO", { timeZone: "America/Bogota", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" })}</span>
            <span className={e.tipo === "contratar" || e.tipo === "datos" || e.tipo === "whatsapp" ? "font-semibold text-cruz" : ""}>{texto(e)}</span>
          </li>
        ))}
        {!ev.length && <li className="text-muted">Entró y no hizo nada más.</li>}
      </ol>
      {d.otras.length > 0 && <p className="text-sm text-muted">Esta persona (misma conexión) entró otras {d.otras.length} vez/veces: {d.otras.map((o, i) => <span key={o.id}>{i ? ", " : ""}<Link className="underline" href={`/admin/demo/${o.id}`}>{fechaHora(o.creada)}</Link></span>)}.</p>}
    </main>
  );
}
