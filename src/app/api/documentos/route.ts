import { comoUsuario } from "@/lib/db";
import { conSesion, json } from "@/lib/api";
import { puede } from "@/lib/sesion";
import { excel, respuestaExcel } from "@/lib/reportes";
import { ESTADOS, TIPOS, leerFiltro, listarDocumentos, resta } from "@/lib/documentos";

/** Exporta a Excel (.xlsx) los documentos electrónicos con los mismos filtros de la pantalla. Solo dueño y administrador.
 *  Columnas estables (las leen hojas de cálculo de los clientes): en el documento soporte y su nota de ajuste, «Cliente» es
 *  el proveedor y «CUFE/CUDE» lleva el CUDS; en las notas, «Venta» es la venta o el documento de origen. */
export const GET = conSesion(async (s, req) => {
  if (!puede.anular(s.rol)) return json({ error: "Los documentos electrónicos son del dueño o el administrador" }, 403);
  const f = leerFiltro(Object.fromEntries(new URL(req.url).searchParams));
  const docs = await comoUsuario(s, (c) => listarDocumentos(c, s.empresa, f, null));
  const filas = docs.map((d) => ({ ...d, tipo: TIPOS[d.tipo], estado: ESTADOS[d.estado], simulado: d.simulado ? "Sí" : "No", total: resta(d.tipo) ? -d.total : d.total,
    venta: d.venta ?? d.origen, cliente: d.proveedor ?? d.cliente ?? "Consumidor final", cliente_doc: d.proveedor ? d.proveedor_doc : d.cliente_doc,
    ultimo_error: d.estado === "rechazado" ? d.ultimo_error : null }));
  const libro = excel("Documentos DIAN", filas, [["fecha", "Fecha"], ["tipo", "Tipo"], ["numero", "Número"], ["venta", "Venta"], ["cliente", "Cliente"], ["cliente_doc", "Documento del cliente"],
    ["total", "Total"], ["estado", "Estado DIAN"], ["simulado", "Emisión simulada"], ["cufe", "CUFE/CUDE"], ["ultimo_error", "Motivo del rechazo"]]);
  return respuestaExcel(libro, `regenta-documentos-${f.desde}-a-${f.hasta}.xlsx`);
});
