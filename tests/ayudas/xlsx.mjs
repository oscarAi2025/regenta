// Lee un .xlsx de Regenta (inlineStr y números) como filas de texto, para las pruebas de las descargas en Excel.
import { unzipSync, strFromU8 } from "fflate";

const des = (s) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&amp;/g, "&");
const XLSX = /spreadsheetml\.sheet/;

/** Filas de la primera hoja (o de la hoja n, desde 1). Cada celda como texto: los números en su forma cruda (22.5). */
export function filasXlsx(bytes, n = 1) {
  const z = unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes));
  const x = strFromU8(z[`xl/worksheets/sheet${n}.xml`]);
  return [...x.matchAll(/<row [^>]*>(.*?)<\/row>/gs)].map(([, r]) => {
    const fila = [];
    for (const [, ref, cuerpo] of r.matchAll(/<c r="([A-Z]+)\d+"[^>]*>(.*?)<\/c>/gs)) {
      let i = 0; for (const ch of ref) i = i * 26 + ch.charCodeAt(0) - 64;
      const t = cuerpo.match(/<t[^>]*>(.*?)<\/t>/s)?.[1] ?? cuerpo.match(/<v>(.*?)<\/v>/s)?.[1] ?? "";
      fila[i - 1] = des(t);
    }
    return Array.from(fila, (c) => c ?? "");
  });
}
/** Las filas unidas con «;» y saltos de línea: para buscar textos en toda la hoja. */
export const textoXlsx = (bytes, n = 1) => filasXlsx(bytes, n).map((f) => f.join(";")).join("\n");
/** ¿La respuesta es un .xlsx descargable? */
export const esXlsx = (tipo, disposicion) => XLSX.test(tipo ?? "") && /attachment; filename="[^"]+\.xlsx"/.test(disposicion ?? "");
/** XML crudo de la hoja n: para comprobar que ninguna celda es una fórmula (<f>). */
export const xmlHoja = (bytes, n = 1) => strFromU8(unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes))[`xl/worksheets/sheet${n}.xml`]);
