import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import QRCode from "qrcode";
import { comoUsuario } from "@/lib/db";
import { leerSesion, puede } from "@/lib/sesion";
import { MEDIO, pesos } from "@/lib/formato";
import { AutoImprimir } from "./AutoImprimir";

// Tirilla para impresora térmica (80 o 58 mm). Página sin el marco de la aplicación: se abre en un iframe oculto desde
// la caja (impresión automática) o con el botón «Imprimir» de la venta. Contenido según el art. 19 y el numeral 1 del
// art. 20 de la Resolución DIAN 165 de 2023 (denominación, emisor, numeración autorizada, IVA por tarifa, fabricante del
// software, CUDE y QR) más lo útil en el mostrador (cajero, caja, medios de pago y cambio).
export const metadata: Metadata = { title: "Tiquete", robots: { index: false, follow: false } };

const FABRICANTE = { software: "Regenta", nombre: "IA DEV INVESTIMENTS COLOMBIA S.A.S.", nit: "901.845.370-5" };
const NOMBRE_DOC = { pos: "Documento equivalente electrónico tiquete de máquina registradora con sistema P.O.S.", factura: "Factura electrónica de venta" } as const;

export default async function Tiquete({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ancho?: string; auto?: string }> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puede.vender(s.rol)) redirect("/inicio?aviso=permiso");
  const { id } = await params;
  const { ancho = "80", auto } = await searchParams;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const mm = ancho === "58" ? 58 : 80;

  const d = await comoUsuario(s, async (c) => {
    const v = (await c.query(
      `select v.*, to_char(v.creado at time zone 'America/Bogota', 'DD/MM/YYYY HH24:MI:SS') fecha, m.nombre cajero, cj.nombre caja,
              e.razon_social, e.nombre_comercial, e.nit, e.dv, e.direccion, e.ciudad, e.telefono, e.responsable_iva,
              cl.nombre cliente, cl.tipo_doc cli_tipo, cl.numero_doc cli_num, cl.dv cli_dv, to_char(v.vence_pago, 'DD/MM/YYYY') vence
       from ventas v join empresas e on e.id = v.empresa_id join cajas cj on cj.id = v.caja_id
       left join clientes cl on cl.id = v.cliente_id left join miembros m on m.empresa_id = v.empresa_id and m.user_id = v.usuario_id
       where v.id = $1 and v.empresa_id = $2`, [id, s.empresa])).rows[0];
    if (!v) return null;
    const res = (await c.query(
      `select numero_resolucion, desde, hasta, to_char(vigente_desde, 'DD/MM/YYYY') vd, to_char(vigente_hasta, 'DD/MM/YYYY') vh, pruebas
       from resoluciones_dian where empresa_id = $1 and tipo = $2 and prefijo = $3 and $4::bigint between desde and hasta order by activa desc limit 1`, [s.empresa, v.tipo_doc, v.prefijo, v.numero])).rows[0];
    const lineas = (await c.query(
      `select vl.descripcion, vl.presentacion, coalesce(p.ean, left(p.id::text, 8)) codigo, sum(vl.cantidad)::float cantidad, vl.precio::float precio,
              sum(vl.total)::float total, vl.iva_pct::float iva_pct, sum(vl.base)::float base, sum(vl.iva)::float iva, sum(vl.descuento)::float descuento, max(vl.descuento_pct)::float descuento_pct
       from venta_lineas vl join productos p on p.id = vl.producto_id where vl.venta_id = $1
       group by vl.descripcion, vl.presentacion, vl.precio, vl.iva_pct, vl.producto_id, p.ean, p.id order by min(vl.id)`, [id])).rows;
    const pagos = (await c.query(`select medio, valor::float from pagos where venta_id = $1 order by id`, [id])).rows;
    const doc = (await c.query(`select estado, cufe, qr, simulado from documentos_dian where venta_id = $1 and tipo <> 'nota_credito'`, [id])).rows[0];
    return { v, res, lineas, pagos, doc };
  });
  if (!d) notFound();
  const { v, res, lineas, pagos, doc } = d;

  // IVA discriminado por tarifa (requisito del art. 19, num. 3).
  const tarifas = new Map<number, { base: number; iva: number }>();
  for (const l of lineas) { const t = tarifas.get(l.iva_pct) ?? { base: 0, iva: 0 }; t.base += l.base; t.iva += l.iva; tarifas.set(l.iva_pct, t); }
  const qr = doc?.qr && /^https?:\/\//.test(doc.qr) ? await QRCode.toString(doc.qr, { type: "svg", margin: 0, errorCorrectionLevel: "M" }) : null;
  const doble = (a: string, b: string, fuerte = false) => <p className={`fila${fuerte ? " fuerte" : ""}`}><span>{a}</span><span>{b}</span></p>;

  return (
    <main className="tiq" style={{ width: `${mm - 8}mm` }}>
      <style>{`
        @page { size: ${mm}mm auto; margin: 0; }
        html, body { background: #fff !important; margin: 0; }
        .tiq { margin: 0 auto; padding: 3mm 4mm 6mm; color: #000; font: ${mm === 58 ? 10.5 : 12}px/1.35 ui-monospace, "Cascadia Mono", Menlo, Consolas, monospace; }
        .tiq p { margin: 0; } .c { text-align: center; } .b { font-weight: 700; } .g { font-size: 1.25em; }
        .tiq hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
        .fila { display: flex; justify-content: space-between; gap: 8px; } .fila span:last-child { text-align: right; white-space: nowrap; }
        .fuerte { font-weight: 700; font-size: 1.2em; } .peq { font-size: .85em; } .clave { font-size: .85em; word-break: break-all; }
        .qr svg { width: ${mm === 58 ? 30 : 36}mm; height: auto; display: block; margin: 6px auto; }
        .barra { display: flex; gap: 8px; justify-content: center; margin: 10px 0; }
        .barra button { font: 600 14px system-ui; padding: 8px 14px; border-radius: 8px; border: 1px solid #000; background: #fff; cursor: pointer; }
        @media print { .barra { display: none; } }
      `}</style>
      <div className="barra"><AutoImprimir auto={auto === "1"} /></div>

      <p className="c b g">{v.nombre_comercial || v.razon_social}</p>
      {v.nombre_comercial && <p className="c">{v.razon_social}</p>}
      <p className="c">NIT {v.nit}{v.dv ? `-${v.dv}` : ""}</p>
      <p className="c">{v.responsable_iva ? "Responsable de IVA" : "No responsable de IVA"}</p>
      {(v.direccion || v.ciudad) && <p className="c">{[v.direccion, v.ciudad].filter(Boolean).join(", ")}</p>}
      {v.telefono && <p className="c">Tel. {v.telefono}</p>}
      <hr />
      <p className="c b">{NOMBRE_DOC[v.tipo_doc as "pos" | "factura"]}</p>
      <p className="c b g">No. {v.prefijo}{v.numero}</p>
      {res && <p className="c peq">
        {res.pruebas ? "Numeración de PRUEBAS (habilitación DIAN). " : ""}
        Resolución DIAN {res.numero_resolucion ?? "—"}{res.vd ? ` del ${res.vd}` : ""} · prefijo {v.prefijo} del {res.desde} al {res.hasta}{res.vh ? ` · vigente hasta ${res.vh}` : ""}
      </p>}
      <hr />
      {doble("Fecha", v.fecha)}
      {doble("Caja", v.caja)}
      {doble("Cajero(a)", String(v.cajero ?? "").split(" (")[0])}
      {v.cliente
        ? <p>Cliente: {v.cliente} · {v.cli_tipo} {v.cli_num}{v.cli_dv ? `-${v.cli_dv}` : ""}</p>
        : <p>Cliente: Consumidor final · 222222222222</p>}
      {v.condicion === "credito" && <p>Forma de pago: crédito a {v.plazo_dias} días · vence {v.vence}</p>}
      <hr />
      {lineas.map((l, i) => (
        <div key={i} style={{ marginBottom: 4 }}>
          <p>{l.descripcion}</p>
          {doble(`${l.cantidad} ${l.presentacion === "caja" ? "caja" : "und"} x ${pesos(l.precio)}${l.iva_pct ? ` IVA${l.iva_pct}%` : " Excl."}`, pesos(l.total + l.descuento))}
          {l.descuento > 0 && doble(`  Descuento ${l.descuento_pct}%`, `−${pesos(l.descuento)}`)}
          <p className="peq">Cód. {l.codigo}</p>
        </div>
      ))}
      <hr />
      {[...tarifas].sort((a, b) => b[0] - a[0]).map(([pct, t]) => (
        <div key={pct}>
          {pct > 0 ? <>{doble(`Base gravada ${pct}%`, pesos(t.base))}{doble(`IVA ${pct}%`, pesos(t.iva))}</> : doble(v.responsable_iva ? "Excluido / exento" : "Total sin IVA (no responsable)", pesos(t.base))}
        </div>
      ))}
      {lineas.some((l) => l.descuento > 0) && doble("Ahorro total", pesos(lineas.reduce((a, l) => a + l.descuento, 0)))}
      {doble("TOTAL", pesos(v.total), true)}
      <hr />
      {pagos.map((p, i) => <div key={i}>{doble(MEDIO[p.medio] ?? p.medio, pesos(p.valor))}</div>)}
      {Number(v.cambio) > 0 && doble("Cambio", pesos(v.cambio), true)}
      <hr />
      {doc?.cufe
        ? <>
            {doc.estado === "aceptado" && !doc.simulado && <p className="c b">Documento validado por la DIAN</p>}
            {doc.simulado && <p className="c b">EMISIÓN SIMULADA · SIN VALIDEZ FISCAL</p>}
            <p className="clave">{v.tipo_doc === "pos" ? "CUDE" : "CUFE"}: {doc.cufe}</p>
            {qr && <div className="qr" dangerouslySetInnerHTML={{ __html: qr }} />}
          </>
        : <p className="c">Pendiente de validación DIAN. Puede reimprimir este documento desde Ventas.</p>}
      {v.estado === "anulada" && <p className="c b g">ANULADA</p>}
      <hr />
      <p className="c peq">Software: {FABRICANTE.software} · Fabricante: {FABRICANTE.nombre} · NIT {FABRICANTE.nit}</p>
      <p className="c">¡Gracias por su compra!</p>
    </main>
  );
}
