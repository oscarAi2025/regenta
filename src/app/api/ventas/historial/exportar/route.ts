import { comoUsuario } from "@/lib/db";
import { conSesion, json } from "@/lib/api";
import { puede } from "@/lib/sesion";
import { libroXlsx } from "@/lib/xlsx";
import { ESTADO_HISTORIAL, documentosHistorial, leerFiltro, lineasHistorial } from "@/lib/historial-alegra";

const MEDIO: Record<string, string> = { efectivo: "Efectivo", transferencia: "Transferencia", tarjeta: "Tarjeta", credito: "Crédito" };

/** El historial de Alegra en Excel (con los filtros de la pantalla): una hoja de documentos y otra con cada línea vendida. */
export const GET = conSesion(async (s, req) => {
  if (!puede.verCostos(s.rol)) return json({ error: "El historial de Alegra lo descargan el dueño y el administrador" }, 403);
  const sp = Object.fromEntries(new URL(req.url).searchParams);
  const f = leerFiltro(sp);
  const d = await comoUsuario(s, async (c) => ({ docs: await documentosHistorial(c, s.empresa, f, 100000), lineas: await lineasHistorial(c, s.empresa, f) }));
  const libro = libroXlsx([
    { nombre: "Documentos", columnas: [
      { titulo: "Número", ancho: 12, tipo: "texto" }, { titulo: "Tipo", ancho: 10, tipo: "texto" }, { titulo: "Fecha", ancho: 12, tipo: "fecha" }, { titulo: "Vence", ancho: 12, tipo: "fecha" },
      { titulo: "Cliente", ancho: 34, tipo: "texto" }, { titulo: "Documento del cliente", ancho: 16, tipo: "texto" }, { titulo: "Subtotal", ancho: 14, tipo: "pesos" },
      { titulo: "Descuento", ancho: 12, tipo: "pesos" }, { titulo: "IVA", ancho: 12, tipo: "pesos" }, { titulo: "Total", ancho: 14, tipo: "pesos" }, { titulo: "Notas crédito (devuelto)", ancho: 14, tipo: "pesos" }, { titulo: "Pagado", ancho: 14, tipo: "pesos" },
      { titulo: "Saldo al migrar", ancho: 14, tipo: "pesos" }, { titulo: "Abonado en Regenta", ancho: 14, tipo: "pesos" }, { titulo: "Saldo hoy", ancho: 14, tipo: "pesos" },
      { titulo: "Estado", ancho: 12, tipo: "texto" }, { titulo: "Forma de pago", ancho: 14, tipo: "texto" }, { titulo: "Líneas", ancho: 8, tipo: "entero" }],
      filas: d.docs.map((x) => [x.numero, x.documento === "pos" ? "POS" : "Factura", x.fecha, x.vence, x.cliente_nombre, x.cliente_doc, x.subtotal, x.descuento, x.iva, x.total, x.devuelto || null,
        x.pagado, x.saldo, x.abonado, x.saldo_hoy, ESTADO_HISTORIAL[x.estado] ?? x.estado, x.forma_pago ? MEDIO[x.forma_pago] ?? x.forma_pago : null, x.lineas]) },
    { nombre: "Líneas vendidas", columnas: [
      { titulo: "Número", ancho: 12, tipo: "texto" }, { titulo: "Fecha", ancho: 12, tipo: "fecha" }, { titulo: "Cliente", ancho: 30, tipo: "texto" }, { titulo: "Documento del cliente", ancho: 16, tipo: "texto" },
      { titulo: "Producto", ancho: 44, tipo: "texto" }, { titulo: "Cantidad", ancho: 10, tipo: "entero" }, { titulo: "Precio unitario", ancho: 14, tipo: "pesos" },
      { titulo: "Descuento %", ancho: 11, tipo: "porcentaje" }, { titulo: "IVA", ancho: 7, tipo: "porcentaje" }, { titulo: "Total", ancho: 14, tipo: "pesos" },
      { titulo: "Lote", ancho: 14, tipo: "texto" }, { titulo: "Vence", ancho: 12, tipo: "fecha" }, { titulo: "Estado del documento", ancho: 14, tipo: "texto" }],
      filas: d.lineas.map((l) => [l.numero, l.fecha, l.cliente_nombre, l.cliente_doc, l.producto, l.cantidad, Math.round(l.precio), l.descuento / 100, l.iva_pct / 100, Math.round(l.total), l.lote, l.vence,
        ESTADO_HISTORIAL[l.estado] ?? l.estado]) },
  ]);
  const rango = f.desde || f.hasta ? `-${f.desde ?? "inicio"}-a-${f.hasta ?? "hoy"}` : "";
  return new Response(Buffer.from(libro), { headers: {
    "content-type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "content-disposition": `attachment; filename="historial-alegra${rango}.xlsx"`, "cache-control": "private, no-store",
  } });
});
