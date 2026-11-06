// XML de prueba del modo simulado (claramente marcado: no es UBL ni fue
// enviado a la DIAN). Función pura: se prueba sin red.
import type { DocumentoParaEmitir } from "./index";

const esc = (s: unknown) => String(s ?? "").replace(/[<>&"']/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;", '"': "&quot;", "'": "&apos;" })[c]!);
const p2 = (n: number) => (Math.round(n * 100) / 100).toFixed(2);

export const MARCA_SIMULADO = "DOCUMENTO SIMULADO POR REGENTA: NO FUE ENVIADO A LA DIAN Y NO TIENE VALIDEZ FISCAL";

/** Clave del documento según su tipo: CUFE (factura), CUDS (documento soporte y su nota de ajuste), CUDE (los demás). */
export const nombreClave = (tipo: string) => (tipo === "factura" ? "CUFE" : tipo === "soporte" || tipo === "ajuste_soporte" ? "CUDS" : "CUDE");

/** XML de prueba del modo simulado: los datos reales del documento dentro de una marca inequívoca. */
export function xmlSimulado(d: DocumentoParaEmitir, clave: string): string {
  const k = nombreClave(d.tipo);
  const tercero = d.proveedor
    ? `  <Proveedor documento="${esc(d.proveedor.tipo_doc)} ${esc(d.proveedor.numero_doc)}${d.proveedor.dv ? "-" + esc(d.proveedor.dv) : ""}">${esc(d.proveedor.nombre)}</Proveedor>\n`
    : d.cliente ? `  <Cliente documento="${esc(d.cliente.tipo_doc)} ${esc(d.cliente.numero_doc)}">${esc(d.cliente.nombre)}</Cliente>\n` : `  <Cliente>Consumidor final</Cliente>\n`;
  return `<?xml version="1.0" encoding="UTF-8"?>
<!-- ${MARCA_SIMULADO} -->
<DocumentoSimulado xmlns="urn:regenta:simulado" tipo="${esc(d.tipo)}" simulado="true">
  <Advertencia>${MARCA_SIMULADO}</Advertencia>
  <Numero>${esc(d.prefijo)}${esc(d.numero)}</Numero>
  <Fecha>${esc(d.fecha)}</Fecha>
  <${k}>${esc(clave)}</${k}>
  <Emisor nit="${esc(d.emisor.nit)}${d.emisor.dv ? "-" + esc(d.emisor.dv) : ""}">${esc(d.emisor.razon_social)}</Emisor>
${tercero}${d.periodo ? `  <Periodo desde="${esc(d.periodo.desde)}" hasta="${esc(d.periodo.hasta)}"/>\n` : ""}${d.motivo ? `  <Motivo>${esc(d.motivo)}</Motivo>\n` : ""}${d.referencia ? `  <Referencia numero="${esc(d.referencia.prefijo)}${esc(d.referencia.numero)}">${esc(d.referencia.cufe)}</Referencia>\n` : ""}  <Lineas>
${d.lineas.map((l) => `    <Linea cantidad="${esc(l.cantidad)}" base="${p2(l.base)}" iva_pct="${esc(l.iva_pct)}" iva="${p2(l.iva)}" total="${p2(l.total)}">${esc(l.descripcion)}</Linea>`).join("\n")}
  </Lineas>
  <Totales base="${p2(d.totales.base)}" iva="${p2(d.totales.iva)}" total="${p2(d.totales.total)}"/>
</DocumentoSimulado>
`;
}
