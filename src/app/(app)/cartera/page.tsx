import Link from "next/link";
import { redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion, puede } from "@/lib/sesion";
import { Cabecera, Dato, pesos } from "@/components/ui/Cabecera";
import { EDADES, carteraPorCliente, esEdad, type FilaCliente } from "@/lib/cartera";
import { Abonar } from "./Abonar";
import { Valor } from "./Valor";
import { MoraBloqueo } from "./MoraBloqueo";

export const metadata = { title: "Cartera" };

type Fila = { venta_id: string; cliente_id: string; numero: string; cliente: string; documento: string; telefono: string | null; creado: string; vence_pago: string; total: number; abonado: number; saldo: number; dias_mora: number };
const fecha = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" });

export default async function Cartera({ searchParams }: { searchParams: Promise<{ ver?: string; edad?: string; q?: string }> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puede.cartera(s.rol)) redirect("/inicio?aviso=permiso");
  const { ver = "pendientes", edad, q = "" } = await searchParams;
  if (ver === "clientes") return <PorCliente empresa={s.empresa} sesion={s} edad={esEdad(edad) ? edad : null} q={q.slice(0, 80)} />;
  const filas: Fila[] = await comoUsuario(s, async (c) => (await c.query(`
    select venta_id, cliente_id, prefijo || numero numero, cliente, tipo_doc || ' ' || numero_doc || coalesce('-' || dv, '') documento, telefono,
           (creado at time zone 'America/Bogota')::date::text creado, vence_pago::text, total::float, abonado::float, saldo::float, dias_mora
    from v_cartera where empresa_id = $1 ${ver === "pagadas" ? "and saldo = 0" : "and saldo > 0"}
    order by ${ver === "pagadas" ? "creado desc" : "vence_pago, creado"} limit 300`, [s.empresa])).rows);
  const porCobrar = filas.reduce((a, f) => a + f.saldo, 0);
  const vencidas = filas.filter((f) => f.dias_mora > 0);
  const semana = filas.filter((f) => f.dias_mora === 0 && Date.parse(f.vence_pago + "T00:00:00") - Date.now() <= 7 * 864e5);
  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo="Cartera" sub="Facturas a crédito de tus clientes: lo que te deben, lo que vence y los abonos." />
      {ver !== "pagadas" && (
        <section className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <Dato titulo="Por cobrar" valor={pesos(porCobrar)} tono={porCobrar ? "aviso" : undefined} nota={`${filas.length} factura${filas.length === 1 ? "" : "s"}`} />
          <Dato titulo="Vencido" valor={pesos(vencidas.reduce((a, f) => a + f.saldo, 0))} tono={vencidas.length ? "alerta" : undefined} nota={`${vencidas.length} factura${vencidas.length === 1 ? "" : "s"} en mora`} />
          <Dato titulo="Vence en 7 días" valor={pesos(semana.reduce((a, f) => a + f.saldo, 0))} tono={semana.length ? "aviso" : undefined} nota="llama antes de que se venza" />
        </section>
      )}
      <nav className="flex gap-1 tarjeta p-1 w-fit" aria-label="Vista">
        <Vistas ver={ver} />
      </nav>
      <div className="tarjeta overflow-x-auto relative">
        <table className="tabla-tarjetas w-full text-[15px] min-w-[860px]">
          <thead className="text-left text-sm text-muted border-b border-line">
            <tr><th className="px-4 py-3 font-semibold">Cliente</th><th className="px-4 py-3 font-semibold">Factura</th><th className="px-4 py-3 font-semibold">Vence</th>
              <th className="px-4 py-3 font-semibold text-right">Total</th><th className="px-4 py-3 font-semibold text-right">Abonado</th><th className="px-4 py-3 font-semibold text-right">Saldo</th>{ver !== "pagadas" && <th className="px-4 py-3 font-semibold">Abono</th>}</tr>
          </thead>
          <tbody className="divide-y divide-line">
            {filas.map((f) => (
              <tr key={f.venta_id} className="align-top">
                <td className="px-4 py-3"><p className="font-semibold leading-snug">{f.cliente}</p><p className="text-sm text-muted num">{f.documento}{f.telefono ? ` · ${f.telefono}` : ""}</p></td>
                <td data-etiqueta="Factura" className="px-4 py-3"><Link href={`/ventas/${f.venta_id}`} className="num font-semibold hover:underline">{f.numero}</Link><p className="text-sm text-muted">{fecha(f.creado)}</p></td>
                <td data-etiqueta="Vence" className="px-4 py-3">
                  <span className={`rounded-md px-2 py-0.5 text-sm font-semibold ${f.saldo === 0 ? "bg-paper" : f.dias_mora > 0 ? "bg-alerta-soft text-alerta" : "bg-paper"}`}>{fecha(f.vence_pago)}</span>
                  {f.saldo > 0 && f.dias_mora > 0 && <p className="text-sm text-alerta mt-1">{f.dias_mora} día{f.dias_mora === 1 ? "" : "s"} de mora</p>}
                </td>
                <td data-etiqueta="Total" className="px-4 py-3 num text-right">{pesos(f.total)}</td>
                <td data-etiqueta="Abonado" className="px-4 py-3 num text-right text-muted"><Valor venta={f.venta_id} campo="abonado" inicial={f.abonado} /></td>
                <td data-etiqueta="Saldo" className="px-4 py-3 num text-right font-semibold"><Valor venta={f.venta_id} campo="saldo" inicial={f.saldo} /></td>
                {ver !== "pagadas" && <td className="ancho px-4 py-3"><Abonar venta={f.venta_id} cliente={f.cliente_id} saldo={f.saldo} numero={f.numero} /></td>}
              </tr>
            ))}
            {filas.length === 0 && <tr><td colSpan={7} className="px-4 py-12 text-center text-muted">{ver === "pagadas" ? "Aún no hay facturas a crédito pagadas por completo." : "Nadie te debe. Las ventas a crédito se hacen desde la Caja: Factura electrónica → Cobrar → Crédito."}</td></tr>}
          </tbody>
        </table>
      </div>
    </main>
  );
}

/** Vistas de la cartera (enlaces normales: recarga completa, como los demás filtros). */
function Vistas({ ver }: { ver: string }) {
  return (
    <>
      {([["pendientes", "Por factura"], ["clientes", "Por cliente"], ["pagadas", "Pagadas"]] as const).map(([k, t]) => (
        <a key={k} href={`/cartera?ver=${k}`} aria-current={ver === k ? "page" : undefined} className={`px-3.5 py-2 rounded-xl text-sm font-semibold ${ver === k ? "bg-ink text-white" : "text-muted"}`}>{t}</a>
      ))}
    </>
  );
}

/** Cartera agrupada por cliente con sus edades (días desde el vencimiento), filtros por edad y descarga en Excel. */
async function PorCliente({ empresa, sesion, edad, q }: { empresa: string; sesion: { uid: string }; edad: (typeof EDADES)[number]["k"] | null; q: string }) {
  const { filas, todas, mora } = await comoUsuario(sesion, async (c) => ({
    filas: await carteraPorCliente(c, empresa, edad, q),
    todas: edad || q ? await carteraPorCliente(c, empresa) : null,
    mora: (await c.query(`select dias_mora_bloqueo from empresas where id = $1`, [empresa])).rows[0]?.dias_mora_bloqueo as number | null,
  }));
  const base: FilaCliente[] = todas ?? filas;
  const suma = (k: "saldo" | (typeof EDADES)[number]["k"], l = base) => l.reduce((a, f) => a + f[k], 0);
  const qs = (x: Record<string, string | null>) => { const u = new URLSearchParams({ ver: "clientes" }); for (const [k, v] of Object.entries(x)) if (v) u.set(k, v); return `/cartera?${u}`; };
  const excel = `/api/cartera?${new URLSearchParams({ formato: "excel", ...(edad ? { edad } : {}), ...(q ? { q } : {}) })}`;
  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo="Cartera" sub="Lo que te debe cada cliente, por edad de la deuda (días desde el vencimiento de cada factura).">
        <a href={excel} className="btn-borde h-11 inline-flex items-center" download>Descargar en Excel</a>
      </Cabecera>
      <section className="grid grid-cols-2 lg:grid-cols-5 gap-3" aria-label="Edades de la cartera">
        <a href={qs({ q })} aria-current={!edad ? "true" : undefined} className={`tarjeta px-4 py-3.5 hover:border-ink ${!edad ? "border-ink border-2" : ""}`}>
          <p className="text-sm text-muted">Total por cobrar</p><p className="num titulo text-[26px] leading-tight text-aviso">{pesos(suma("saldo"))}</p>
          <p className="text-[13px] text-muted">{base.length} cliente{base.length === 1 ? "" : "s"}</p>
        </a>
        {EDADES.map((e) => (
          <a key={e.k} href={qs({ edad: e.k, q })} aria-current={edad === e.k ? "true" : undefined} className={`tarjeta px-4 py-3.5 hover:border-ink ${edad === e.k ? "border-ink border-2" : ""}`}>
            <p className="text-sm text-muted">{e.t}</p>
            <p className={`num titulo text-[26px] leading-tight ${e.k === "e0" ? "text-ink" : suma(e.k) ? "text-alerta" : "text-ink"}`}>{pesos(suma(e.k))}</p>
            <p className="text-[13px] text-muted">{base.filter((f) => f[e.k] > 0).length} cliente{base.filter((f) => f[e.k] > 0).length === 1 ? "" : "s"}</p>
          </a>
        ))}
      </section>
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <nav className="flex gap-1 tarjeta p-1 w-fit" aria-label="Vista"><Vistas ver="clientes" /></nav>
        <form className="flex gap-2 w-full sm:w-auto" role="search" action="/cartera">
          <input type="hidden" name="ver" value="clientes" />
          {edad && <input type="hidden" name="edad" value={edad} />}
          <label htmlFor="cq" className="sr-only">Buscar cliente</label>
          <input id="cq" name="q" defaultValue={q} placeholder="Nombre o documento" className="campo sm:w-64" />
          <button className="btn-oscuro">Buscar</button>
        </form>
      </div>
      {(edad || q) && <p className="text-sm">Filtrado{edad ? ` por ${EDADES.find((e) => e.k === edad)!.t}` : ""}{q ? ` · «${q}»` : ""}. <a href="/cartera?ver=clientes" className="font-semibold underline">Quitar filtros</a></p>}
      <div className="tarjeta overflow-x-auto relative">
        <table className="tabla-tarjetas w-full text-[15px] min-w-[980px]">
          <thead className="text-left text-sm text-muted border-b border-line">
            <tr><th className="px-4 py-3 font-semibold">Cliente</th><th className="px-4 py-3 font-semibold text-right">Saldo</th>
              {EDADES.map((e) => <th key={e.k} className="px-4 py-3 font-semibold text-right">{e.t}</th>)}
              <th className="px-4 py-3 font-semibold">Crédito</th></tr>
          </thead>
          <tbody className="divide-y divide-line">
            {filas.map((f) => (
              <tr key={f.cliente_id} className="align-top">
                <td className="px-4 py-3"><Link href={`/clientes/${f.cliente_id}`} className="font-semibold leading-snug hover:underline">{f.cliente}</Link>
                  <p className="text-sm text-muted num">{f.documento}{f.telefono ? ` · ${f.telefono}` : ""}</p></td>
                <td data-etiqueta="Saldo" className="px-4 py-3 num text-right font-semibold">{pesos(f.saldo)}<p className="text-sm text-muted font-normal">{f.facturas} factura{f.facturas === 1 ? "" : "s"}</p></td>
                {EDADES.map((e) => <td key={e.k} data-etiqueta={e.t} className={`px-4 py-3 num text-right ${f[e.k] && e.k !== "e0" ? "text-alerta" : f[e.k] ? "" : "text-muted"}`}>{f[e.k] ? pesos(f[e.k]) : "—"}</td>)}
                <td data-etiqueta="Crédito" className="px-4 py-3 text-sm">{f.bloqueado ? <span className="text-alerta font-semibold">Bloqueado</span> : f.cupo === null ? <span className="text-muted">Sin cupo</span> : <>Cupo {pesos(f.cupo)}</>}
                  {f.mora > 0 && <p className="text-alerta">{f.mora} días de mora</p>}</td>
              </tr>
            ))}
            {filas.length === 0 && <tr><td colSpan={7} className="px-4 py-12 text-center text-muted">{edad || q ? "Ningún cliente con ese filtro." : "Nadie te debe."}</td></tr>}
          </tbody>
          {filas.length > 0 && (
            <tfoot className="border-t-2 border-line font-semibold"><tr>
              <td className="px-4 py-3">Total</td><td data-etiqueta="Saldo" className="px-4 py-3 num text-right">{pesos(suma("saldo", filas))}</td>
              {EDADES.map((e) => <td key={e.k} data-etiqueta={e.t} className="px-4 py-3 num text-right">{pesos(suma(e.k, filas))}</td>)}<td /></tr></tfoot>
          )}
        </table>
      </div>
      <MoraBloqueo inicial={mora ?? null} />
    </main>
  );
}
