import Link from "next/link";
import { redirect } from "next/navigation";
import { cajaElegida } from "@/lib/caja-elegida";
import { comoUsuario, puestoDeTrabajo } from "@/lib/db";
import { leerSesion } from "@/lib/sesion";
import { Cabecera } from "@/components/ui/Cabecera";
import { datosMes, hoyBogota, jornadaActual, mesValido, puedeRangos, puedeTemperatura } from "@/lib/temperatura";
import { mesLargo, otroMes, type Jornada } from "@/lib/temperatura-comun";
import { Planilla } from "./Planilla";
import { Rangos } from "./Rangos";

export const metadata = { title: "Temperatura y humedad" };

export default async function Temperatura({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puedeTemperatura(s.rol)) redirect("/inicio?aviso=permiso"); // dueño, administrador y bodega
  const mes = mesValido((await searchParams).mes);
  const hoy = hoyBogota();
  const caja = await cajaElegida();
  const d = await comoUsuario(s, async (c) => {
    const { sede_id } = await puestoDeTrabajo(c, s.empresa, caja);
    const sede = (await c.query(`select nombre from sedes where id = $1`, [sede_id])).rows[0]?.nombre as string | undefined;
    return { sede, ...(await datosMes(c, s.empresa, sede_id, mes)) };
  });
  const limite = new Date(new Date(hoy + "T12:00:00Z").getTime() - 7 * 86400000).toISOString().slice(0, 10);
  const actual = hoy.slice(0, 7);
  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo="Temperatura y humedad" sub={<>Planilla de {mesLargo(mes)}{d.sede ? ` · sede ${d.sede}` : ""}</>}>
        <Link href={`/informes/temperatura?mes=${mes}`} className="btn-borde">Informe del mes</Link>
        <a href={`/api/temperatura?mes=${mes}`} className="btn-borde" download>Exportar CSV</a>
      </Cabecera>
      <nav className="flex flex-wrap items-center gap-2" aria-label="Mes">
        <Link href={`/temperatura?mes=${otroMes(mes, -1)}`} className="btn-borde h-10 text-sm" aria-label="Mes anterior">← {mesLargo(otroMes(mes, -1)).split(" ")[0]}</Link>
        <span className="titulo text-lg px-2">{mesLargo(mes).replace(/^./, (x) => x.toUpperCase())}</span>
        {mes < actual && <Link href={`/temperatura?mes=${otroMes(mes, 1)}`} className="btn-borde h-10 text-sm" aria-label="Mes siguiente">{mesLargo(otroMes(mes, 1)).split(" ")[0]} →</Link>}
        {mes !== actual && <Link href="/temperatura" className="text-sm font-semibold text-cruz px-2">Ir al mes actual</Link>}
      </nav>
      <Planilla mes={mes} hoy={hoy} jornada={jornadaActual() as Jornada} registros={d.registros} rangos={d.rangos} inicio={d.inicio} puedeRegistrar={puedeTemperatura(s.rol)} limite={limite}>
        <Rangos rangos={d.rangos} editable={puedeRangos(s.rol)} />
      </Planilla>
    </main>
  );
}
