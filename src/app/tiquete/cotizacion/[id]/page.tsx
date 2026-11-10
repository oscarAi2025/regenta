import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { comoUsuario } from "@/lib/db";
import { leerSesion } from "@/lib/sesion";
import { pesos } from "@/lib/formato";
import { etiquetaPedido, fechaCorta, netoLinea, puedePedidos, textoCotizacion } from "@/lib/pedidos";
import { detallePedido } from "@/lib/pedidos-servidor";
import { Barra } from "./Barra";

// Documento imprimible de un pedido, sin el marco de la aplicación:
//  · Cotización: hoja carta con los datos de la droguería, validez y «precios sujetos a cambio» (no es factura).
//  · Domicilio (y espera): rótulo para la impresora térmica (80 o 58 mm) que acompaña al domiciliario.
export const metadata: Metadata = { title: "Cotización", robots: { index: false, follow: false } };

const presentacion = (p: "caja" | "unidad", upc: number) => (p === "caja" ? (upc > 1 ? `Caja x${upc}` : "Und") : "Unidad");
const iniciales = (n: string) => n.replace(/^(droguer[ií]a|farmacia|distribuidora)\s+/i, "").split(/\s+/).filter((w) => /^[A-Za-zÁÉÍÓÚÑáéíóúñ0-9]/.test(w)).slice(0, 2).map((w) => w[0].toUpperCase()).join("") || "R";

export default async function DocumentoPedido({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ ancho?: string; auto?: string }> }) {
  const s = await leerSesion();
  if (!s) redirect("/entrar");
  if (!puedePedidos.armar(s.rol)) redirect("/inicio?aviso=permiso");
  const { id } = await params;
  const { ancho = "80", auto } = await searchParams;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id)) notFound();
  const d = await comoUsuario(s, async (c) => {
    const p = await detallePedido(c, s.empresa, id);
    const e = (await c.query(`select razon_social, nombre_comercial, nit, dv, direccion, ciudad, telefono, email from empresas where id = $1`, [s.empresa])).rows[0];
    return p && e ? { p, e } : null;
  });
  if (!d) notFound();
  const { p, e } = d;
  const nombre = e.nombre_comercial || e.razon_social;
  const hoy = new Date().toLocaleDateString("en-CA", { timeZone: "America/Bogota" });

  if (p.tipo !== "cotizacion") {
    // Rótulo del domicilio: se cobra al precio del día, así que el valor es el de hoy.
    const mm = ancho === "58" ? 58 : 80;
    const total = p.lineas.reduce((a, l) => a + netoLinea(l.presentacion === "caja" ? l.producto.precio_caja : l.producto.precio_unidad ?? l.precio_mostrado, l.cantidad, l.descuento_pct, p.descuento_pct).neto, 0);
    return (
      <main className="rot" style={{ width: `${mm - 8}mm` }}>
        <style>{`
          @page { size: ${mm}mm auto; margin: 0; }
          html, body { background: #fff !important; margin: 0; }
          .rot { margin: 0 auto; padding: 3mm 4mm 6mm; color: #000; font: ${mm === 58 ? 10.5 : 12}px/1.35 ui-monospace, Menlo, Consolas, monospace; }
          .rot p { margin: 0; } .c { text-align: center; } .b { font-weight: 700; } .g { font-size: 1.35em; }
          .rot hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
          .fila { display: flex; justify-content: space-between; gap: 8px; } .fila span:last-child { white-space: nowrap; } .peq { font-size: .85em; }
          .barra { display: flex; flex-wrap: wrap; gap: 8px; justify-content: center; margin: 10px 0; }
          .barra button, .barra a { font: 600 14px system-ui; padding: 8px 14px; border-radius: 8px; border: 1px solid #000; background: #fff; color: #000; cursor: pointer; text-decoration: none; }
          @media print { .barra { display: none; } }
        `}</style>
        <Barra auto={auto === "1"} whatsapp={null} />
        <p className="c b">{nombre}</p>
        {e.telefono && <p className="c">Tel. {e.telefono}</p>}
        <hr />
        <p className="c b g">{etiquetaPedido(p).toUpperCase()}</p>
        <p className="c">{fechaCorta(p.creado)} · {p.creado.slice(11)}{p.estado === "en_camino" ? " · en camino" : ""}</p>
        <hr />
        {p.contacto && <p className="b g">{p.contacto}</p>}
        {p.direccion && <p className="b">{p.direccion}</p>}
        {p.telefono && <p>Tel. {p.telefono}</p>}
        {p.nota && <p>Nota: {p.nota}</p>}
        <hr />
        {p.lineas.map((l) => (
          <p key={l.id}>{l.cantidad} {presentacion(l.presentacion, l.producto.unidades_por_caja).toLowerCase()} · {l.producto.nombre}</p>
        ))}
        <hr />
        <p className="fila b g"><span>Valor a cobrar</span><span>{pesos(total)}</span></p>
        <p className="peq">Precio del día; el valor final sale en la factura o tiquete al cobrar.</p>
        <hr />
        <p className="c">Recibí conforme: ____________________</p>
      </main>
    );
  }

  const lineas = p.lineas.map((l) => ({ ...l, ...netoLinea(l.precio_mostrado, l.cantidad, l.descuento_pct, p.descuento_pct) }));
  const total = lineas.reduce((a, l) => a + l.neto, 0), bruto = lineas.reduce((a, l) => a + l.bruto, 0);
  const tel = (p.telefono ?? "").replace(/\D/g, "");
  const wa = `https://wa.me/${tel.length >= 10 ? "57" + tel.slice(-10) : ""}?text=${encodeURIComponent(textoCotizacion({ empresa: nombre, numero: p.numero, vence: p.vence, contacto: p.contacto, descuento_pct: p.descuento_pct,
    lineas: p.lineas.map((l) => ({ nombre: l.producto.nombre, presentacion: l.presentacion, cantidad: l.cantidad, precio: l.precio_mostrado, descuento_pct: l.descuento_pct, upc: l.producto.unidades_por_caja })) }))}`;
  const vencida = p.estado === "vencido" || (!!p.vence && p.vence < hoy);
  return (
    <main className="cot">
      <style>{`
        @page { size: letter; margin: 14mm 12mm; }
        html, body { background: #f4f4f2; margin: 0; }
        .cot { max-width: 820px; margin: 0 auto; padding: 16px; color: #0b1f33; font: 14px/1.45 system-ui, -apple-system, "Segoe UI", sans-serif; }
        .hoja { background: #fff; border: 1px solid #ddd; border-radius: 14px; padding: 28px; }
        .cab { display: flex; flex-wrap: wrap; justify-content: space-between; gap: 16px; align-items: flex-start; }
        .marca { display: flex; gap: 12px; align-items: center; min-width: 0; }
        .logo { width: 54px; height: 54px; border-radius: 12px; background: #0b1f33; color: #fff; display: grid; place-items: center; font-weight: 800; font-size: 22px; flex: none; }
        .cot h1 { font-size: 26px; margin: 0; letter-spacing: -.01em; } .cot p { margin: 0; } .mut { color: #5b6672; } .der { text-align: right; }
        .num { font-variant-numeric: tabular-nums; }
        .tabla { width: 100%; border-collapse: collapse; margin-top: 20px; }
        .tabla th { text-align: left; font-size: 12px; color: #5b6672; border-bottom: 2px solid #0b1f33; padding: 6px 6px; }
        .tabla td { border-bottom: 1px solid #e3e3e0; padding: 8px 6px; vertical-align: top; }
        .tabla .r { text-align: right; white-space: nowrap; }
        .total { display: flex; justify-content: flex-end; margin-top: 12px; } .total div { min-width: 240px; }
        .total p { display: flex; justify-content: space-between; gap: 16px; } .grande { font-size: 22px; font-weight: 800; }
        .nota { margin-top: 20px; border: 1px solid #e3e3e0; background: #fafaf8; border-radius: 10px; padding: 12px 14px; font-size: 13px; }
        .aviso { margin-top: 12px; color: #8a4b00; font-weight: 700; }
        .barra { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 12px; }
        .barra button, .barra a { font: 600 14px system-ui; padding: 9px 14px; border-radius: 10px; border: 2px solid #0b1f33; background: #fff; color: #0b1f33; cursor: pointer; text-decoration: none; }
        .barra a[href^="https://wa.me"] { background: #0b1f33; color: #fff; }
        .scroll { overflow-x: auto; }
        @media (max-width: 600px) { .hoja { padding: 16px; } .cot h1 { font-size: 21px; } .der { text-align: left; } .tabla .oc { display: none; } }
        @media print { html, body { background: #fff; } .cot { padding: 0; max-width: none; } .hoja { border: 0; padding: 0; } .barra { display: none; } .tabla tr { break-inside: avoid; } }
      `}</style>
      <Barra auto={auto === "1"} whatsapp={vencida ? null : wa} />
      <article className="hoja" aria-label={`Cotización N.º ${p.numero}`}>
        <div className="cab">
          <div className="marca">
            <div className="logo" aria-hidden="true">{iniciales(nombre)}</div>
            <div style={{ minWidth: 0 }}>
              <p style={{ fontWeight: 800, fontSize: 18 }}>{nombre}</p>
              {e.nombre_comercial && <p className="mut">{e.razon_social}</p>}
              <p className="mut">NIT {e.nit}{e.dv ? `-${e.dv}` : ""}</p>
              {(e.direccion || e.ciudad) && <p className="mut">{[e.direccion, e.ciudad].filter(Boolean).join(", ")}</p>}
              {(e.telefono || e.email) && <p className="mut">{[e.telefono && `Tel. ${e.telefono}`, e.email].filter(Boolean).join(" · ")}</p>}
            </div>
          </div>
          <div className="der">
            <h1>Cotización N.º {String(p.numero).padStart(4, "0")}</h1>
            <p className="mut">Fecha: {fechaCorta(p.creado)}</p>
            <p><b>Válida hasta el {fechaCorta(p.vence)}</b></p>
          </div>
        </div>
        {(p.contacto || p.cliente || p.telefono) && (
          <p style={{ marginTop: 18 }}><span className="mut">Para: </span><b>{p.cliente ?? p.contacto}</b>{p.cliente && p.contacto && p.contacto !== p.cliente ? ` · ${p.contacto}` : ""}{p.telefono ? ` · Tel. ${p.telefono}` : ""}</p>
        )}
        {vencida && <p className="aviso">Esta cotización ya venció: los precios deben confirmarse de nuevo.</p>}
        <div className="scroll">
          <table className="tabla">
            <thead><tr><th scope="col">Producto</th><th scope="col" className="oc">Presentación</th><th scope="col" className="r">Cant.</th><th scope="col" className="r oc">Precio</th><th scope="col" className="r oc">Desc.</th><th scope="col" className="r">Valor</th></tr></thead>
            <tbody>
              {lineas.map((l) => (
                <tr key={l.id}>
                  <td>{l.producto.nombre}{l.producto.laboratorio ? <span className="mut"> · {l.producto.laboratorio}</span> : null}</td>
                  <td className="oc">{presentacion(l.presentacion, l.producto.unidades_por_caja)}</td>
                  <td className="r num">{l.cantidad}</td>
                  <td className="r num oc">{pesos(l.precio_mostrado)}</td>
                  <td className="r num oc">{l.descuento_pct || p.descuento_pct ? `${(100 - (100 - l.descuento_pct) * (100 - p.descuento_pct) / 100).toLocaleString("es-CO", { maximumFractionDigits: 2 })} %` : "—"}</td>
                  <td className="r num">{pesos(l.neto)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="total"><div>
          {bruto !== total && <p className="mut num"><span>Antes de descuentos</span><span>{pesos(bruto)}</span></p>}
          {bruto !== total && <p className="mut num"><span>Descuento</span><span>−{pesos(bruto - total)}</span></p>}
          <p className="grande num"><span>Total</span><span>{pesos(total)}</span></p>
          <p className="mut" style={{ fontSize: 12 }}>Precios con IVA incluido cuando aplica.</p>
        </div></div>
        <div className="nota">
          <p><b>Precios sujetos a cambio y a disponibilidad.</b> Esta cotización no aparta productos ni es una factura. Al comprar se cobra el precio vigente ese día y se entrega el documento electrónico de venta.</p>
          {p.nota && <p style={{ marginTop: 6 }}>Nota: {p.nota}</p>}
        </div>
        <p className="mut" style={{ marginTop: 14, fontSize: 12 }}>Elaborada por {p.creado_por ?? nombre} · {etiquetaPedido(p)}</p>
      </article>
    </main>
  );
}
