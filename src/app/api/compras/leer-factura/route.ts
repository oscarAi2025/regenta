import { createHash } from "node:crypto";
import { comoUsuario } from "@/lib/db";
import { conSesion, ipCliente, json, limiteBD } from "@/lib/api";
import { puedeCompras } from "@/lib/compras";
import { aplicarLotes, leerArchivoXml, pdfDelZip, type DocumentoLeido } from "@/lib/factura-proveedor";
import { emparejar, proveedorDeFactura } from "@/lib/factura-proveedor-servidor";
import { iaActiva, mensajeError as mensajeIA } from "@/lib/ia/claude";
import { leerFacturaConIA, leerLotesDelPdf, NoEsFactura } from "@/lib/ia/factura";

// Nueva compra → «Cargar desde la factura»: ZIP/XML de la DIAN (lectura exacta), o PDF/foto (Regenta IA).
// Devuelve la compra armada para revisar en pantalla; nada entra al inventario hasta que la persona guarda.
export const maxDuration = 120;
const MAX = 12 * 1024 * 1024;

function tipoArchivo(b: Uint8Array): string | null {
  if (b[0] === 0x50 && b[1] === 0x4b) return "application/zip";
  if (b[0] === 0x25 && b[1] === 0x50 && b[2] === 0x44 && b[3] === 0x46) return "application/pdf";
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
  if (b[0] === 0x52 && b[1] === 0x49 && b[8] === 0x57 && b[9] === 0x45) return "image/webp";
  const ini = Buffer.from(b.subarray(0, 200)).toString("utf8").replace(/^﻿/, "").trimStart();
  return ini.startsWith("<") ? "application/xml" : null;
}

export const POST = conSesion(async (s, req) => {
  if (!puedeCompras.ver(s.rol)) return json({ error: "Las facturas de compra las cargan el dueño, el administrador o la bodega" }, 403);
  const form = await req.formData().catch(() => null);
  const f = form?.get("archivo");
  if (!(f instanceof File) || !f.size) return json({ error: "Elige el archivo de la factura" }, 400);
  if (f.size > MAX) return json({ error: "El archivo pesa más de 12 MB. Si es una foto, tómala de nuevo o súbela más liviana" }, 413);
  const datos = new Uint8Array(await f.arrayBuffer());
  const tipo = tipoArchivo(datos);
  if (!tipo) return json({ error: "Sube el ZIP o XML de la factura electrónica, el PDF o una foto (JPG o PNG)" }, 415);
  const dinero = puedeCompras.dinero(s.rol);

  const { empresa, demo } = await comoUsuario(s, async (c) => {
    const e = (await c.query(`select nit, demo from empresas where id = $1`, [s.empresa])).rows[0];
    return { empresa: e as { nit: string }, demo: !!e?.demo };
  });

  // 1. Leer el documento.
  let docs: DocumentoLeido[];
  if (tipo === "application/zip" || tipo === "application/xml") {
    try { docs = leerArchivoXml(f.name, datos); }
    catch (e) { return json({ error: (e as Error).message || "No se pudo leer el XML de la factura" }, 422); }
  } else {
    if (!iaActiva()) return json({ error: "La lectura de fotos y PDF con Regenta IA no está disponible en este momento. Sube el ZIP o XML que te llegó al correo." }, 503);
    const cupo = demo
      ? (await limiteBD(`ia-factura-demo:ip:${ipCliente(req)}`, 5, "1 day")) && (await limiteBD("ia-factura-demo:total", 100, "1 day"))
      : await limiteBD(`ia-factura:empresa:${s.empresa}`, 150, "1 day");
    if (!cupo) return json({ error: demo ? "En la demo puedes leer hasta 5 facturas con foto por día. Escríbenos por WhatsApp y te la mostramos completa." : "Tu droguería llegó al tope de facturas leídas con foto hoy. Mañana sigues; mientras, sube el ZIP o XML." }, 429);
    try { docs = [await leerFacturaConIA(datos, tipo)]; }
    catch (e) {
      if (e instanceof NoEsFactura) return json({ error: "No se ve una factura con productos. Toma la foto de frente, con buena luz y la factura completa." }, 422);
      console.error("leer factura IA", (e as Error).message);
      return json({ error: mensajeIA(e) }, 502);
    }
  }
  const doc = docs.find((d) => d.tipo === "factura") ?? docs[0];
  const avisos: string[] = [];
  // Lotes que el XML no trae pero sí el PDF del mismo ZIP (Distribuciones AXA, Zanecol…): los lee Regenta IA y se
  // ponen en sus líneas. Cantidades, precios e IVA siguen siendo los del XML.
  const faltan = doc.tipo === "factura" && doc.lineas.some((l) => !l.lote && !l.cargo && !l.bonificada);
  const pdf = faltan ? pdfDelZip(f.name, datos) : null;
  if (pdf && iaActiva()) {
    const cupo = demo ? (await limiteBD(`ia-factura-demo:ip:${ipCliente(req)}`, 5, "1 day")) && (await limiteBD("ia-factura-demo:total", 100, "1 day")) : await limiteBD(`ia-factura:empresa:${s.empresa}`, 150, "1 day");
    if (cupo) {
      try {
        const leidos = await leerLotesDelPdf(pdf);
        const antes = doc.lineas.filter((l) => l.lote).length;
        doc.lineas = aplicarLotes(doc.lineas, leidos).map((l, k) => ({ ...l, n: k + 1 }));
        const puestos = doc.lineas.filter((l) => l.lote).length - antes;
        if (puestos > 0) avisos.push("El XML no trae lotes: se leyeron del PDF de la misma factura con Regenta IA. Confírmalos contra las cajas.");
      } catch (e) { console.error("lotes del PDF", (e as Error).message); }
    }
  }
  if (docs.length > 1) avisos.push(`El ZIP trae ${docs.length} documentos: se cargó ${doc.tipo === "factura" ? "la factura" : "el primero"} ${doc.numero}.`);
  if (doc.tipo !== "factura") {
    return json({ nota: { tipo: doc.tipo, numero: doc.numero, proveedor: doc.proveedor.nombre, referencia: doc.referencia, total: dinero ? doc.totales.total : null },
      error: `Es una ${doc.tipo === "nota_credito" ? "nota crédito" : "nota débito"} del proveedor ${doc.proveedor.nombre}${doc.referencia ? ` sobre la factura ${doc.referencia}` : ""}, no una factura de compra: no mete mercancía al inventario. ${doc.tipo === "nota_credito" ? "Aplícala en Cuentas por pagar o en la compra de esa factura." : ""}`.trim() }, 422);
  }
  const nitPropio = String(empresa.nit ?? "").replace(/\D/g, "").replace(/^(\d{9})\d$/, "$1");
  if (doc.comprador.nit && nitPropio && !nitPropio.startsWith(doc.comprador.nit) && !doc.comprador.nit.startsWith(nitPropio))
    avisos.push(`Ojo: la factura está a nombre de ${doc.comprador.nombre ?? "otro comprador"} (NIT ${doc.comprador.nit}), no de tu droguería.`);

  // 2. Proveedor, factura repetida, emparejar productos y guardar el archivo en el espacio de la droguería.
  const sha = createHash("sha256").update(datos).digest("hex");
  const r = await comoUsuario(s, async (c) => {
    const prov = await proveedorDeFactura(c, s.empresa, doc);
    const ya = prov && doc.numero
      ? (await c.query(`select id, numero from compras where empresa_id = $1 and proveedor_id = $2 and regexp_replace(upper(numero_factura), '[^A-Z0-9]', '', 'g') = regexp_replace(upper($3), '[^A-Z0-9]', '', 'g') and estado <> 'anulada'`, [s.empresa, prov.id, doc.numero])).rows[0] ?? null
      : null;
    const lineas = await emparejar(c, s.empresa, prov?.id ?? null, doc.lineas, dinero);
    const archivo = (await c.query(`select guardar_archivo_compra($1, $2, $3, $4, $5, $6) r`, [s.empresa, f.name.slice(0, 160), tipo === "application/xml" ? "application/xml" : tipo, Buffer.from(datos), sha, { ...doc, lineas: doc.lineas }])).rows[0].r;
    return { prov, ya, lineas, archivo };
  });
  if (r.ya) avisos.unshift(`Esta factura ya está registrada: compra N.º ${r.ya.numero}.`);

  // La bodega recibe productos, lotes y cantidades: sin costos ni totales (como en el resto de compras).
  const lineas = r.lineas.map((l) => {
    const { costo_unidad: _c, ...p } = l.producto ?? ({} as Record<string, unknown>);
    const base = { ...l, producto: l.producto ? (dinero ? l.producto : p) : null, candidatos: l.candidatos.map(({ costo_unidad: _x, ...k }) => k) };
    return dinero ? base : { ...base, precio: null, base: null, descuento_pct: 0 };
  });
  return json({
    documento: { ...doc, lineas, totales: dinero ? doc.totales : { base: null, iva: null, descuentos: null, total: null } },
    proveedor: r.prov, archivo_id: r.archivo?.id ?? null, duplicada: r.ya, avisos,
    resumen: { lineas: lineas.length, emparejadas: lineas.filter((l) => l.producto).length, con_lote: lineas.filter((l) => l.lote).length },
  });
});
