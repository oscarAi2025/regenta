import Link from "next/link";
import { redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion, puede } from "@/lib/sesion";
import { Cabecera } from "@/components/ui/Cabecera";
import { pesos } from "@/lib/formato";
import { estadoTurno } from "@/lib/turnos";
import { cajaElegida } from "@/lib/caja-elegida";
import { ElegirCaja } from "@/components/app/ElegirCaja";
import { Turno } from "./Turno";
import { RecibirAbono } from "../clientes/RecibirAbono";

export const metadata = { title: "Turno de caja" };

export default async function PaginaTurno() {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puede.vender(s.rol)) redirect("/inicio?aviso=permiso");
  const gerencia = puede.cartera(s.rol);
  const caja = await cajaElegida();
  const { estado, historial, cajas } = await comoUsuario(s, async (c) => ({
    cajas: (await c.query(`select id, nombre from cajas where empresa_id = $1 and activa order by nombre`, [s.empresa])).rows as { id: string; nombre: string }[],
    estado: await estadoTurno(c, s.empresa, caja),
    historial: (await c.query(
      `select t.id, cj.nombre caja, to_char(t.abierto at time zone 'America/Bogota', 'DD/MM HH24:MI') abierto, to_char(t.cerrado at time zone 'America/Bogota', 'DD/MM HH24:MI') cerrado,
              ma.nombre abre, mc.nombre cierra, (t.resumen ->> 'ventas')::float ventas, t.efectivo_esperado::float esperado, t.efectivo_contado::float contado, t.diferencia::float diferencia
       from turnos t join cajas cj on cj.id = t.caja_id
       left join miembros ma on ma.empresa_id = t.empresa_id and ma.user_id = t.abre_usuario
       left join miembros mc on mc.empresa_id = t.empresa_id and mc.user_id = t.cierra_usuario
       where t.empresa_id = $1 and t.estado = 'cerrado' ${gerencia ? "" : "and t.cierra_usuario = $2"} order by t.cerrado desc limit 30`,
      gerencia ? [s.empresa] : [s.empresa, s.uid])).rows,
  }));
  const nombre = (n: string | null) => String(n ?? "").split(" (")[0];
  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo="Turno de caja" sub="Abre la caja con la base, registra entradas y salidas de efectivo y ciérrala contando el dinero." />
      {cajas.length > 1 && <ElegirCaja cajas={cajas} actual={estado.caja?.id ?? null} />}
      <Turno estado={JSON.parse(JSON.stringify(estado))} dueno={s.rol === "dueno"} ciego={s.rol === "cajero"} />
      {estado.caja && (estado.turno || gerencia) && (
        <div className="grid gap-2 justify-items-start [&>section]:w-full [&>section]:max-w-2xl">
          {!estado.turno && <p className="text-sm text-muted">Sin turno abierto, el pago no entra al efectivo de ninguna caja.</p>}
          <RecibirAbono />
        </div>
      )}
      <section className="tarjeta overflow-x-auto" aria-label="Turnos cerrados">
        <h2 className="titulo text-xl px-4 pt-4">Turnos cerrados</h2>
        {historial.length === 0 ? <p className="px-4 py-4 text-muted">Aún no hay turnos cerrados.</p> : (
          <table className="w-full text-[15px] min-w-[760px] mt-2">
            <thead className="text-left text-sm text-muted border-b border-line">
              <tr><th className="px-4 py-2 font-semibold">Caja</th><th className="px-4 py-2 font-semibold">Abrió</th><th className="px-4 py-2 font-semibold">Cerró</th>
                <th className="px-4 py-2 font-semibold text-right">Ventas</th><th className="px-4 py-2 font-semibold text-right">Esperado</th><th className="px-4 py-2 font-semibold text-right">Contado</th><th className="px-4 py-2 font-semibold text-right">Diferencia</th><th className="px-4 py-2" /></tr>
            </thead>
            <tbody className="divide-y divide-line">
              {historial.map((t) => (
                <tr key={t.id}>
                  <td className="px-4 py-2.5">{t.caja}</td>
                  <td className="px-4 py-2.5 num">{t.abierto}<p className="text-sm text-muted">{nombre(t.abre)}</p></td>
                  <td className="px-4 py-2.5 num">{t.cerrado}<p className="text-sm text-muted">{nombre(t.cierra)}</p></td>
                  <td className="px-4 py-2.5 num text-right">{pesos(t.ventas ?? 0)}</td>
                  <td className="px-4 py-2.5 num text-right">{pesos(t.esperado)}</td>
                  <td className="px-4 py-2.5 num text-right">{pesos(t.contado)}</td>
                  <td className={`px-4 py-2.5 num text-right font-semibold ${t.diferencia < 0 ? "text-alerta" : t.diferencia > 0 ? "text-aviso" : "text-cruz"}`}>{t.diferencia > 0 ? "+" : ""}{pesos(t.diferencia)}</td>
                  <td className="px-4 py-2.5"><Link href={`/tiquete/turno/${t.id}`} className="text-sm font-semibold text-cruz hover:underline">Ver / imprimir</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </main>
  );
}
