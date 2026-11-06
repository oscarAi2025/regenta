// Etiquetas de góndola (compartido entre la vista previa y la impresión): el mismo HTML se muestra en pantalla y se manda a
// la impresora, así lo que se ve es lo que sale. Medidas en milímetros.
import { barras, svgBarras } from "./codigo-barras";
import { pesosMano } from "./precios";

export type Formato = "a4" | "rollo";
export type DatoEtiqueta = { id: string; nombre: string; laboratorio: string | null; ean: string | null; codigos: string[]; precio_caja: number; precio_unidad: number | null; unidades_por_caja: number };

/** Hoja A4 de 21 etiquetas (3 × 7 de 63,5 × 38,1 mm) o rollo de 50 × 25 mm (una por etiqueta). */
export const FORMATOS: Record<Formato, { nombre: string; ancho: number; alto: number; columnas: number; filas: number; margenSup: number; margenIzq: number; separacion: number }> = {
  a4: { nombre: "Hoja A4 · 21 etiquetas de 63,5 × 38,1 mm", ancho: 63.5, alto: 38.1, columnas: 3, filas: 7, margenSup: 15.15, margenIzq: 7.25, separacion: 2.5 },
  rollo: { nombre: "Rollo · 50 × 25 mm", ancho: 50, alto: 25, columnas: 1, filas: 1, margenSup: 0, margenIzq: 0, separacion: 0 },
};

const esc = (s: string) => s.replace(/[&<>"]/g, (x) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[x]!);

/** Código que se imprime: el principal; si no hay, el primer código alterno. */
export const codigoEtiqueta = (p: Pick<DatoEtiqueta, "ean" | "codigos">) => p.ean || p.codigos[0] || null;

export function etiquetaHtml(p: DatoEtiqueta, f: Formato): string {
  const m = FORMATOS[f], rollo = f === "rollo";
  const pad = rollo ? 1.5 : 2.2, ancho = m.ancho - pad * 2;
  const b = barras(codigoEtiqueta(p));
  const altoBarras = rollo ? 8.6 : 11;
  const fracciona = p.precio_unidad !== null && p.unidades_por_caja > 1;
  return `<div class="rot rot-${f}" data-producto="${esc(p.id)}">`
    + `<p class="rot-nombre">${esc(p.nombre)}</p>`
    + (rollo ? "" : `<p class="rot-lab">${esc(p.laboratorio || "Genérico")}</p>`)
    + `<div class="rot-precios"><p class="rot-precio"><span class="rot-pre">${fracciona ? `Caja x ${p.unidades_por_caja}` : "Precio"}</span> ${pesosMano(p.precio_caja)}</p>`
    + (fracciona ? `<p class="rot-unidad">Unidad ${pesosMano(p.precio_unidad!)}</p>` : "") + `</div>`
    + (b ? `<div class="rot-barras">${svgBarras(b, Math.min(ancho, rollo ? 46 : 52), altoBarras)}</div>` : `<p class="rot-sin">Sin código de barras</p>`)
    + `</div>`;
}

/** Estilos de las etiquetas (pantalla e impresión). */
export function estilosEtiquetas(f: Formato): string {
  const m = FORMATOS[f], rollo = f === "rollo", pad = rollo ? 1.5 : 2.2;
  return `.hoja-${f}{background:#fff;color:#000;box-sizing:border-box;font-family:Barlow,Arial,Helvetica,sans-serif;}
.hoja-a4{width:210mm;height:297mm;padding:${m.margenSup}mm 0 0 ${m.margenIzq}mm;display:grid;grid-template-columns:repeat(${m.columnas},${m.ancho}mm);grid-auto-rows:${m.alto}mm;column-gap:${m.separacion}mm;align-content:start;}
.hoja-rollo{width:${m.ancho}mm;height:${m.alto}mm;}
.rot-${f}{box-sizing:border-box;width:${m.ancho}mm;height:${m.alto}mm;padding:${pad}mm;overflow:hidden;display:flex;flex-direction:column;gap:${rollo ? 0.4 : 0.6}mm;}
.rot-${f} p{margin:0}
.rot-${f} .rot-nombre{font-weight:700;font-size:${rollo ? 7.2 : 8.6}pt;line-height:1.15;max-height:calc(${rollo ? 7.2 : 8.6}pt * 1.15 * 2);overflow:hidden;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;word-break:break-word;}
.rot-${f} .rot-lab{font-size:6.5pt;line-height:1.2;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:#333;}
.rot-${f} .rot-precios{display:flex;align-items:baseline;justify-content:space-between;gap:1.5mm;margin-top:auto;min-width:0;}
.rot-${f} .rot-precio{font-weight:800;font-size:${rollo ? 11 : 15}pt;line-height:1;white-space:nowrap;font-variant-numeric:tabular-nums;}
.rot-${f} .rot-pre{font-weight:600;font-size:${rollo ? 5.6 : 6.5}pt;}
.rot-${f} .rot-unidad{font-weight:700;font-size:${rollo ? 6.4 : 7.6}pt;white-space:nowrap;font-variant-numeric:tabular-nums;}
.rot-${f} .rot-barras{display:flex;justify-content:center;line-height:0;}
.rot-${f} .rot-barras svg{display:block;max-width:100%;}
.rot-${f} .rot-sin{font-size:6pt;color:#555;text-align:center;}`;
}

/** Reparte las etiquetas en hojas (A4) o una por página (rollo). */
export function hojasHtml(lista: DatoEtiqueta[], f: Formato): string[] {
  const porHoja = f === "a4" ? FORMATOS.a4.columnas * FORMATOS.a4.filas : 1;
  const hojas: string[] = [];
  for (let i = 0; i < lista.length; i += porHoja) hojas.push(`<div class="hoja-${f}">${lista.slice(i, i + porHoja).map((p) => etiquetaHtml(p, f)).join("")}</div>`);
  return hojas;
}

/** Documento completo para la impresora. */
export function documentoImpresion(lista: DatoEtiqueta[], f: Formato): string {
  const m = FORMATOS[f];
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><title>Etiquetas</title><style>
@page{size:${f === "a4" ? "A4" : `${m.ancho}mm ${m.alto}mm`};margin:0}html,body{margin:0;padding:0;background:#fff}
.hoja-${f}{page-break-after:always;break-after:page;overflow:hidden}.hoja-${f}:last-child{page-break-after:auto;break-after:auto}
${estilosEtiquetas(f)}</style></head><body>${hojasHtml(lista, f).join("")}</body></html>`;
}
