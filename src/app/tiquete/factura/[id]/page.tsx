import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import QRCode from "qrcode";
import { comoUsuario } from "@/lib/db";
import { leerSesion, puede } from "@/lib/sesion";
import { MEDIO, pesos, presentacionTexto } from "@/lib/formato";
import { pesosEnLetras } from "@/lib/letras";
import { consultaDian } from "@/lib/documentos";
import { AutoImprimir } from "../../[id]/AutoImprimir";

// Factura en tamaño carta: la representación gráfica completa para entregar a empresas y droguerías (la tirilla de 80 mm
// sigue para el mostrador). Mismo contenido legal que la tirilla (art. 11 de la Resolución DIAN 165 de 2023 para la
// factura y art. 19 para el documento POS: emisor, adquirente, numeración autorizada, IVA por tarifa, CUFE/CUDE, QR,
// fabricante del software) más lo que pide una compra entre empresas: logo, datos completos del cliente, lote y
// vencimiento de cada producto, forma de pago y vencimiento, y el valor en letras.
export const metadata: Metadata = { title: "Factura", robots: { index: false, follow: false } };

const FABRICANTE = { software: "Regenta", nombre: "IA DEV INVESTIMENTS COLOMBIA S.A.S.", nit: "901.845.370-5" };
const TITULO = { pos: "Documento equivalente electrónico P.O.S.", factura: "Factura electrónica de venta" } as const;
const TIPO_DOC: Record<string, string> = { CC: "C.C.", NIT: "NIT", CE: "C.E.", PP: "Pasaporte", PA: "Pasaporte", TI: "T.I.", PEP: "PEP", PPT: "PPT", RC: "R.C.", DIE: "Doc. extranjero", NUIP: "NUIP" };
const fechaLarga = (d: string) => new Date(d + "T00:00:00").toLocaleDateString("es-CO", { day: "2-digit", month: "2-digit", year: "numeric" });

export default async function Factura({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ auto?: string }> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puede.vender(s.rol)) redirect("/inicio?aviso=permiso");
  const { id } = await params;
  const { auto } = await searchParams;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(id)) notFound();

  const d = await comoUsuario(s, async (c) => {
    const v = (await c.query(
      `select v.*, to_char(v.creado at time zone 'America/Bogota', 'DD/MM/YYYY') fecha, to_char(v.creado at time zone 'America/Bogota', 'HH24:MI:SS') hora,
              m.nombre vendedor, cj.nombre caja, e.razon_social, e.nombre_comercial, e.nit, e.dv, e.direccion, e.ciudad, e.telefono, e.email, e.responsable_iva, e.logo, e.calidades_tributarias,
              cl.nombre cliente, cl.tipo_doc cli_tipo, cl.numero_doc cli_num, cl.dv cli_dv, cl.direccion cli_dir, cl.ciudad cli_ciudad, cl.telefono cli_tel, cl.email cli_email,
              v.vence_pago::text vence
       from ventas v join empresas e on e.id = v.empresa_id left join cajas cj on cj.id = v.caja_id
       left join clientes cl on cl.id = v.cliente_id left join miembros m on m.empresa_id = v.empresa_id and m.user_id = v.usuario_id
       where v.id = $1 and v.empresa_id = $2 and v.origen is null`, [id, s.empresa])).rows[0];
    if (!v) return null;
    const res = (await c.query(
      `select numero_resolucion, desde, hasta, to_char(vigente_desde, 'DD/MM/YYYY') vd, to_char(vigente_hasta, 'DD/MM/YYYY') vh, pruebas
       from resoluciones_dian where empresa_id = $1 and tipo = $2 and prefijo = $3 and $4::bigint between desde and hasta order by activa desc limit 1`, [s.empresa, v.tipo_doc, v.prefijo, v.numero])).rows[0];
    // Una fila por producto vendido (como se cobró); los lotes de donde salió van dentro de la fila con sus unidades.
    const lineas = (await c.query(
      `select vl.descripcion, vl.presentacion, coalesce(p.ean, left(p.id::text, 8)) codigo, p.laboratorio,
              sum(vl.cantidad)::float cantidad, vl.precio::float precio, sum(vl.total)::float total, vl.iva_pct::float iva_pct, sum(vl.base)::float base,
              sum(vl.iva)::float iva, sum(vl.descuento)::float descuento, vl.descuento_pct::float descuento_pct, max(p.unidades_por_caja) upc,
              json_agg(json_build_object('lote', l.lote, 'vence', to_char(l.vence, 'DD/MM/YYYY'), 'unidades', vl.unidades,
                -- Si el lote se corrigió después de la venta, lo que decía al vender (para rastrear un retiro del INVIMA).
                'original', (select jsonb_build_object('lote', a.datos -> 'antes' ->> 'lote', 'vence', to_char((a.datos -> 'antes' ->> 'vence')::date, 'DD/MM/YYYY'))
                  from auditoria a where a.empresa_id = vl.empresa_id and a.entidad = 'lotes' and a.entidad_id = l.id::text
                    and a.accion in ('corregir_lote', 'lote_vencido_reactivado') and a.creado > (select creado from ventas where id = vl.venta_id) order by a.id limit 1)
              ) order by l.vence, l.lote) lotes
       from venta_lineas vl join productos p on p.id = vl.producto_id join lotes l on l.id = vl.lote_id where vl.venta_id = $1
       group by vl.descripcion, vl.presentacion, vl.precio, vl.iva_pct, vl.descuento_pct, vl.producto_id, p.ean, p.id, p.laboratorio order by min(vl.id)`, [id])).rows as
      { descripcion: string; presentacion: string; codigo: string; laboratorio: string | null; cantidad: number; precio: number; total: number; iva_pct: number; base: number;
        iva: number; descuento: number; descuento_pct: number; upc: number; lotes: { lote: string; vence: string | null; unidades: number; original: { lote: string; vence: string | null } | null }[] }[];
    const pagos = (await c.query(`select medio, valor::float from pagos where venta_id = $1 order by id`, [id])).rows;
    const doc = (await c.query(`select estado, cufe, qr, simulado, case when estado = 'aceptado' then to_char(actualizado at time zone 'America/Bogota', 'DD/MM/YYYY HH24:MI:SS') end validado
      from documentos_dian where venta_id = $1 and tipo <> 'nota_credito'`, [id])).rows[0];
    return { v, res, lineas, pagos, doc };
  });
  if (!d) notFound();
  const { v, res, lineas, pagos, doc } = d;

  const tarifas = new Map<number, { base: number; iva: number }>();
  for (const l of lineas) { const t = tarifas.get(l.iva_pct) ?? { base: 0, iva: 0 }; t.base += l.base; t.iva += l.iva; tarifas.set(l.iva_pct, t); }
  const bruto = lineas.reduce((a, l) => a + l.total + l.descuento, 0); // con IVA, antes de descuentos (como el precio de venta)
  const descuentos = lineas.reduce((a, l) => a + l.descuento, 0);
  const ivaTotal = Math.round(lineas.reduce((a, l) => a + l.iva, 0));
  // IVA por tarifa redondeado a pesos de forma que la suma de las tarifas dé exactamente el total (el peso de diferencia
  // del redondeo va a la tarifa con más IVA).
  const ivaPor = new Map([...tarifas].map(([k, t]) => [k, Math.round(t.iva)]));
  const mayor = [...tarifas].sort((a, b) => b[1].iva - a[1].iva)[0]?.[0];
  if (mayor !== undefined) ivaPor.set(mayor, (ivaPor.get(mayor) ?? 0) + ivaTotal - [...ivaPor.values()].reduce((a, b) => a + b, 0));
  const cantidadTotal = lineas.reduce((a, l) => a + l.cantidad, 0);
  // El QR lleva a la consulta de la DIAN: el que devolvió el emisor o, con el CUFE/CUDE, el enlace de consulta.
  const enlaceQr = doc?.qr && /^https?:\/\//.test(doc.qr) ? doc.qr : doc?.cufe && !doc.simulado ? consultaDian(doc.cufe) : null;
  const qr = enlaceQr ? await QRCode.toString(enlaceQr, { type: "svg", margin: 0, errorCorrectionLevel: "M" }) : null;
  // El régimen que muestra la factura es el de la venta: si cobró IVA, la droguería lo era al vender (el dato de la empresa pudo cambiar después).
  const responsable = Number(v.iva) > 0 || !!v.responsable_iva;
  const nombre = v.nombre_comercial || v.razon_social;
  const credito = v.condicion === "credito";
  const tipo = v.tipo_doc as "pos" | "factura";

  return (
    <main className="fac">
      <style>{`
        @page { size: letter; margin: 12mm 12mm 14mm; }
        html, body { background: #fff !important; margin: 0; }
        .fac { -webkit-print-color-adjust: exact; print-color-adjust: exact; --tinta: #10233a; --linea: #c9d2dc; --suave: #f1f4f7; max-width: 196mm; margin: 0 auto; padding: 8mm 0 12mm; color: #111; font: 10px/1.4 "Helvetica Neue", Helvetica, Arial, sans-serif; }
        .fac p { margin: 0; } .fac h1, .fac h2 { margin: 0; }
        .barra { display: flex; gap: 8px; justify-content: center; margin-bottom: 14px; }
        .barra button { font: 600 14px system-ui; padding: 8px 14px; border-radius: 8px; border: 1px solid #000; background: #fff; cursor: pointer; }
        @media print { .barra { display: none; } .fac { padding: 0; max-width: none; } }
        .cab { display: grid; grid-template-columns: minmax(0, 1fr) 64mm; gap: 6mm; align-items: stretch; }
        .emisor { display: flex; gap: 4mm; align-items: center; }
        .emisor img { max-height: 24mm; max-width: 62mm; object-fit: contain; }
        .emisor .nom { font-size: 15px; font-weight: 700; color: var(--tinta); line-height: 1.2; }
        .emisor .dato { color: #333; }
        .numero { border: 1.5px solid var(--tinta); border-radius: 3mm; overflow: hidden; display: flex; flex-direction: column; }
        .numero .t { background: var(--tinta); color: #fff; font-weight: 700; text-align: center; padding: 2mm 3mm; font-size: 10.5px; text-transform: uppercase; letter-spacing: .03em; }
        .numero .n { text-align: center; font-size: 19px; font-weight: 700; color: var(--tinta); padding: 2.5mm 2mm 1mm; }
        .numero .r { text-align: center; font-size: 8px; color: #444; padding: 0 3mm 2.5mm; }
        .bloques { display: grid; grid-template-columns: minmax(0, 1.4fr) minmax(0, 1fr); gap: 4mm; margin-top: 4mm; }
        .caja { border: 1px solid var(--linea); border-radius: 2mm; padding: 2.5mm 3mm; }
        .caja h2 { font-size: 8.5px; text-transform: uppercase; letter-spacing: .06em; color: var(--tinta); margin-bottom: 1.5mm; }
        .kv { display: grid; grid-template-columns: auto minmax(0, 1fr); column-gap: 3mm; row-gap: .6mm; }
        .kv dt { color: #555; } .kv dd { margin: 0; font-weight: 600; overflow-wrap: anywhere; }
        table { width: 100%; border-collapse: collapse; margin-top: 4mm; }
        thead th { background: var(--tinta); color: #fff; font-size: 8.5px; text-transform: uppercase; letter-spacing: .03em; padding: 1.8mm 1.5mm; text-align: left; font-weight: 700; }
        tbody td { padding: 1.1mm 1.5mm; border-bottom: 1px solid var(--linea); vertical-align: top; }
        tbody tr:nth-child(even) td { background: var(--suave); }
        .num { text-align: right; white-space: nowrap; font-variant-numeric: tabular-nums; }
        .desc b { display: block; font-weight: 600; } .desc span { color: #555; font-size: 8px; } .lotes span { display: block; white-space: nowrap; font-size: 8.5px; } .lotes .corr { display: block; font-size: 7.5px; color: #8a5a00; font-style: normal; white-space: normal; }
        thead { display: table-header-group; } tr { break-inside: avoid; }
        .pie { display: grid; grid-template-columns: minmax(0, 1fr) 70mm; gap: 5mm; margin-top: 4mm; break-inside: avoid; }
        .totales { border: 1px solid var(--linea); border-radius: 2mm; overflow: hidden; }
        .totales .f { display: flex; justify-content: space-between; padding: 1.4mm 3mm; border-bottom: 1px solid var(--linea); }
        .totales .f:last-child { border-bottom: 0; background: var(--tinta); color: #fff; font-weight: 700; font-size: 13px; padding: 2.5mm 3mm; }
        .letras { margin-top: 2mm; font-style: italic; }
        .dian { display: grid; grid-template-columns: 26mm minmax(0, 1fr); gap: 4mm; align-items: center; margin-top: 4mm; border-top: 1px solid var(--linea); padding-top: 3mm; break-inside: avoid; }
        .dian svg { width: 26mm; height: 26mm; display: block; }
        .clave { font-family: ui-monospace, Menlo, Consolas, monospace; font-size: 8px; overflow-wrap: anywhere; }
        .legal { margin-top: 6mm; font-size: 8px; color: #444; text-align: center; }
        .sinqr { width: 26mm; height: 26mm; border: 1px dashed var(--linea); display: grid; place-items: center; text-align: center; font-size: 7.5px; color: #666; padding: 2mm; }
        .piepag { display: none; }
        @media print { .piepag { display: block; position: fixed; bottom: 0; left: 0; right: 0; font-size: 7.5px; color: #555; text-align: right; } }
        .sello { display: inline-block; border: 2px solid #b00020; color: #b00020; font-weight: 700; font-size: 16px; padding: 1mm 4mm; transform: rotate(-4deg); }
        .aviso { border: 1px solid #b00020; color: #b00020; font-weight: 700; padding: 2mm 3mm; border-radius: 2mm; text-align: center; margin-top: 3mm; }
        .firma { margin-top: 8mm; break-inside: avoid; display: grid; grid-template-columns: 1fr 1fr; gap: 10mm; }
        .firma div { border-top: 1px solid #555; padding-top: 1mm; text-align: center; color: #444; }
      `}</style>
      <div className="barra"><AutoImprimir auto={auto === "1"} /></div>

      <header className="cab">
        <div className="emisor">
          {v.logo && /^data:image\/(png|jpeg|webp);base64,/.test(v.logo) && <img src={v.logo} alt={`Logo de ${nombre}`} />}
          <div>
            <h1 className="nom">{nombre}</h1>
            {v.nombre_comercial && <p className="dato">{v.razon_social}</p>}
            <p className="dato">NIT {v.nit}{v.dv ? `-${v.dv}` : ""} · {responsable ? "Responsable de IVA" : "No responsable de IVA"}</p>
            {v.calidades_tributarias && <p className="dato">{v.calidades_tributarias}</p>}
            {(v.direccion || v.ciudad) && <p className="dato">{[v.direccion, v.ciudad].filter(Boolean).join(" · ")}</p>}
            {(v.telefono || v.email) && <p className="dato">{[v.telefono ? `Tel. ${v.telefono}` : "", v.email].filter(Boolean).join(" · ")}</p>}
          </div>
        </div>
        <div className="numero">
          <p className="t">{TITULO[tipo]}</p>
          <p className="n">No. {v.prefijo}{v.numero}</p>
          {res && <p className="r">{res.pruebas ? "Numeración de PRUEBAS (habilitación DIAN) · " : ""}{res.numero_resolucion ? `Resolución DIAN ${res.numero_resolucion}${res.vd ? ` del ${res.vd}` : ""}` : "Sin resolución de numeración cargada"}<br />Prefijo {v.prefijo} del {res.desde} al {res.hasta}{res.vh ? ` · vigente hasta ${res.vh}` : ""}</p>}
        </div>
      </header>

      <section className="bloques">
        <div className="caja">
          <h2>Cliente</h2>
          {v.cliente ? (
            <dl className="kv">
              <dt>Nombre</dt><dd>{v.cliente}</dd>
              <dt>{TIPO_DOC[v.cli_tipo] ?? v.cli_tipo}</dt><dd>{v.cli_num}{v.cli_dv ? `-${v.cli_dv}` : ""}</dd>
              {(v.cli_dir || v.cli_ciudad) && <><dt>Dirección</dt><dd>{[v.cli_dir, v.cli_ciudad].filter(Boolean).join(" · ")}</dd></>}
              {v.cli_tel && <><dt>Teléfono</dt><dd>{v.cli_tel}</dd></>}
              {v.cli_email && <><dt>Correo</dt><dd>{v.cli_email}</dd></>}
            </dl>
          ) : <dl className="kv"><dt>Nombre</dt><dd>Consumidor final</dd><dt>C.C.</dt><dd>222222222222</dd></dl>}
        </div>
        <div className="caja">
          <h2>Venta</h2>
          <dl className="kv">
            <dt>Generada</dt><dd>{v.fecha} {v.hora}</dd>
            {doc?.validado && !doc.simulado && <><dt>Validada DIAN</dt><dd>{doc.validado}</dd></>}
            <dt>Forma de pago</dt><dd>{credito ? `Crédito a ${v.plazo_dias} días` : "Contado"}</dd>
            {credito && v.vence && <><dt>Vence</dt><dd>{fechaLarga(v.vence)}</dd></>}
            {!credito && pagos.length > 0 && <><dt>Medio de pago</dt><dd>{pagos.map((p) => MEDIO[p.medio] ?? p.medio).join(", ")}</dd></>}
            {v.vendedor && <><dt>Atendió</dt><dd>{String(v.vendedor).split(" (")[0]}</dd></>}
            {v.caja && <><dt>Caja</dt><dd>{v.caja}</dd></>}
          </dl>
        </div>
      </section>

      <table>
        <thead>
          <tr>
            <th style={{ width: "3%" }}>#</th><th style={{ width: "12%" }}>Código</th><th>Descripción</th><th style={{ width: "16%" }}>Lote · vence</th>
            <th className="num" style={{ width: "7%" }}>Cant.</th><th className="num" style={{ width: "11%" }}>Precio unit. IVA incl.</th><th className="num" style={{ width: "7%" }}>Desc.</th>
            <th className="num" style={{ width: "6%" }}>IVA</th><th className="num" style={{ width: "12%" }}>Total</th>
          </tr>
        </thead>
        <tbody>
          {lineas.map((l, i) => (
            <tr key={i}>
              <td>{i + 1}</td>
              <td className="clave" style={{ fontSize: 8, whiteSpace: "nowrap" }}>{l.codigo}</td>
              <td className="desc"><b>{l.descripcion}</b><span>{presentacionTexto(l.presentacion, l.upc)}{l.laboratorio ? ` · ${l.laboratorio}` : ""}</span></td>
              <td className="lotes">{l.lotes.map((x, j) => <span key={j}>{x.lote} · {x.vence ?? "s. f."}{l.lotes.length > 1 ? ` · ${x.unidades} und` : ""}
                {x.original && <em className="corr">corregido; al vender: {x.original.lote} · {x.original.vence ?? "s. f."}</em>}</span>)}</td>
              <td className="num">{l.cantidad.toLocaleString("es-CO")}</td>
              <td className="num">{pesos(l.precio)}</td>
              <td className="num">{l.descuento > 0 ? `${l.descuento_pct.toLocaleString("es-CO", { maximumFractionDigits: 2 })} %` : "—"}</td>
              <td className="num">{l.iva_pct ? `${l.iva_pct}%` : "Excl."}</td>
              <td className="num"><b>{pesos(l.total)}</b></td>
            </tr>
          ))}
        </tbody>
      </table>

      <section className="pie">
        <div>
          <p><b>Valor en letras:</b></p>
          <p className="letras">{pesosEnLetras(v.total)}</p>
          <p style={{ marginTop: "3mm" }}><b>{lineas.length}</b> {lineas.length === 1 ? "producto" : "productos"} · <b>{cantidadTotal.toLocaleString("es-CO")}</b> {cantidadTotal === 1 ? "unidad" : "unidades"} de venta</p>
          {credito && <p style={{ marginTop: "2mm" }}>Esta factura se paga a más tardar el <b>{v.vence ? fechaLarga(v.vence) : "—"}</b>. Los abonos se registran con recibo de caja.</p>}
          {v.estado === "anulada" && <p style={{ marginTop: "4mm" }}><span className="sello">ANULADA</span></p>}
        </div>
        <div className="totales">
          {descuentos > 0 && <div className="f"><span>Valor antes de descuentos</span><span className="num">{pesos(bruto)}</span></div>}
          {descuentos > 0 && <div className="f"><span>Descuentos</span><span className="num">−{pesos(descuentos)}</span></div>}
          {[...tarifas].sort((a, b) => b[0] - a[0]).map(([pct, t]) => pct > 0
            ? <div className="f" key={pct}><span>Base gravada {pct}% · IVA</span><span className="num">{pesos(t.base)} · {pesos(ivaPor.get(pct) ?? t.iva)}</span></div>
            : <div className="f" key={pct}><span>{responsable ? "Excluido / exento de IVA" : "Total (no responsable de IVA)"}</span><span className="num">{pesos(t.base)}</span></div>)}
          {ivaTotal > 0 && <div className="f"><span>Total IVA</span><span className="num">{pesos(ivaTotal)}</span></div>}
          <div className="f"><span>TOTAL A PAGAR</span><span className="num">{pesos(v.total)}</span></div>
        </div>
      </section>

      {doc?.simulado && <p className="aviso">EMISIÓN SIMULADA · SIN VALIDEZ FISCAL</p>}
      <section className="dian">
        {qr ? <div dangerouslySetInnerHTML={{ __html: qr }} /> : <div className="sinqr">Sin código QR: {doc?.simulado ? "emisión simulada" : "pendiente de validación DIAN"}</div>}
        <div>
          {doc?.cufe
            ? <>
                {doc.estado === "aceptado" && !doc.simulado && <p><b>Documento validado por la DIAN</b></p>}
                <p className="clave"><b>{tipo === "pos" ? "CUDE" : "CUFE"}:</b> {doc.cufe}</p>
              </>
            : <p><b>Pendiente de validación DIAN.</b> Esta representación gráfica se completa con el {tipo === "pos" ? "CUDE" : "CUFE"} y el código QR cuando la DIAN valida el documento.</p>}
          <p style={{ marginTop: "1.5mm" }}>Representación gráfica de {tipo === "pos" ? "documento equivalente electrónico" : "factura electrónica de venta"}. {qr ? " Consúltela en la DIAN con el código QR." : ""}</p>
        </div>
      </section>

      {credito && <div className="firma"><div>Recibí conforme (nombre, firma y sello)</div><div>Fecha de recibido</div></div>}
      <p className="legal">Software: {FABRICANTE.software} · Fabricante: {FABRICANTE.nombre} · NIT {FABRICANTE.nit}</p>
      {/* Al imprimir se repite en cada hoja: así una hoja suelta se sabe de qué factura es. */}
      <p className="piepag" aria-hidden="true">{TITULO[tipo]} {v.prefijo}{v.numero} · {nombre} · NIT {v.nit}{v.dv ? `-${v.dv}` : ""}</p>
    </main>
  );
}
