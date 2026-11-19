import { InvitacionPro } from "../InvitacionPro";
import { controlEspecialActivo } from "@/lib/control-plan";
import { redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion, puede } from "@/lib/sesion";
import { Cabecera, Dato } from "@/components/ui/Cabecera";
import { hoyBogota } from "@/lib/reportes";
import { detiene, mesAnterior, mesValido, nombreMes } from "@/lib/anexo13";
import { CANALES, estadoPlazo, informeMes, informesPresentados, moduloListo, sedes } from "@/lib/anexo13-datos";
import { AvisoPlazo, Pestanas } from "../Pestanas";
import { Descargar, Presentar } from "./Acciones";

export const metadata = { title: "Informe mensual de control especial (Anexo 13)" };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const dma = (f: string) => f.split("-").reverse().join("/");
const und = (n: number) => n.toLocaleString("es-CO");

export default async function Anexo13({ searchParams }: { searchParams: Promise<{ mes?: string; sede?: string }> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puede.verCostos(s.rol)) redirect("/inicio?aviso=permiso");
  if (!(await controlEspecialActivo(s.empresa))) return <InvitacionPro dueno={s.rol === "dueno"} />; // plan sin el módulo (Esencial)
  const sp = await searchParams;
  const hoy = hoyBogota();
  const mes = mesValido(sp.mes) && sp.mes <= hoy.slice(0, 7) ? sp.mes : mesAnterior(hoy);
  const sede = sp.sede && UUID.test(sp.sede) ? sp.sede : null;
  const d = await comoUsuario(s, async (c) => (await moduloListo(c)) ? {
    inf: await informeMes(c, s.empresa, sede, mes, hoy), sedes: await sedes(c, s.empresa), informes: await informesPresentados(c, s.empresa),
    plazo: await estadoPlazo(c, s.empresa, hoy), demo: !!(await c.query(`select demo from empresas where id = $1`, [s.empresa])).rows[0]?.demo,
  } : null);
  const filtro = `mes=${mes}${sede ? `&sede=${sede}` : ""}`;

  if (!d) return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo="Informe mensual (Anexo 13)" />
      <Pestanas actual="/control-especial/anexo-13" />
      <section className="tarjeta p-6"><h2 className="titulo text-xl">Se está activando</h2><p className="mt-1 text-muted">El informe mensual estará disponible en unos minutos.</p></section>
    </main>
  );
  const { inf } = d;
  const presentados = d.informes.filter((i) => i.mes === mes && (i.sede_id ?? null) === sede);
  const vigente = presentados.find((i) => i.vigente);
  const mesCerrado = inf.hasta < hoy;
  const cfg = inf.config;

  return (
    <main className="p-4 sm:p-6 grid grid-cols-[minmax(0,1fr)] gap-5">
      <Cabecera titulo="Informe mensual (Anexo 13)" sub={<>Fondo Rotatorio de Estupefacientes · {nombreMes(mes)}{inf.encabezado.sede && d.sedes.length > 1 ? ` · ${inf.encabezado.sede}` : ""}</>}>
        <Descargar filtro={filtro} detiene={detiene(inf.avisos)} />
        <a href={`/control-especial/anexo-13/imprimir?${filtro}`} target="_blank" rel="noopener" className="btn-oscuro">Informe para imprimir</a>
      </Cabecera>
      <Pestanas actual="/control-especial/anexo-13" />
      <AvisoPlazo plazo={d.plazo} />

      <form className="tarjeta p-4 grid gap-3 sm:flex sm:flex-wrap sm:items-end" aria-label="Mes del informe">
        <label className="grid text-sm text-muted">Mes<input type="month" name="mes" defaultValue={mes} max={hoy.slice(0, 7)} className="campo sm:w-auto" /></label>
        {d.sedes.length > 1 && (
          <label className="grid text-sm text-muted">Establecimiento
            <select name="sede" defaultValue={sede ?? ""} className="campo"><option value="">Toda la droguería</option>{d.sedes.map((x) => <option key={x.id} value={x.id}>{x.nombre}</option>)}</select>
          </label>
        )}
        <button className="btn-oscuro">Ver</button>
        <p className="text-sm text-muted sm:ml-auto">Se presenta dentro de los primeros 10 días calendario del mes siguiente (Res. 1478 de 2006, art. 94), también en ceros si no hubo movimiento.</p>
      </form>

      {vigente && (
        <p role="status" className="rounded-xl bg-cruz-soft text-cruz px-4 py-3 text-sm font-semibold">
          Presentado el {dma(vigente.presentado)} por {CANALES[vigente.canal]?.toLowerCase() ?? vigente.canal}{vigente.radicado ? ` · radicado ${vigente.radicado}` : ""}{vigente.usuario ? ` · registró ${vigente.usuario}` : ""}.
        </p>
      )}

      {inf.avisos.length > 0 && (
        <section className="tarjeta p-5" aria-labelledby="revision-titulo">
          <h2 id="revision-titulo" className="titulo text-xl">Revisión antes de enviar</h2>
          <ul className="mt-2 grid gap-2">{inf.avisos.map((a, i) => (
            <li key={i} className={`rounded-xl px-4 py-3 text-sm ${a.nivel === "detiene" ? "bg-alerta-soft text-alerta" : "bg-aviso-soft text-aviso"}`}>
              <span className="font-semibold">{a.nivel === "detiene" ? "Corrige o confirma: " : "Aviso: "}</span>{a.texto}
            </li>
          ))}</ul>
          {inf.avisos.some((a) => /Ficha incompleta|departamento y el Fondo/.test(a.texto)) && <p className="mt-2 text-sm"><a href="/control-especial/fichas" className="font-semibold text-cruz underline underline-offset-4">Completar fichas y configuración</a></p>}
        </section>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
        <Dato titulo="Medicamentos" valor={und(inf.totales.productos)} nota={inf.totales.sin_movimiento ? `${inf.totales.sin_movimiento} sin movimiento (en ceros)` : undefined} />
        <Dato titulo="Entradas" valor={und(inf.totales.entradas)} nota="unidades" />
        <Dato titulo="Salidas" valor={und(inf.totales.salidas)} nota={`${und(inf.totales.formulas)} recetario${inf.totales.formulas === 1 ? "" : "s"}`} />
        <Dato titulo="Saldo final" valor={und(inf.totales.final)} nota="cuadra con el inventario de Regenta" />
      </div>

      <section className="tarjeta p-5 min-w-0" aria-labelledby="vista-titulo">
        <div className="flex flex-wrap justify-between items-baseline gap-2">
          <h2 id="vista-titulo" className="titulo text-xl">Vista previa</h2>
          <p className="text-sm text-muted">{cfg.propia ? "Columnas de tu plantilla" : "Plantilla base de Regenta"} · <a href="/control-especial/fichas#plantilla" className="font-semibold text-cruz underline underline-offset-4">ajustar al formato de tu fondo</a></p>
        </div>
        {inf.tabla.datos.length === 0 ? (
          <p className="mt-3 text-muted">No tienes medicamentos de control especial: si no manejas ninguno, el informe se presenta en ceros (N/A). Márcalos en Productos → Editar → «Medicamento de control especial».</p>
        ) : (
          <div className="mt-3 overflow-x-auto max-w-full">
            <table className="text-[13px] min-w-full w-max lg:w-full">
              <thead><tr className="text-left text-muted border-b border-line">{inf.tabla.columnas.map(([k, t]) => <th key={k} className="py-2 px-2 font-medium align-bottom min-w-20">{t}</th>)}</tr></thead>
              <tbody className="divide-y divide-line align-top">{inf.tabla.datos.map((f, i) => (
                <tr key={i}>{inf.tabla.columnas.map(([k]) => <td key={k} className={`py-2 px-2 ${typeof f[k] === "number" ? "text-right num" : ""}`}>{String(f[k])}</td>)}</tr>
              ))}</tbody>
            </table>
          </div>
        )}
      </section>

      <section className="tarjeta p-5 grid gap-3" aria-labelledby="presentar-titulo">
        <div>
          <h2 id="presentar-titulo" className="titulo text-xl">Registrar el envío</h2>
          <p className="text-sm text-muted mt-0.5">
            {cfg.fondo ? <>Destino: {cfg.fondo}{cfg.canal ? ` · ${CANALES[cfg.canal]}` : ""}{cfg.destino ? ` · ${cfg.destino}` : ""}. </> : <>Configura tu Fondo Rotatorio en <a href="/control-especial/fichas" className="underline">Fichas y configuración</a>. </>}
            Al registrarlo se guarda lo que presentaste (totales) y deja de salir el recordatorio. No se edita: una corrección es un registro nuevo.
          </p>
        </div>
        {mesCerrado
          ? <Presentar mes={mes} sede={sede} canal={cfg.canal ?? ""} hoy={hoy} demo={d.demo} yaPresentado={!!vigente} />
          : <p className="text-sm text-muted">El envío se registra cuando el mes termina.</p>}
      </section>

      {d.informes.length > 0 && (
        <section className="tarjeta p-5" aria-labelledby="historial-titulo">
          <h2 id="historial-titulo" className="titulo text-xl">Informes registrados</h2>
          <ul className="mt-3 grid gap-2">{d.informes.map((i) => (
            <li key={i.id} className={`rounded-xl border p-3 text-sm grid sm:grid-cols-[10rem_1fr_auto] gap-1 sm:gap-3 ${i.vigente ? "border-line" : "border-line opacity-70"}`}>
              <a href={`/control-especial/anexo-13?mes=${i.mes}${i.sede_id ? `&sede=${i.sede_id}` : ""}`} className="font-semibold capitalize">{nombreMes(i.mes)}</a>
              <span className="text-muted">{i.sede ? `${i.sede} · ` : ""}presentado el {dma(i.presentado)} · {CANALES[i.canal]?.toLowerCase() ?? i.canal}{i.radicado ? ` · radicado ${i.radicado}` : ""}{i.observacion ? ` · ${i.observacion}` : ""}</span>
              <span className="num text-muted sm:text-right">{i.vigente ? `${und(Number(i.totales?.productos ?? 0))} medicamentos · saldo ${und(Number(i.totales?.final ?? 0))}` : "reemplazado"}</span>
            </li>
          ))}</ul>
        </section>
      )}
    </main>
  );
}
