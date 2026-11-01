import Link from "next/link";
import { redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion, puede } from "@/lib/sesion";
import { Cabecera, Dato, pesos } from "@/components/ui/Cabecera";
import { Abonar } from "./Abonar";

export const metadata = { title: "Cartera" };

type Fila = { venta_id: string; numero: string; cliente: string; documento: string; telefono: string | null; creado: string; vence_pago: string; total: number; abonado: number; saldo: number; dias_mora: number };
const fecha = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("es-CO", { day: "numeric", month: "short", year: "numeric" });

export default async function Cartera({ searchParams }: { searchParams: Promise<{ ver?: string }> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puede.cartera(s.rol)) redirect("/inicio");
  const { ver = "pendientes" } = await searchParams;
  const filas: Fila[] = await comoUsuario(s, async (c) => (await c.query(`
    select venta_id, prefijo || numero numero, cliente, tipo_doc || ' ' || numero_doc || coalesce('-' || dv, '') documento, telefono,
           (creado at time zone 'America/Bogota')::date::text creado, vence_pago::text, total::float, abonado::float, saldo::float, dias_mora
    from v_cartera where empresa_id = $1 ${ver === "pagadas" ? "and saldo = 0" : "and saldo > 0"}
    order by ${ver === "pagadas" ? "creado desc" : "vence_pago, creado"} limit 300`, [s.empresa])).rows);
  const porCobrar = filas.reduce((a, f) => a + f.saldo, 0);
  const vencidas = filas.filter((f) => f.dias_mora > 0);
  const semana = filas.filter((f) => f.dias_mora === 0 && Date.parse(f.vence_pago + "T00:00:00") - Date.now() <= 7 * 864e5);
  return (
    <main className="p-4 sm:p-6 grid gap-5">
      <Cabecera titulo="Cartera" sub="Facturas a crédito de tus clientes: lo que te deben, lo que vence y los abonos." />
      {ver !== "pagadas" && (
        <section className="grid grid-cols-2 lg:grid-cols-3 gap-3">
          <Dato titulo="Por cobrar" valor={pesos(porCobrar)} tono={porCobrar ? "cruz" : undefined} nota={`${filas.length} factura${filas.length === 1 ? "" : "s"}`} />
          <Dato titulo="Vencido" valor={pesos(vencidas.reduce((a, f) => a + f.saldo, 0))} tono={vencidas.length ? "alerta" : undefined} nota={`${vencidas.length} factura${vencidas.length === 1 ? "" : "s"} en mora`} />
          <Dato titulo="Vence en 7 días" valor={pesos(semana.reduce((a, f) => a + f.saldo, 0))} tono={semana.length ? "aviso" : undefined} nota="llama antes de que se venza" />
        </section>
      )}
      <nav className="flex gap-1 tarjeta p-1 w-fit" aria-label="Vista">
        {([["pendientes", "Por cobrar"], ["pagadas", "Pagadas"]] as const).map(([k, t]) => (
          <Link key={k} href={`?ver=${k}`} aria-current={ver === k ? "page" : undefined} className={`px-3.5 py-2 rounded-xl text-sm font-semibold ${ver === k ? "bg-ink text-white" : "text-muted"}`}>{t}</Link>
        ))}
      </nav>
      <div className="tarjeta overflow-x-auto">
        <table className="w-full text-[15px] min-w-[860px]">
          <thead className="text-left text-sm text-muted border-b border-line">
            <tr><th className="px-4 py-3 font-semibold">Cliente</th><th className="px-4 py-3 font-semibold">Factura</th><th className="px-4 py-3 font-semibold">Vence</th>
              <th className="px-4 py-3 font-semibold text-right">Total</th><th className="px-4 py-3 font-semibold text-right">Abonado</th><th className="px-4 py-3 font-semibold text-right">Saldo</th>{ver !== "pagadas" && <th className="px-4 py-3 font-semibold">Abono</th>}</tr>
          </thead>
          <tbody className="divide-y divide-line">
            {filas.map((f) => (
              <tr key={f.venta_id} className="align-top">
                <td className="px-4 py-3"><p className="font-semibold leading-snug">{f.cliente}</p><p className="text-sm text-muted num">{f.documento}{f.telefono ? ` · ${f.telefono}` : ""}</p></td>
                <td className="px-4 py-3"><Link href={`/ventas/${f.venta_id}`} className="num font-semibold hover:underline">{f.numero}</Link><p className="text-sm text-muted">{fecha(f.creado)}</p></td>
                <td className="px-4 py-3">
                  <span className={`rounded-md px-2 py-0.5 text-sm font-semibold ${f.saldo === 0 ? "bg-paper" : f.dias_mora > 0 ? "bg-alerta-soft text-alerta" : "bg-paper"}`}>{fecha(f.vence_pago)}</span>
                  {f.saldo > 0 && f.dias_mora > 0 && <p className="text-sm text-alerta mt-1">{f.dias_mora} día{f.dias_mora === 1 ? "" : "s"} de mora</p>}
                </td>
                <td className="px-4 py-3 num text-right">{pesos(f.total)}</td>
                <td className="px-4 py-3 num text-right text-muted">{pesos(f.abonado)}</td>
                <td className="px-4 py-3 num text-right font-semibold">{pesos(f.saldo)}</td>
                {ver !== "pagadas" && <td className="px-4 py-3"><Abonar venta={f.venta_id} saldo={f.saldo} numero={f.numero} /></td>}
              </tr>
            ))}
            {filas.length === 0 && <tr><td colSpan={7} className="px-4 py-12 text-center text-muted">{ver === "pagadas" ? "Aún no hay facturas a crédito pagadas por completo." : "Nadie te debe. Las ventas a crédito se hacen desde la Caja: Factura electrónica → Cobrar → Crédito."}</td></tr>}
          </tbody>
        </table>
      </div>
    </main>
  );
}
