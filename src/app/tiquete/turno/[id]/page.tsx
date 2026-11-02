import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion, puede } from "@/lib/sesion";
import { MEDIO, pesos } from "@/lib/formato";
import { AutoImprimir } from "../../[id]/AutoImprimir";

// Reporte de turno para la impresora térmica: corte parcial (turno abierto, cifras en vivo) o cierre (cifras guardadas).
export const metadata: Metadata = { title: "Cierre de turno", robots: { index: false, follow: false } };

type Resumen = { ventas: number; n_ventas: number; anuladas: number; iva: number; credito: number; medios: Record<string, number>; efectivo_ventas: number; abonos_efectivo: number; ingresos: number; egresos: number; base: number; efectivo_esperado: number; devoluciones?: number; n_devoluciones?: number; devoluciones_efectivo?: number; ventas_netas?: number };

export default async function CierreTurno({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ancho?: string; auto?: string }> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puede.vender(s.rol)) redirect("/inicio?aviso=permiso");
  const { id } = await params;
  const { ancho = "80", auto } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const mm = ancho === "58" ? 58 : 80;

  const d = await comoUsuario(s, async (c) => {
    const t = (await c.query(
      `select t.*, cj.nombre caja, e.razon_social, e.nombre_comercial, e.nit, e.dv,
              to_char(t.abierto at time zone 'America/Bogota', 'DD/MM/YYYY HH24:MI') abre_txt, to_char(coalesce(t.cerrado, now()) at time zone 'America/Bogota', 'DD/MM/YYYY HH24:MI') cierra_txt,
              ma.nombre abre_nombre, mc.nombre cierra_nombre
       from turnos t join cajas cj on cj.id = t.caja_id join empresas e on e.id = t.empresa_id
       left join miembros ma on ma.empresa_id = t.empresa_id and ma.user_id = t.abre_usuario
       left join miembros mc on mc.empresa_id = t.empresa_id and mc.user_id = t.cierra_usuario
       where t.id = $1 and t.empresa_id = $2`, [id, s.empresa])).rows[0];
    if (!t) return null;
    const r: Resumen = t.estado === "cerrado" && t.resumen ? t.resumen : (await c.query(`select resumen_turno($1) r`, [id])).rows[0].r;
    const movs = (await c.query(`select tipo, valor::float, concepto from movimientos_caja where turno_id = $1 order by creado`, [id])).rows;
    return { t, r, movs };
  });
  if (!d) notFound();
  const { t, r, movs } = d;
  const cerrado = t.estado === "cerrado";
  const n = (x: unknown) => Number(x ?? 0);
  const fila = (a: string, b: string, fuerte = false) => <p className={`fila${fuerte ? " fuerte" : ""}`}><span>{a}</span><span>{b}</span></p>;
  const nombre = (x: string | null) => String(x ?? "").split(" (")[0];

  return (
    <main className="tiq" style={{ width: `${mm - 8}mm` }}>
      <style>{`
        @page { size: ${mm}mm auto; margin: 0; }
        html, body { background: #fff !important; margin: 0; }
        .tiq { margin: 0 auto; padding: 3mm 4mm 6mm; color: #000; font: ${mm === 58 ? 10.5 : 12}px/1.35 ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace; }
        .tiq p { margin: 0; } .c { text-align: center; } .b { font-weight: 700; } .g { font-size: 1.25em; }
        .tiq hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
        .fila { display: flex; justify-content: space-between; gap: 8px; } .fila span:last-child { text-align: right; white-space: nowrap; }
        .fuerte { font-weight: 700; font-size: 1.15em; }
        .barra { display: flex; gap: 8px; justify-content: center; margin: 10px 0; }
        .barra button { font: 600 14px system-ui; padding: 8px 14px; border-radius: 8px; border: 1px solid #000; background: #fff; cursor: pointer; }
        @media print { .barra { display: none; } }
      `}</style>
      <div className="barra"><AutoImprimir auto={auto === "1"} /></div>
      <p className="c b g">{t.nombre_comercial || t.razon_social}</p>
      <p className="c">NIT {t.nit}{t.dv ? `-${t.dv}` : ""}</p>
      <hr />
      <p className="c b g">{cerrado ? "CIERRE DE TURNO" : "CORTE PARCIAL (turno abierto)"}</p>
      {fila("Caja", t.caja)}
      {fila("Apertura", t.abre_txt)}
      {fila("Abrió", nombre(t.abre_nombre))}
      {fila(cerrado ? "Cierre" : "Corte", t.cierra_txt)}
      {cerrado && fila("Cerró", nombre(t.cierra_nombre))}
      <hr />
      {fila("Ventas", `${r.n_ventas}`)}
      {fila("Total vendido", pesos(n(r.ventas)), true)}
      {fila("IVA incluido", pesos(n(r.iva)))}
      {r.anuladas > 0 && fila("Ventas anuladas", `${r.anuladas}`)}
      {n(r.devoluciones) > 0 && <>{fila(`Devoluciones (${r.n_devoluciones})`, "−" + pesos(n(r.devoluciones)))}{fila("Ventas netas", pesos(n(r.ventas_netas)), true)}</>}
      <hr />
      <p className="b">Por medio de pago</p>
      {Object.entries(r.medios ?? {}).map(([m, v]) => <div key={m}>{fila(MEDIO[m] ?? m, pesos(n(v)))}</div>)}
      {n(r.credito) > 0 && fila("A crédito", pesos(n(r.credito)))}
      <hr />
      <p className="b">Efectivo</p>
      {fila("Base", pesos(n(r.base)))}
      {fila("+ Ventas en efectivo", pesos(n(r.efectivo_ventas)))}
      {n(r.abonos_efectivo) > 0 && fila("+ Abonos de cartera", pesos(n(r.abonos_efectivo)))}
      {fila("+ Entradas", pesos(n(r.ingresos)))}
      {fila("− Salidas", pesos(n(r.egresos)))}
      {n(r.devoluciones_efectivo) > 0 && fila("− Devoluciones en efectivo", pesos(n(r.devoluciones_efectivo)))}
      {fila("= Esperado en caja", pesos(n(r.efectivo_esperado)), true)}
      {cerrado && <>
        {fila("Dinero contado", pesos(n(t.efectivo_contado)), true)}
        {fila(n(t.diferencia) < 0 ? "FALTANTE" : n(t.diferencia) > 0 ? "SOBRANTE" : "Diferencia", pesos(Math.abs(n(t.diferencia))), true)}
      </>}
      {movs.length > 0 && <>
        <hr />
        <p className="b">Entradas y salidas</p>
        {movs.map((m, i) => <div key={i}>{fila(`${m.tipo === "egreso" ? "−" : "+"} ${m.concepto}`, pesos(m.valor))}</div>)}
      </>}
      {t.observaciones && <><hr /><p>Obs.: {t.observaciones}</p></>}
      <hr />
      {cerrado && <><p style={{ marginTop: 18 }}>Firma cajero(a): ____________________</p><p style={{ marginTop: 14 }}>Firma recibe: ______________________</p></>}
      <p className="c" style={{ marginTop: 8, fontSize: ".85em" }}>Regenta</p>
    </main>
  );
}
