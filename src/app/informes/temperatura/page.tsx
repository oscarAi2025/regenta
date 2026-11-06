import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { cajaElegida } from "@/lib/caja-elegida";
import { comoUsuario, puestoDeTrabajo } from "@/lib/db";
import { leerSesion } from "@/lib/sesion";
import { datosMes, hoyBogota, mesValido, puedeTemperatura } from "@/lib/temperatura";
import { AREAS, JORNADAS, celdas, dec, diaCorto, mesLargo, nombreCorto, rangoTexto, type Area, type Celda, type Jornada, type Registro } from "@/lib/temperatura-comun";
import { Botones } from "./Botones";

// Informe mensual imprimible de la planilla de temperatura y humedad (hoja carta/A4), para archivar firmado.
export const metadata: Metadata = { title: "Informe de temperatura y humedad", robots: { index: false, follow: false } };

const valores = (r: Registro) => `${dec(r.temperatura)} °C${r.humedad !== null ? ` · ${dec(r.humedad)} %` : ""}`;

export default async function InformeTemperatura({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puedeTemperatura(s.rol)) redirect("/inicio?aviso=permiso");
  const mes = mesValido((await searchParams).mes);
  const hoy = hoyBogota();
  const caja = await cajaElegida();
  const d = await comoUsuario(s, async (c) => {
    const { sede_id } = await puestoDeTrabajo(c, s.empresa, caja);
    const e = (await c.query(`select e.razon_social, e.nombre_comercial, e.nit, e.dv, e.direccion, e.ciudad, sd.nombre sede, sd.direccion sede_direccion, sd.ciudad sede_ciudad
      from empresas e join sedes sd on sd.empresa_id = e.id where e.id = $1 and sd.id = $2`, [s.empresa, sede_id])).rows[0];
    return { e, ...(await datosMes(c, s.empresa, sede_id, mes)) };
  });
  const { e, registros, rangos, inicio } = d;
  // La nevera solo sale si la droguería lleva su planilla.
  const areas = (Object.keys(AREAS) as Area[]).filter((a) => a === "general" || inicio[a] || registros.some((r) => r.area === a));
  const vigentes = registros.filter((r) => r.vigente);
  const fuera = vigentes.filter((r) => r.fuera_rango);
  const porId = new Map(registros.map((r) => [r.id, r]));
  const correcciones = registros.filter((r) => r.anula_id);
  const generado = new Date().toLocaleString("es-CO", { timeZone: "America/Bogota", day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" });
  const celda = (c: Celda) => {
    const v = c.vigente;
    if (v) return { t: dec(v.temperatura), h: v.humedad === null ? "—" : dec(v.humedad), quien: nombreCorto(v.responsable), fuera: v.fuera_rango, corr: c.historial.length > 1 };
    return { t: c.estado === "falta" ? "Falta" : "—", h: "", quien: "", fuera: false, corr: false, falta: c.estado === "falta" };
  };

  return (
    <main className="informe mx-auto max-w-[210mm] bg-white text-ink p-6 sm:p-10 grid gap-5">
      <style>{`
        @page { size: A4 portrait; margin: 12mm; }
        html, body { background: #fff !important; }
        @media print { .informe { padding: 0 !important; max-width: none !important; } }
        .informe table { border-collapse: collapse; width: 100%; }
        .informe th, .informe td { border: 1px solid #c8d2cf; padding: 3px 5px; }
        .informe thead th { background: #eef3f1; }
        .informe .fuera { color: #b42318; font-weight: 700; }
        .informe tr { break-inside: avoid; }
      `}</style>
      <Botones volver={`/temperatura?mes=${mes}`} />
      <header className="flex flex-wrap justify-between gap-4 border-b-2 border-ink pb-3">
        <div>
          <p className="titulo text-2xl leading-tight">{e.nombre_comercial || e.razon_social}</p>
          <p className="text-sm">{e.razon_social} · NIT {e.nit}{e.dv ? `-${e.dv}` : ""}</p>
          <p className="text-sm">Sede {e.sede}{e.sede_direccion || e.direccion ? ` · ${e.sede_direccion || e.direccion}` : ""}{e.sede_ciudad || e.ciudad ? `, ${e.sede_ciudad || e.ciudad}` : ""}</p>
        </div>
        <div className="text-right">
          <h1 className="titulo text-xl leading-tight">Control de temperatura y humedad relativa</h1>
          <p className="text-lg">{mesLargo(mes).replace(/^./, (x) => x.toUpperCase())}</p>
        </div>
      </header>

      <section className="text-sm grid gap-1">
        <p className="font-semibold">Rangos configurados por la droguería</p>
        {rangos.filter((r) => areas.includes(r.area)).map((r) => <p key={r.area}>{AREAS[r.area]}: temperatura {rangoTexto(r.temp_min, r.temp_max, "°C")} · humedad relativa {rangoTexto(r.hum_min, r.hum_max, "%")}</p>)}
        <p className="text-muted">Dos registros al día (mañana y tarde). Los valores fuera de rango van en rojo y con asterisco (*); «Falta» = jornada sin registro.</p>
      </section>

      {areas.map((a) => {
        const t = celdas(mes, a, registros, inicio[a] ?? null, hoy);
        return (
          <section key={a} aria-label={AREAS[a]}>
            <h2 className="titulo text-lg mb-1">{AREAS[a]}</h2>
            <table className="text-[11.5px] num">
              <thead>
                <tr><th rowSpan={2} className="text-left">Día</th>{(Object.keys(JORNADAS) as Jornada[]).map((j) => <th key={j} colSpan={3}>{JORNADAS[j]}</th>)}</tr>
                <tr>{(Object.keys(JORNADAS) as Jornada[]).flatMap((j) => [<th key={j + "t"}>°C</th>, <th key={j + "h"}>HR %</th>, <th key={j + "r"} className="text-left">Responsable</th>])}</tr>
              </thead>
              <tbody>
                {Object.entries(t).map(([dia, js]) => (
                  <tr key={dia}>
                    <td className="whitespace-nowrap">{diaCorto(dia)}</td>
                    {(Object.keys(JORNADAS) as Jornada[]).flatMap((j) => {
                      const c = celda(js[j]);
                      return [
                        <td key={j + "t"} className={`text-center ${c.fuera ? "fuera" : ""} ${c.falta ? "text-aviso font-semibold" : ""}`}>{c.t}{c.fuera ? "*" : ""}{c.corr ? "†" : ""}</td>,
                        <td key={j + "h"} className={`text-center ${c.fuera ? "fuera" : ""}`}>{c.h}</td>,
                        <td key={j + "r"} className="font-sans">{c.quien}</td>,
                      ];
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        );
      })}
      {correcciones.length > 0 && <p className="text-xs text-muted -mt-3">† Valor corregido: el registro anterior se conserva (ver «Correcciones»).</p>}

      <section aria-label="Fuera de rango">
        <h2 className="titulo text-lg mb-1">Fuera de rango y acciones correctivas</h2>
        {fuera.length ? (
          <table className="text-[11.5px]">
            <thead><tr><th className="text-left">Fecha</th><th className="text-left">Jornada</th><th className="text-left">Área</th><th>Valor</th><th className="text-left">Acción correctiva</th><th className="text-left">Responsable</th></tr></thead>
            <tbody>{fuera.map((r) => <tr key={r.id}><td className="num whitespace-nowrap">{diaCorto(r.fecha)}</td><td>{JORNADAS[r.jornada]}</td><td>{AREAS[r.area].split(" (")[0]}</td><td className="fuera num whitespace-nowrap">{valores(r)}</td><td>{r.accion}</td><td>{nombreCorto(r.responsable)}</td></tr>)}</tbody>
          </table>
        ) : <p className="text-sm">Ningún registro del mes quedó fuera de rango.</p>}
      </section>

      {correcciones.length > 0 && (
        <section aria-label="Correcciones">
          <h2 className="titulo text-lg mb-1">Correcciones</h2>
          <table className="text-[11.5px]">
            <thead><tr><th className="text-left">Fecha</th><th className="text-left">Jornada</th><th className="text-left">Área</th><th>Antes</th><th>Después</th><th className="text-left">Motivo</th><th className="text-left">Corrigió</th></tr></thead>
            <tbody>{correcciones.map((r) => { const o = porId.get(r.anula_id!); return <tr key={r.id}><td className="num whitespace-nowrap">{diaCorto(r.fecha)}</td><td>{JORNADAS[r.jornada]}</td><td>{AREAS[r.area].split(" (")[0]}</td><td className="num whitespace-nowrap">{o ? valores(o) : "—"}</td><td className="num whitespace-nowrap">{valores(r)}</td><td>{r.motivo}</td><td>{nombreCorto(r.responsable)} · {r.creado}</td></tr>; })}</tbody>
          </table>
        </section>
      )}

      <section className="grid sm:grid-cols-2 gap-8 pt-8 text-sm" aria-label="Firmas">
        <div><div className="border-t border-ink pt-1">Firma del regente o director(a) técnico(a)</div><p className="mt-6 border-t border-ink pt-1">Nombre y tarjeta profesional</p></div>
        <div><div className="border-t border-ink pt-1">Fecha de revisión</div><p className="mt-6 border-t border-ink pt-1">Observaciones</p></div>
      </section>
      <p className="text-xs text-muted">Generado con Regenta el {generado}. {vigentes.length} registro{vigentes.length === 1 ? "" : "s"} vigente{vigentes.length === 1 ? "" : "s"} en el mes. Los registros no se borran: cada corrección queda con su motivo.</p>
    </main>
  );
}
