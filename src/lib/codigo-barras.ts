// Códigos de barras para etiquetas, dibujados en SVG sin librerías: EAN-13 (y UPC-A como EAN-13 con un 0 delante) cuando el
// código lo es y su dígito de control cuadra; si no, Code 128 (juego C para cifras, B para el resto). Igual en servidor y
// navegador.

const L = ["0001101", "0011001", "0010011", "0111101", "0100011", "0110001", "0101111", "0111011", "0110111", "0001011"];
const G = ["0100111", "0110011", "0011011", "0100001", "0011101", "0111001", "0000101", "0010001", "0001001", "0010111"];
const R = ["1110010", "1100110", "1101100", "1000010", "1011100", "1001110", "1010000", "1000100", "1001000", "1110100"];
const PARIDAD = ["LLLLLL", "LLGLGG", "LLGGLG", "LLGGGL", "LGLLGG", "LGGLLG", "LGGGLL", "LGLGLG", "LGLGGL", "LGGLGL"];

/** Dígito de control EAN/UPC de las primeras cifras (pesos 1 y 3 desde la izquierda en EAN-13). */
export function digitoEan(doce: string) {
  let s = 0;
  for (let i = 0; i < doce.length; i++) s += Number(doce[i]) * (i % 2 === 0 ? 1 : 3);
  return (10 - (s % 10)) % 10;
}
/** ¿Es un EAN-13 válido (13 cifras con su dígito de control)? */
export const esEan13 = (c: string) => /^\d{13}$/.test(c) && digitoEan(c.slice(0, 12)) === Number(c[12]);

/** Módulos (1 = barra, 0 = espacio) de un EAN-13: 95 módulos. */
export function modulosEan13(c: string): string {
  const p = PARIDAD[Number(c[0])];
  let m = "101";
  for (let i = 1; i <= 6; i++) m += (p[i - 1] === "L" ? L : G)[Number(c[i])];
  m += "01010";
  for (let i = 7; i <= 12; i++) m += R[Number(c[i])];
  return m + "101";
}

// Code 128: anchos (barra, espacio, barra, espacio, barra, espacio) de los 107 símbolos; 106 = parada (7 elementos).
const C128 = ("212222 222122 222221 121223 121322 131222 122213 122312 132212 221213 221312 231212 112232 122132 122231 113222 123122 123221 223211 221132 " +
  "221231 213212 223112 312131 311222 321122 321221 312212 322112 322211 212123 212321 232121 111323 131123 131321 112313 132113 132311 211313 " +
  "231113 231311 112133 112331 132131 113123 113321 133121 313121 211331 231131 213113 213311 213131 311123 311321 331121 312113 312311 332111 " +
  "314111 221411 431111 111224 111422 121124 121421 141122 141221 112214 112412 122114 122411 142112 142211 241211 221114 413111 241112 134111 " +
  "111242 121142 121241 114212 124112 124211 411212 421112 421211 212141 214121 412121 111143 111341 131141 114113 114311 411113 411311 113141 " +
  "114131 311141 411131 211412 211214 211232 2331112").split(" ");
const START_B = 104, START_C = 105, CODE_B = 100;

/** Valores de los símbolos Code 128 (con arranque, control y parada). Cifras en pares con el juego C; si queda una cifra
 *  suelta o hay letras, juego B. Solo caracteres ASCII imprimibles. */
export function simbolos128(texto: string): number[] {
  if (!/^[\x20-\x7e]+$/.test(texto)) throw new Error("Code 128: solo caracteres imprimibles");
  const v: number[] = [];
  if (/^\d+$/.test(texto) && texto.length >= 2) {
    v.push(START_C);
    const pares = texto.length - (texto.length % 2);
    for (let i = 0; i < pares; i += 2) v.push(Number(texto.slice(i, i + 2)));
    if (texto.length % 2) { v.push(CODE_B); v.push(texto.charCodeAt(texto.length - 1) - 32); }
  } else {
    v.push(START_B);
    for (const ch of texto) v.push(ch.charCodeAt(0) - 32);
  }
  const control = v.reduce((s, x, i) => s + x * (i === 0 ? 1 : i), 0) % 103;
  return [...v, control, 106];
}

/** Módulos (1 = barra, 0 = espacio) de un Code 128. */
export function modulos128(texto: string): string {
  let m = "";
  for (const s of simbolos128(texto)) {
    const w = C128[s];
    for (let i = 0; i < w.length; i++) m += (i % 2 === 0 ? "1" : "0").repeat(Number(w[i]));
  }
  return m;
}

export type Barras = { tipo: "EAN-13" | "Code 128"; texto: string; modulos: string; silencio: [number, number] };

/** Elige el tipo: EAN-13 si el código lo es (o UPC-A válido), si no Code 128. null si no hay código o no es imprimible. */
export function barras(codigo: string | null | undefined): Barras | null {
  const c = String(codigo ?? "").trim();
  if (!c) return null;
  if (esEan13(c)) return { tipo: "EAN-13", texto: c, modulos: modulosEan13(c), silencio: [11, 7] };
  if (/^\d{12}$/.test(c) && digitoEan("0" + c.slice(0, 11)) === Number(c[11])) return { tipo: "EAN-13", texto: c, modulos: modulosEan13("0" + c), silencio: [11, 7] };
  if (!/^[\x20-\x7e]{1,40}$/.test(c)) return null;
  return { tipo: "Code 128", texto: c, modulos: modulos128(c), silencio: [10, 10] };
}

const escapar = (s: string) => s.replace(/[&<>"]/g, (x) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[x]!);

/** SVG del código (barras unidas en rectángulos, zona de silencio incluida y el texto debajo). Ancho y alto en mm: las
 *  barras se escalan al ancho disponible, nunca se salen. */
export function svgBarras(b: Barras, anchoMm: number, altoMm: number): string {
  const total = b.silencio[0] + b.modulos.length + b.silencio[1];
  const texto = Math.min(2.6, altoMm * 0.28), alto = altoMm - texto - 0.4;
  let rects = "";
  for (let i = 0; i < b.modulos.length; ) {
    if (b.modulos[i] === "1") {
      let j = i; while (j < b.modulos.length && b.modulos[j] === "1") j++;
      rects += `<rect x="${b.silencio[0] + i}" y="0" width="${j - i}" height="${alto}"/>`;
      i = j;
    } else i++;
  }
  // Las x de los rectángulos van en módulos; el viewBox convierte a mm con preserveAspectRatio="none" solo en horizontal.
  return `<svg xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Código de barras ${escapar(b.tipo)} ${escapar(b.texto)}" data-tipo="${b.tipo}" data-codigo="${escapar(b.texto)}" width="${anchoMm}mm" height="${altoMm}mm" viewBox="0 0 ${anchoMm} ${altoMm}">`
    + `<g transform="scale(${anchoMm / total} 1)" fill="#000" shape-rendering="crispEdges" data-modulos="${b.modulos.length}">${rects}</g>`
    + `<text x="${anchoMm / 2}" y="${altoMm - 0.2}" text-anchor="middle" font-family="ui-monospace,Menlo,Consolas,monospace" font-size="${texto}" fill="#000">${escapar(b.texto)}</text></svg>`;
}
