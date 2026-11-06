import { comoUsuario } from "@/lib/db";
import { conSesion, json } from "@/lib/api";
import { puede } from "@/lib/sesion";
import { csv } from "@/lib/reportes";
import { ESTADOS, TIPOS, leerFiltro, listarDocumentos } from "@/lib/documentos";

/** Exporta a CSV (Excel) los documentos electrónicos con los mismos filtros de la pantalla. Solo dueño y administrador. */
export const GET = conSesion(async (s, req) => {
  if (!puede.anular(s.rol)) return json({ error: "Los documentos electrónicos son del dueño o el administrador" }, 403);
  const f = leerFiltro(Object.fromEntries(new URL(req.url).searchParams));
  const docs = await comoUsuario(s, (c) => listarDocumentos(c, s.empresa, f, null));
  const filas = docs.map((d) => ({ ...d, tipo: TIPOS[d.tipo], estado: ESTADOS[d.estado], simulado: d.simulado ? "Sí" : "No", total: d.tipo.startsWith("nc") ? -d.total : d.total,
    cliente: d.cliente ?? "Consumidor final", ultimo_error: d.estado === "rechazado" ? d.ultimo_error : null }));
  const cuerpo = csv(filas, [["fecha", "Fecha"], ["tipo", "Tipo"], ["numero", "Número"], ["venta", "Venta"], ["cliente", "Cliente"], ["cliente_doc", "Documento del cliente"],
    ["total", "Total"], ["estado", "Estado DIAN"], ["simulado", "Emisión simulada"], ["cufe", "CUFE/CUDE"], ["ultimo_error", "Motivo del rechazo"]]);
  return new Response(cuerpo, { headers: { "content-type": "text/csv; charset=utf-8", "content-disposition": `attachment; filename="regenta-documentos-${f.desde}-a-${f.hasta}.csv"`, "cache-control": "no-store" } });
});
