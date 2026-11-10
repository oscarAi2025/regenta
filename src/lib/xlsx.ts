import { zipSync, strToU8 } from "fflate";

// Libro de Excel (.xlsx) mínimo y sin dependencias pesadas: encabezado fijo con filtro, anchos de columna y formatos
// colombianos (miles con punto los pone Excel según la configuración regional; aquí van los códigos de formato).

export type Tipo = "texto" | "entero" | "pesos" | "fecha" | "porcentaje" | "decimal";
export type Columna = { titulo: string; ancho: number; tipo: Tipo };
export type Celda = string | number | null | undefined;
export type Hoja = { nombre: string; columnas: Columna[]; filas: Celda[][] };

const ESTILO: Record<Tipo, number> = { texto: 0, entero: 2, pesos: 3, fecha: 4, porcentaje: 5, decimal: 6 };
// Quita caracteres que XML no admite y escapa los reservados.
const xml = (s: string) => s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const col = (i: number) => { let s = ""; for (i++; i > 0; i = Math.floor((i - 1) / 26)) s = String.fromCharCode(65 + ((i - 1) % 26)) + s; return s; };
// Fecha AAAA-MM-DD → número de serie de Excel (días desde 1899-12-30).
const serie = (iso: string) => { const t = Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10)); return Math.round((t - Date.UTC(1899, 11, 30)) / 864e5); };
const nombreHoja = (s: string) => xml(s.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Hoja");

function hojaXml(h: Hoja): string {
  const ultima = col(Math.max(h.columnas.length - 1, 0));
  const celda = (v: Celda, c: number, r: number, t: Tipo): string => {
    const ref = `${col(c)}${r}`;
    if (v === null || v === undefined || v === "") return "";
    if (t === "fecha" && typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) return `<c r="${ref}" s="${ESTILO.fecha}"><v>${serie(v)}</v></c>`;
    if (t !== "texto" && typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}" s="${ESTILO[t]}"><v>${v}</v></c>`;
    // Texto (incluye códigos de barras: como texto no pierden los ceros ni se vuelven notación científica).
    return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xml(String(v))}</t></is></c>`;
  };
  const filas = [
    `<row r="1">${h.columnas.map((c, i) => `<c r="${col(i)}1" t="inlineStr" s="1"><is><t>${xml(c.titulo)}</t></is></c>`).join("")}</row>`,
    ...h.filas.map((f, j) => `<row r="${j + 2}">${h.columnas.map((c, i) => celda(f[i], i, j + 2, c.tipo)).join("")}</row>`),
  ];
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<sheetFormatPr defaultRowHeight="15"/>
<cols>${h.columnas.map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.ancho}" customWidth="1"/>`).join("")}</cols>
<sheetData>${filas.join("")}</sheetData>
${h.filas.length ? `<autoFilter ref="A1:${ultima}${h.filas.length + 1}"/>` : ""}
</worksheet>`;
}

const ESTILOS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="3"><numFmt numFmtId="164" formatCode="&quot;$&quot;\\ #,##0"/><numFmt numFmtId="165" formatCode="dd/mm/yyyy"/><numFmt numFmtId="166" formatCode="0%"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font></fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF10233A"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="7">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"><alignment vertical="center" wrapText="1"/></xf>
<xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="166" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/** Arma el .xlsx con una o varias hojas. */
export function libroXlsx(hojas: Hoja[]): Uint8Array {
  const archivos: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
${hojas.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${hojas.map((h, i) => `<sheet name="${nombreHoja(h.nombre)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>
<definedNames>${hojas.map((h, i) => h.filas.length ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${nombreHoja(h.nombre).replace(/'/g, "''")}'!$A$1:$${col(h.columnas.length - 1)}$${h.filas.length + 1}</definedName>` : "").join("")}</definedNames></workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${hojas.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${hojas.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    "xl/styles.xml": strToU8(ESTILOS),
  };
  hojas.forEach((h, i) => { archivos[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(hojaXml(h)); });
  return zipSync(archivos, { level: 6 });
}
