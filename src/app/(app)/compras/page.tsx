import Link from "next/link";
import { redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion } from "@/lib/sesion";
import { ESTADOS, pesosExactos, puedeCompras } from "@/lib/compras";
import { listaCompras } from "@/lib/compras-datos";
import { fechaReal } from "@/lib/validar";
import { Cabecera } from "@/components/ui/Cabecera";

export const metadata = { title: "Compras" };

const fecha = (d: string | null) => (d ? d.split("-").reverse().join("/") : "—");
const tono: Record<string, string> = { por_costear: "bg-aviso-soft text-aviso", registrada: "bg-paper text-ink", anulada: "bg-alerta-soft text-alerta" };

export default async function Compras({ searchParams }: { searchParams: Promise<Record<string, string | undefined>> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puedeCompras.ver(s.rol)) redirect("/caja?aviso=permiso");
  const sp = await searchParams;
  const estado = ["por_costear", "registrada", "anulada"].includes(sp.estado ?? "") ? sp.estado! : "";
  const f = (v?: string) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) && fechaReal(v) ? v : "");
  const desde = f(sp.desde), hasta = f(sp.hasta), q = (sp.q ?? "").slice(0, 60), proveedor = /^[0-9a-f-]{36}$/i.test(sp.proveedor ?? "") ? sp.proveedor! : "";
  const dinero = puedeCompras.dinero(s.rol);
  const { filas, proveedores, porCostear } = await comoUsuario(s, async (c) => ({
    filas: await listaCompras(c, s.empresa, { estado, proveedor, desde, hasta, q }, dinero),
    proveedores: (await c.query(`select id, nombre from proveedores where empresa_id = $1 order by lower(nombre) limit 500`, [s.empresa])).rows as { id: string; nombre: string }[],
    porCostear: (await c.query(`select count(*)::int n from v_recepciones where empresa_id = $1 and estado = 'por_costear'`, [s.empresa])).rows[0].n as number,
  }));
  const enlace = (e: string) => { const u = new URLSearchParams({ ...(e ? { estado: e } : {}), ...(q ? { q } : {}), ...(desde ? { desde } : {}), ...(hasta ? { hasta } : {}), ...(proveedor ? { proveedor } : {}) }); return `/compras${u.size ? "?" + u : ""}`; };
  const tabs: [string, string][] = [["", "Todas"], ["por_costear", `Por costear${porCostear ? ` (${porCostear})` : ""}`], ["registrada", "Registradas"], ["anulada", "Anuladas"]];
  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo="Compras" sub={dinero ? "Facturas de tus proveedores: lo que entró, lo que costó y lo que debes." : "Mercancía recibida de los proveedores."}>
        <Link href="/compras/nueva" className="btn-primario">Recibir mercancía</Link>
        <Link href="/proveedores" className="btn-borde">Proveedores</Link>
        {dinero && <Link href="/cuentas-por-pagar" className="btn-borde">Cuentas por pagar</Link>}
      </Cabecera>
      {dinero && porCostear > 0 && estado !== "por_costear" && (
        <p className="rounded-xl bg-aviso-soft text-aviso px-4 py-3 font-semibold">{porCostear} compra{porCostear === 1 ? "" : "s"} recibida{porCostear === 1 ? "" : "s"} por la bodega sin costos. <a href="/compras?estado=por_costear" className="underline">Completar costos</a></p>
      )}
      <nav aria-label="Estado" className="flex gap-1.5 overflow-x-auto pb-1 [scrollbar-width:thin]">
        {tabs.map(([k, t]) => <a key={k || "todas"} href={enlace(k)} aria-current={estado === k ? "page" : undefined}
          className={`shrink-0 px-3 py-1.5 rounded-lg text-sm font-semibold border ${estado === k ? "bg-ink text-white border-ink" : "bg-surface text-muted border-line hover:text-ink"}`}>{t}</a>)}
      </nav>
      <form className="tarjeta p-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,2fr)_minmax(0,2fr)_150px_150px_auto] lg:items-end" role="search">
        {estado && <input type="hidden" name="estado" value={estado} />}
        <div><label htmlFor="q" className="etiqueta">Buscar</label><input id="q" name="q" defaultValue={q} className="campo" placeholder="Factura o proveedor" /></div>
        <div><label htmlFor="f-proveedor" className="etiqueta">Proveedor</label>
          <select id="f-proveedor" name="proveedor" defaultValue={proveedor} className="campo"><option value="">Todos</option>{proveedores.map((p) => <option key={p.id} value={p.id}>{p.nombre}</option>)}</select></div>
        <div><label htmlFor="desde" className="etiqueta">Desde</label><input id="desde" name="desde" type="date" defaultValue={desde} className="campo" /></div>
        <div><label htmlFor="hasta" className="etiqueta">Hasta</label><input id="hasta" name="hasta" type="date" defaultValue={hasta} className="campo" /></div>
        <div className="flex gap-2"><button className="btn-oscuro">Filtrar</button>{(q || desde || hasta || proveedor) && <a href={enlace(estado)} className="btn-borde">Limpiar</a>}</div>
      </form>
      <div className="tarjeta overflow-x-auto">
        <table className="w-full text-[15px] min-w-[760px]" aria-label="Compras registradas">
          <thead className="text-left text-sm text-muted border-b border-line">
            <tr><th className="px-4 py-3 font-semibold">Compra</th><th className="px-4 py-3 font-semibold">Proveedor</th><th className="px-4 py-3 font-semibold">Factura</th><th className="px-4 py-3 font-semibold">Estado</th>
              {dinero && <><th className="px-4 py-3 font-semibold text-right">Total</th><th className="px-4 py-3 font-semibold text-right">Saldo</th><th className="px-4 py-3 font-semibold">Vence</th></>}
              {!dinero && <th className="px-4 py-3 font-semibold text-right">Productos</th>}</tr>
          </thead>
          <tbody className="divide-y divide-line">
            {filas.map((f) => (
              <tr key={f.id} className="align-top">
                <td className="px-4 py-3"><Link href={`/compras/${f.id}`} className="font-semibold num hover:underline">N.º {f.numero}</Link><p className="text-sm text-muted num">{fecha(f.fecha_factura)}</p></td>
                <td className="px-4 py-3 font-semibold">{f.proveedor}</td>
                <td className="px-4 py-3 num">{f.numero_factura}{dinero && f.condicion && <p className="text-sm text-muted">{f.estado === "por_costear" ? "Por costear" : f.condicion === "credito" ? "Crédito" : "Contado"}</p>}</td>
                <td className="px-4 py-3"><span className={`rounded-md px-2 py-0.5 text-sm font-semibold ${tono[f.estado]}`}>{ESTADOS[f.estado]}</span></td>
                {dinero && <>
                  <td className="px-4 py-3 num text-right">{f.estado === "por_costear" ? "—" : pesosExactos(f.total ?? 0)}</td>
                  <td className="px-4 py-3 num text-right font-semibold">{f.saldo === null ? "—" : f.saldo > 0 ? pesosExactos(f.saldo) : "Pagada"}</td>
                  <td className="px-4 py-3 num">{f.saldo && f.saldo > 0 ? <span className={f.dias !== null && f.dias < 0 ? "text-alerta font-semibold" : ""}>{fecha(f.vence_pago)}{f.dias !== null && f.dias < 0 ? ` · vencida hace ${-f.dias} día${f.dias === -1 ? "" : "s"}` : ""}</span> : "—"}</td>
                </>}
                {!dinero && <td className="px-4 py-3 num text-right">{f.lineas}</td>}
              </tr>
            ))}
            {filas.length === 0 && <tr><td colSpan={dinero ? 7 : 5} className="px-4 py-12 text-center text-muted">{q || desde || hasta || proveedor || estado ? "No hay compras con ese filtro." : "Todavía no hay compras. Empieza con «Recibir mercancía»."}</td></tr>}
          </tbody>
        </table>
      </div>
    </main>
  );
}
