import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion, puede } from "@/lib/sesion";
import { hoyBogota } from "@/lib/reportes";
import { mesAnterior, mesValido, nombreMes } from "@/lib/anexo13";
import { CANALES, informeMes, moduloListo, recetariosMes } from "@/lib/anexo13-datos";
import { Imprimir } from "./Imprimir";

// Informe mensual de control especial (Anexo 13) para imprimir o guardar en PDF (A4 horizontal): encabezado del
// establecimiento, tabla con las columnas de la plantilla de la droguería (texto en mayúscula, ceros y N/A, art. 91) y la
// relación de recetarios dispensados en el mes.
export const metadata: Metadata = { title: "Informe mensual de control especial", robots: { index: false, follow: false } };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const dma = (f: string) => f.split("-").reverse().join("/");

export default async function ImprimirAnexo13({ searchParams }: { searchParams: Promise<{ mes?: string; sede?: string }> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puede.verCostos(s.rol)) redirect("/inicio?aviso=permiso");
  const sp = await searchParams;
  const hoy = hoyBogota();
  const mes = mesValido(sp.mes) && sp.mes <= hoy.slice(0, 7) ? sp.mes : mesAnterior(hoy);
  const sede = sp.sede && UUID.test(sp.sede) ? sp.sede : null;
  const d = await comoUsuario(s, async (c) => (await moduloListo(c)) ? { inf: await informeMes(c, s.empresa, sede, mes, hoy), rec: await recetariosMes(c, s.empresa, sede, mes) } : null);
  if (!d) redirect("/control-especial/anexo-13");
  const { inf, rec } = d;
  const e = inf.encabezado, cfg = inf.config;
  const generado = new Date().toLocaleString("es-CO", { timeZone: "America/Bogota", dateStyle: "long", timeStyle: "short" });
  const th = "py-1 px-1 text-left font-bold border border-ink align-bottom";
  const td = "py-1 px-1 border border-ink align-top";

  return (
    <main className="informe max-w-[1200px] mx-auto p-4 sm:p-10 print:p-0 bg-white text-ink grid gap-4 text-[12px]">
      <style>{`@page { size: A4 landscape; margin: 10mm; } @media print { html, body { background: #fff; } .informe { font-size: 8pt; } tr { break-inside: avoid; } }
        .formato { font-family: Arial, Helvetica, sans-serif; text-transform: uppercase; }`}</style>
      <header className="grid sm:grid-cols-[1fr_auto] print:grid-cols-[1fr_auto] gap-3 border-b-2 border-ink pb-3">
        <div>
          <p className="titulo text-xl">{e.nombre}</p>
          <p>{e.razon_social} · NIT {e.nit}{e.dv ? `-${e.dv}` : ""}</p>
          <p>{[e.sede_direccion ?? e.direccion, e.sede_ciudad ?? e.ciudad].filter(Boolean).join(", ")}{e.sede ? ` · ${e.sede}` : ""}</p>
          <p>{[e.telefono, e.email].filter(Boolean).join(" · ")}</p>
        </div>
        <div className="sm:text-right print:text-right">
          <h1 className="titulo text-2xl">Informe mensual de control especial</h1>
          <p className="font-semibold">Anexo 13 · Res. 1478 de 2006 · {nombreMes(mes)}</p>
          <p>{cfg.fondo ?? "Fondo Rotatorio de Estupefacientes"}{cfg.departamento ? ` · ${cfg.departamento}` : ""}</p>
          {cfg.canal && <p>{CANALES[cfg.canal]}{cfg.destino ? `: ${cfg.destino}` : ""}</p>}
        </div>
      </header>

      <section aria-labelledby="tabla-anexo">
        <h2 id="tabla-anexo" className="sr-only">Movimiento del mes por medicamento</h2>
        <div className="overflow-x-auto print:overflow-visible">
          <table className="formato w-full border-collapse min-w-[900px] print:min-w-0">
            <thead><tr>{inf.tabla.columnas.map(([k, t]) => <th key={k} className={th}>{t}</th>)}</tr></thead>
            <tbody>
              {inf.tabla.datos.map((f, i) => <tr key={i}>{inf.tabla.columnas.map(([k]) => <td key={k} className={`${td} ${typeof f[k] === "number" ? "text-right num" : ""}`}>{String(f[k])}</td>)}</tr>)}
              {inf.tabla.datos.length === 0 && <tr><td colSpan={inf.tabla.columnas.length} className={td}>SIN MOVIMIENTOS EN EL PERIODO · N/A · 0</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="mt-1 text-muted">Cantidades en unidades mínimas de dispensación. Las devoluciones y bajas ya están dentro de entradas o salidas y se anotan en observaciones.</p>
      </section>

      <section aria-labelledby="tabla-recetarios">
        <h2 id="tabla-recetarios" className="titulo text-lg mb-1">Relación de recetarios dispensados ({rec.length})</h2>
        <div className="overflow-x-auto print:overflow-visible">
          <table className="formato w-full border-collapse min-w-[900px] print:min-w-0">
            <thead><tr><th className={th}>Fecha</th><th className={th}>N.º recetario</th><th className={th}>Fecha recetario</th><th className={th}>Medicamento</th>
              <th className={`${th} text-right`}>Unid.</th><th className={th}>Prescriptor · registro</th><th className={th}>Paciente · documento</th><th className={th}>Venta</th></tr></thead>
            <tbody>
              {rec.map((r, i) => (
                <tr key={i}><td className={`${td} num whitespace-nowrap`}>{dma(r.fecha)}</td><td className={`${td} num`}>{r.formula_numero}</td><td className={`${td} num`}>{dma(r.formula_fecha)}</td>
                  <td className={td}>{r.producto}</td><td className={`${td} num text-right`}>{r.unidades}</td><td className={td}>{r.medico_nombre} · {r.medico_registro}</td>
                  <td className={td}>{r.paciente_nombre} · {r.paciente_tipo_doc} {r.paciente_doc}</td><td className={`${td} num`}>{r.venta}</td></tr>
              ))}
              {rec.length === 0 && <tr><td colSpan={8} className={td}>N/A</td></tr>}
            </tbody>
          </table>
        </div>
      </section>

      <footer className="grid sm:grid-cols-2 print:grid-cols-2 gap-10 pt-8">
        <p className="border-t border-ink pt-1.5">Director técnico: {cfg.responsable ?? "(nombre y firma)"}{cfg.responsable_registro ? ` · registro ${cfg.responsable_registro}` : ""}</p>
        <p className="border-t border-ink pt-1.5">Representante legal (nombre y firma)</p>
      </footer>
      <p className="text-muted">Generado en Regenta el {generado} por {s.nombre.split(" (")[0]}. Cifras calculadas de los movimientos de inventario registrados (no editables): coinciden con el inventario del sistema.</p>
      <Imprimir mes={mes} />
    </main>
  );
}
