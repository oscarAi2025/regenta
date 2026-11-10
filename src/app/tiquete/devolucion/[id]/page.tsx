import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion, puede } from "@/lib/sesion";
import { MEDIO, pesos, presentacionTexto } from "@/lib/formato";
import { AutoImprimir } from "../../[id]/AutoImprimir";

// Comprobante de devolución para la impresora térmica: qué se devolvió, cuánto se reembolsó y la nota crédito.
export const metadata: Metadata = { title: "Comprobante de devolución", robots: { index: false, follow: false } };

export default async function ComprobanteDevolucion({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ancho?: string; auto?: string }> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puede.vender(s.rol)) redirect("/inicio?aviso=permiso");
  const { id } = await params;
  const { ancho = "80", auto } = await searchParams;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) notFound();
  const mm = ancho === "58" ? 58 : 80;

  const d = await comoUsuario(s, async (c) => {
    const x = (await c.query(
      `select d.*, to_char(d.creado at time zone 'America/Bogota', 'DD/MM/YYYY HH24:MI') fecha, v.prefijo vprefijo, v.numero vnumero, v.condicion,
              e.razon_social, e.nombre_comercial, e.nit, e.dv, m.nombre quien,
              (select dd.prefijo || dd.numero from documentos_dian dd where dd.devolucion_id = d.id) nota, (select dd.cufe from documentos_dian dd where dd.devolucion_id = d.id) cude
       from devoluciones d join ventas v on v.id = d.venta_id join empresas e on e.id = d.empresa_id
       left join miembros m on m.empresa_id = d.empresa_id and m.user_id = d.usuario_id
       where d.id = $1 and d.empresa_id = $2`, [id, s.empresa])).rows[0];
    if (!x) return null;
    const lineas = (await c.query(`select vl.descripcion, vl.presentacion, sum(dl.cantidad)::float cantidad, sum(dl.total)::float total, (select p.unidades_por_caja from productos p where p.id = vl.producto_id) upc
      from devolucion_lineas dl join venta_lineas vl on vl.id = dl.venta_linea_id where dl.devolucion_id = $1 group by vl.descripcion, vl.presentacion, vl.producto_id order by min(dl.id)`, [id])).rows;
    return { x, lineas };
  });
  if (!d) notFound();
  const { x, lineas } = d;
  const fila = (a: string, b: string, fuerte = false) => <p className={`fila${fuerte ? " fuerte" : ""}`}><span>{a}</span><span>{b}</span></p>;

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
      <p className="c b g">{x.nombre_comercial || x.razon_social}</p>
      <p className="c">NIT {x.nit}{x.dv ? `-${x.dv}` : ""}</p>
      <hr />
      <p className="c b g">DEVOLUCIÓN</p>
      {fila("Venta", `${x.vprefijo}${x.vnumero}`)}
      {fila("Fecha", x.fecha)}
      {x.quien && fila("Atendió", String(x.quien).split(" (")[0])}
      {x.nota && fila("Nota crédito", x.nota)}
      <hr />
      {lineas.map((l, i) => (
        <div key={i}><p>{l.descripcion}</p>{fila(`${l.cantidad} ${presentacionTexto(l.presentacion, l.upc)}`, pesos(l.total))}</div>
      ))}
      <hr />
      {fila("Total devuelto", pesos(Number(x.total)), true)}
      {Number(x.a_saldo) > 0 && fila("Descontado del saldo", pesos(Number(x.a_saldo)))}
      {Number(x.reembolso) > 0 && fila(`Reembolso (${(MEDIO[x.medio] ?? x.medio).toLowerCase()})`, pesos(Number(x.reembolso)), true)}
      <p style={{ marginTop: 6 }}>Motivo: {x.motivo}</p>
      {x.cude && <p style={{ marginTop: 6, fontSize: ".8em", wordBreak: "break-all" }}>CUDE {x.cude}</p>}
      <hr />
      <p style={{ marginTop: 18 }}>Firma cliente: ______________________</p>
      <p className="c" style={{ marginTop: 8, fontSize: ".85em" }}>Regenta</p>
    </main>
  );
}
