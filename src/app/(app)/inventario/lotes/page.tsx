import Link from "next/link";
import { redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { esUuid } from "@/lib/api";
import { leerSesion, puede } from "@/lib/sesion";
import { Cabecera } from "@/components/ui/Cabecera";
import { CorregirLotes } from "./CorregirLotes";

export const metadata = { title: "Lotes y vencimientos" };

const fecha = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("es-CO", { day: "2-digit", month: "short", year: "numeric" });

export default async function Pagina({ searchParams }: { searchParams: Promise<{ producto?: string }> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puede.moverInventario(s.rol)) redirect("/inventario?aviso=permiso");
  const { producto } = await searchParams;
  const d = await comoUsuario(s, async (c) => ({
    inicial: esUuid(producto ?? "") ? (await c.query(`select id, nombre, laboratorio from productos where id = $1 and empresa_id = $2`, [producto, s.empresa])).rows[0] ?? null : null,
    vencidos: (await c.query(`select p.id, s.lote_id, p.nombre, s.lote, s.vence::text, s.unidades from v_stock_lotes s join productos p on p.id = s.producto_id
      where s.empresa_id = $1 and s.vence < current_date and s.unidades > 0 order by s.vence, p.nombre limit 50`, [s.empresa])).rows as
      { id: string; lote_id: string; nombre: string; lote: string; vence: string; unidades: number }[],
  }));
  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo="Lotes y vencimientos" sub="Corrige el código o la fecha de vencimiento de un lote que quedó mal registrado. Cada corrección pide un motivo y queda en la auditoría; las existencias no cambian.">
        <Link href="/inventario" className="btn-borde">Volver a inventario</Link>
      </Cabecera>
      {d.vencidos.length > 0 && (
        <section className="tarjeta p-4 sm:p-5 grid gap-2 max-w-4xl" aria-labelledby="vencidos-t">
          <h2 id="vencidos-t" className="titulo text-xl">Lotes vencidos con existencias</h2>
          <p className="text-sm text-muted">No se pueden vender. Si la fecha está mal, corrígela{s.rol === "bodeguero" ? " (volver vendible un lote vencido lo autoriza el dueño o el administrador)" : ""}; si de verdad vencieron, dalos de baja con acta en «Ajustar o dar de baja».</p>
          <ul className="divide-y divide-line">
            {d.vencidos.map((v) => (
              <li key={v.lote_id} className="py-2 flex flex-wrap items-center gap-x-4 gap-y-1">
                <p className="flex-1 min-w-[200px]"><span className="font-semibold">{v.nombre}</span><span className="block text-sm text-muted num">Lote {v.lote} · venció {fecha(v.vence)} · {v.unidades.toLocaleString("es-CO")} und</span></p>
                <Link href={`/inventario/lotes?producto=${v.id}`} className="btn-borde h-10 text-sm" aria-label={`Revisar el lote ${v.lote} de ${v.nombre}`}>Revisar</Link>
              </li>
            ))}
          </ul>
        </section>
      )}
      <CorregirLotes key={d.inicial?.id ?? "nuevo"} inicial={d.inicial} />
    </main>
  );
}
