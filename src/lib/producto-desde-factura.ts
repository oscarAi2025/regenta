// Producto nuevo a partir de una línea de la factura del proveedor (09/11/2026): lo que se puede saber de la propia
// línea para que crear el producto sea revisar y confirmar, sin salir de la compra. Lógica pura (se usa en el navegador)
// y probada en tests/producto-desde-factura.test.mjs.

/** Margen sugerido sobre el precio de venta sin IVA para un producto nuevo (la persona lo cambia antes de crear). */
export const MARGEN_SUGERIDO = 25;

// «CAJA 10», «CJA X 30 TAB», «X 100 UND», «CAJA X 24 UNIDADES»… pero no «X 15 ML», «X 20 GR» ni «7.5 X 7.5» (medidas).
const RE_CUENTA = /(?:\b(?:caja|cja|cj|caj|cajax|blister|sobre|frasco|paquete|pqte|bolsa)\s*(?:x\s*)?|\bx\s*)(\d{1,4})(?![.,]\d)(?!\s*(?:ml|mg|gr|g|grs|l|lt|cc|mcg|ui|oz|kg|cm|mm|%|\/))(?=\b|(?:unds?|unid(?:ades)?|tabs?|caps?|amp(?:ollas?)?|sob(?:res)?)\b)/gi;

/** Unidades por caja que dice la descripción (la última mención, p. ej. «IMPOMEL X 15 MG CJA X 10 TAB» → 10); 1 si no dice. */
export function unidadesEnDescripcion(desc: string): number {
  let n = 1;
  for (const m of desc.matchAll(RE_CUENTA)) { const v = Number(m[1]); if (v >= 2 && v <= 1000) n = v; }
  return n;
}

/** Redondea hacia arriba al múltiplo indicado (precios de mostrador: a $100 la caja, a $50 la unidad). */
const arriba = (n: number, m: number) => Math.ceil(n / m) * m;

/**
 * Precio de venta sugerido (con IVA, en pesos enteros) con el margen sugerido sobre el costo neto de la factura.
 * costo: precio unitario de la línea sin IVA; como: si la cantidad de la factura son cajas o unidades sueltas.
 */
export function preciosSugeridos(x: { costo: number | null; descuentoPct: number; como: "caja" | "unidad"; upc: number; ivaPct: number; margen?: number }) {
  if (!x.costo || x.costo <= 0) return { precio_caja: null as number | null, precio_unidad: null as number | null };
  const m = (x.margen ?? MARGEN_SUGERIDO) / 100;
  const neto = x.costo * (1 - x.descuentoPct / 100);
  const costoCaja = x.como === "unidad" ? neto * x.upc : neto;
  const caja = arriba((costoCaja / (1 - m)) * (1 + x.ivaPct / 100), 100);
  if (x.upc <= 1) return { precio_caja: caja, precio_unidad: null };
  // Suelta un poco más cara que la caja dividida (lo habitual en mostrador), nunca más cara que la caja entera.
  const unidad = Math.min(caja, arriba((caja / x.upc) * 1.1, 50));
  return { precio_caja: caja, precio_unidad: unidad };
}

/** Margen real (%) de un precio de venta con IVA frente al costo neto por caja: lo que se le muestra a la persona. */
export function margenDe(precioCajaConIva: number, costoCajaNeto: number, ivaPct: number) {
  const sinIva = precioCajaConIva / (1 + ivaPct / 100);
  return sinIva > 0 ? Math.round(((sinIva - costoCajaNeto) / sinIva) * 1000) / 10 : null;
}

/** Nombre para el catálogo: el de la factura sin espacios de más ni guiones sueltos al final. */
export const nombreDeFactura = (n: string) => n.replace(/\(?\b(?:bonificad[oa]s?|obsequio|muestra m[eé]dica)\b\)?/gi, " ").replace(/\s+/g, " ").replace(/[\s\-–,;.]+$/, "").trim().slice(0, 200);
