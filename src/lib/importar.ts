// Importación de productos: lectura tolerante de lo que exporta cualquier sistema anterior (Excel o CSV).
// Módulo puro (sin base de datos): reconoce columnas con distintos nombres, normaliza números, fechas, IVA y códigos
// de barras, y agrupa filas del mismo producto para que nada se duplique. Se usa en el navegador (columnas) y en el
// servidor (todo lo demás), y se prueba sin red en tests/importar.test.mjs.

export const CAMPOS = ["nombre", "codigo_barras", "laboratorio", "iva", "unidades_por_caja", "precio_caja", "precio_unidad",
  "stock_minimo", "lote", "vence", "cantidad_unidades", "costo_unidad", "registro_sanitario", "requiere_formula", "control_especial"] as const;
export type Campo = (typeof CAMPOS)[number];

export const ETIQUETAS: Record<Campo, string> = {
  nombre: "Nombre", codigo_barras: "Código de barras", laboratorio: "Laboratorio", iva: "IVA", unidades_por_caja: "Unidades por caja",
  precio_caja: "Precio de venta (caja)", precio_unidad: "Precio por unidad", stock_minimo: "Stock mínimo", lote: "Lote",
  vence: "Vencimiento", cantidad_unidades: "Existencias (unidades)", costo_unidad: "Costo por unidad", registro_sanitario: "Registro sanitario",
  requiere_formula: "Venta con fórmula médica", control_especial: "Control especial",
};

/** Nombres con que otros programas llaman a cada columna (ya normalizados: minúsculas, sin tildes, «_» entre palabras). */
const SINONIMOS: Record<Campo, string[]> = {
  nombre: ["nombre", "producto", "descripcion", "nombre_producto", "nombre_del_producto", "descripcion_producto", "articulo", "nombre_articulo", "item", "detalle", "medicamento"],
  codigo_barras: ["codigo_barras", "codigo_de_barras", "cod_barras", "codbarras", "ean", "ean13", "ean_13", "barcode", "codigo_ean", "upc", "cb"],
  laboratorio: ["laboratorio", "lab", "marca", "fabricante", "casa_comercial", "titular"],
  iva: ["iva", "impuesto", "tarifa_iva", "porcentaje_iva", "iva_porcentaje", "iva_pct", "tasa_iva", "impuesto_iva"],
  unidades_por_caja: ["unidades_por_caja", "unidades_caja", "unidades_x_caja", "und_caja", "und_x_caja", "factor", "factor_conversion", "cantidad_por_caja", "contenido", "unidades_empaque", "fraccion", "fracciones"],
  precio_caja: ["precio_caja", "precio", "precio_venta", "precio_de_venta", "pvp", "precio_publico", "valor_venta", "valor", "precio_venta_caja", "precio_con_iva", "precio_full"],
  precio_unidad: ["precio_unidad", "precio_unitario", "precio_und", "precio_fraccion", "valor_unidad", "precio_por_unidad", "precio_venta_unidad", "valor_fraccion"],
  stock_minimo: ["stock_minimo", "minimo", "stock_min", "existencia_minima", "cantidad_minima", "punto_de_pedido"],
  lote: ["lote", "numero_lote", "no_lote", "n_lote", "nro_lote", "num_lote", "codigo_lote"],
  vence: ["vence", "vencimiento", "fecha_vencimiento", "fecha_de_vencimiento", "f_vencimiento", "fecha_venc", "fec_venc", "caducidad", "fecha_caducidad", "expira", "fecha_expiracion", "vto", "fecha_vto", "f_vto", "fecha_vence", "vencimiento_lote"],
  cantidad_unidades: ["cantidad_unidades", "cantidad", "existencias", "existencia", "stock", "saldo", "inventario", "unidades", "cant", "stock_actual", "cantidad_actual", "disponible"],
  costo_unidad: ["costo_unidad", "costo", "costo_unitario", "precio_compra", "valor_compra", "costo_promedio", "precio_costo", "valor_costo"],
  registro_sanitario: ["registro_sanitario", "invima", "registro_invima", "reg_sanitario", "reg_invima", "rs", "registro"],
  requiere_formula: ["requiere_formula", "formula", "venta_con_formula", "con_formula", "formula_medica", "venta_con_formula_medica", "requiere_formula_medica",
    "bajo_formula", "venta_bajo_formula", "venta_bajo_formula_medica", "rx", "receta", "requiere_receta", "venta_bajo_receta", "condicion_de_venta", "condicion_venta", "tipo_de_venta", "tipo_venta"],
  control_especial: ["control_especial", "controlado", "medicamento_controlado", "medicamento_de_control_especial", "medicamento_control_especial", "control",
    "es_controlado", "de_control_especial", "control_esp"],
};

// Palabras demasiado generales para reconocer una columna por prefijo («valor_total» no es el precio de venta).
const SIN_PREFIJO = new Set(["valor", "precio", "registro", "item", "detalle", "lab", "cb", "rs", "cant", "unidades", "producto", "marca", "minimo", "factor", "contenido", "upc", "titular",
  "formula", "rx", "receta", "control", "controlado", "tipo_venta", "tipo_de_venta"]);

export const normalizarCabecera = (s: unknown) => String(s ?? "").trim().toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "")
  .replace(/%/g, " porcentaje ").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").replace(/porcentaje/g, "").replace(/__+/g, "_").replace(/^_+|_+$/g, "");

/** Qué campo de Regenta corresponde a cada columna del archivo (null = se ignora). Gana la primera columna de cada campo.
 *  «codigo» solo cuenta como código de barras si no hay una columna de código de barras propiamente dicha. */
export function mapearColumnas(cabeceras: unknown[]): (Campo | null)[] {
  const norm = cabeceras.map(normalizarCabecera);
  const mapa: (Campo | null)[] = norm.map(() => null);
  const usados = new Set<Campo>();
  for (const pasada of [0, 1]) {
    norm.forEach((h, i) => {
      if (mapa[i] || !h) return;
      for (const c of CAMPOS) {
        if (usados.has(c)) continue;
        const ok = pasada === 0 ? h === c || SINONIMOS[c].includes(h)
          : SINONIMOS[c].some((s) => !SIN_PREFIJO.has(s) && (h.startsWith(s + "_") || h.endsWith("_" + s)));
        if (ok) { mapa[i] = c; usados.add(c); return; }
      }
    });
  }
  const codigo = norm.findIndex((h, i) => !mapa[i] && ["codigo", "cod", "referencia", "ref", "codigo_producto", "plu"].includes(h));
  if (codigo >= 0 && !usados.has("codigo_barras")) mapa[codigo] = "codigo_barras";
  return mapa;
}

// ───────────── Normalización de valores ─────────────
const texto = (v: unknown) => (v === null || v === undefined ? "" : String(v)).replace(/ /g, " ").replace(/\s+/g, " ").trim();

/** Número escrito como sea: 12000 · 12.000 · 12,000 · $ 12.000,50 · 1.300 · 19% · 0,19. NaN si no es un número. */
export function numero(v: unknown): number | undefined {
  if (typeof v === "number") return Number.isFinite(v) ? v : NaN;
  let s = texto(v).replace(/^'/, "").replace(/[$%\s]/g, "").replace(/^COP/i, "");
  if (!s || s === "-") return undefined;
  if (/^\(.*\)$/.test(s)) s = "-" + s.slice(1, -1);
  if (/^-?\d+$/.test(s)) return Number(s);
  if (/^-?\d{1,3}(\.\d{3})+(,\d+)?$/.test(s)) return Number(s.replace(/\./g, "").replace(",", "."));
  if (/^-?\d{1,3}(,\d{3})+(\.\d+)?$/.test(s)) return Number(s.replace(/,/g, ""));
  if (/^-?\d+,\d+$/.test(s)) return Number(s.replace(",", "."));
  if (/^-?\d*\.\d+$/.test(s)) return Number(s);
  return NaN;
}

const ISO = (a: number, m: number, d: number) => {
  const f = new Date(Date.UTC(a, m - 1, d));
  return f.getUTCFullYear() === a && f.getUTCMonth() === m - 1 && f.getUTCDate() === d ? f.toISOString().slice(0, 10) : null;
};
const finDeMes = (a: number, m: number) => (m >= 1 && m <= 12 ? new Date(Date.UTC(a, m, 0)).toISOString().slice(0, 10) : null);
const anio = (y: number) => (y < 100 ? 2000 + y : y);

/** Fecha de vencimiento: 2027-08-31 · 31/08/2027 · 31-08-27 · 08/2027 (fin de mes) · número de serie de Excel. */
export function fecha(v: unknown): string | null | undefined {
  if (v instanceof Date) return isNaN(v.getTime()) ? null : v.toISOString().slice(0, 10);
  if (typeof v === "number") {
    if (v > 20000 && v < 80000) return new Date(Date.UTC(1899, 11, 30) + Math.round(v) * 86400000).toISOString().slice(0, 10);
    return null;
  }
  const s = texto(v);
  if (!s) return undefined;
  let m = s.match(/^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T].*)?$/);
  if (m) return ISO(+m[1], +m[2], +m[3]);
  m = s.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2}|\d{4})(?:[ T].*)?$/);
  if (m) return ISO(anio(+m[3]), +m[2], +m[1]);
  m = s.match(/^(\d{1,2})[-/.](\d{4}|\d{2})$/);
  if (m) return finDeMes(anio(+m[2]), +m[1]);
  m = s.match(/^(\d{4})[-/.](\d{1,2})$/);
  if (m) return finDeMes(+m[1], +m[2]);
  if (/^\d{5}$/.test(s)) return fecha(Number(s));
  return null;
}

/** IVA en porcentaje: 0 · 5 · 19 (acepta 19 %, 0,19, «excluido», «exento»). null si no es una tarifa válida. */
export function iva(v: unknown): number | null {
  const s = texto(v).toLowerCase();
  if (!s || /^(excluido|exento|no|n\/a|na|sin iva|e|x)$/.test(s)) return 0;
  const n = numero(v);
  if (n === undefined) return 0;
  if (Number.isNaN(n)) return null;
  const pct = n > 0 && n < 1 ? Math.round(n * 100) : Math.round(n);
  return [0, 5, 19].includes(pct) ? pct : null;
}

/** Código de barras: dígitos (8 a 14). Excel a veces lo convierte en número o en notación científica (7,70E+12). */
export function codigoBarras(v: unknown): { ean: string; aviso?: string } {
  if (typeof v === "number") { const s = Number.isInteger(v) ? String(v) : ""; return /^\d{8,14}$/.test(s) ? { ean: s } : { ean: "", aviso: s ? undefined : "código de barras no válido: se ignora" }; }
  const s = texto(v).replace(/^'/, "");
  if (!s) return { ean: "" };
  if (/e\+?\d+$/i.test(s)) return { ean: "", aviso: "Excel dañó el código de barras (lo dejó como 7,7E+12): se carga sin código. Para conservarlo, dale a esa columna formato «Texto»" };
  const d = s.replace(/[\s-]/g, "");
  if (/^\d{8,14}$/.test(d)) return { ean: d };
  return { ean: "", aviso: `«${s.slice(0, 20)}» no es un código de barras (8 a 14 dígitos): se carga sin código` };
}

const sinTildes = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").trim();
/** Marca sí/no de una celda: sí · si · x · 1 · verdadero · true · s · yes (true); no · 0 · n · falso · false · vacío (false).
 *  undefined = celda vacía; null = no se entiende. */
export function siNo(v: unknown): boolean | null | undefined {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v === 1 ? true : v === 0 ? false : null;
  const s = sinTildes(texto(v));
  if (!s) return undefined;
  if (/^(si|s|x|1|true|verdadero|yes|y|ok|✓|✔)$/.test(s)) return true;
  if (/^(no|n|0|false|falso|-|na|n\/a)$/.test(s)) return false;
  return null;
}
/** Venta con fórmula y control especial a partir de las dos columnas (cualquiera puede faltar). La columna de fórmula
 *  también acepta la «condición de venta» de otros sistemas: «Venta libre», «Con fórmula médica», «Control especial». */
export function marcasDispensacion(formula: unknown, control: unknown): { requiere_formula?: boolean; control_especial?: boolean; error?: string } {
  const r: { requiere_formula?: boolean; control_especial?: boolean; error?: string } = {};
  const tf = sinTildes(texto(formula)), tc = sinTildes(texto(control));
  const negado = (t: string) => /^no\b|\bsin (formula|receta|control)|no requiere|libre|\botc\b/.test(t);
  if (tf) {
    const b = siNo(formula);
    if (b !== null && b !== undefined) r.requiere_formula = b;
    else if (negado(tf)) r.requiere_formula = false;
    else if (/control/.test(tf)) { r.requiere_formula = true; r.control_especial = true; }
    else if (/formula|receta|\brx\b|prescripcion/.test(tf)) r.requiere_formula = true;
    else r.error = `«${texto(formula).slice(0, 30)}» en venta con fórmula no se entiende: usa sí o no`;
  }
  if (tc) {
    const b = siNo(control) ?? (negado(tc) ? false : /control/.test(tc) ? true : null);
    if (b === null) r.error ??= `«${texto(control).slice(0, 30)}» en control especial no se entiende: usa sí o no`;
    else { r.control_especial = b; if (b) r.requiere_formula = true; }
  }
  return r;
}

export const claveNombre = (nombre: string, lab: string) =>
  `${nombre}|${lab}`.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9|]+/g, " ").replace(/\s+/g, " ").trim();

// ───────────── Filas → productos ─────────────
export type Fila = Partial<Record<Campo, unknown>>;
export type Lote = { lote: string; vence: string | null; unidades: number; costo?: number; filas: number[] };
export type Producto = {
  clave: string; fila: number; nombre: string; ean: string; laboratorio: string; iva: number; unidades_por_caja: number;
  precio_caja: number; precio_unidad: number | null; pu_archivo: number | null; stock_minimo: number; registro_sanitario: string; lotes: Lote[];
  /** undefined = el archivo no lo dice (al actualizar no se cambia). */
  requiere_formula?: boolean; control_especial?: boolean;
};
export type Nota = { fila: number; texto: string };
export type Lectura = { productos: Producto[]; errores: Nota[]; avisos: Nota[]; columnas: Set<Campo> };

/** Convierte las filas (con los campos de Regenta como claves) en productos únicos con sus lotes.
 *  Errores: impiden importar (nombre o precio que faltan, datos imposibles). Avisos: se importa y se informa qué se hizo. */
export function leerFilas(filas: Fila[], hoy: string, primeraFila = 2): Lectura {
  const errores: Nota[] = [], avisos: Nota[] = [];
  const columnas = new Set<Campo>();
  for (const f of filas) for (const c of CAMPOS) if (c in f) columnas.add(c);
  const porClave = new Map<string, Producto>();
  const productos: Producto[] = [];

  filas.forEach((f, i) => {
    const n = i + primeraFila;
    const err = (t: string) => errores.push({ fila: n, texto: t });
    const nombre = texto(f.nombre).slice(0, 200);
    const valores = CAMPOS.filter((c) => texto(f[c]) !== "");
    if (!valores.length) return; // fila vacía
    if (nombre.length < 3) return err(nombre ? "el nombre es muy corto (mínimo 3 letras)" : "falta el nombre del producto");

    const { ean, aviso } = codigoBarras(f.codigo_barras);
    if (aviso) avisos.push({ fila: n, texto: aviso });
    const laboratorio = texto(f.laboratorio).slice(0, 120);
    const t = iva(f.iva);
    if (t === null) return err(`IVA «${texto(f.iva)}» no válido: usa 0, 5 o 19`);

    let upc = numero(f.unidades_por_caja);
    if (upc !== undefined && (Number.isNaN(upc) || upc < 0 || upc > 100000)) return err(`unidades por caja «${texto(f.unidades_por_caja)}» no válidas`);
    upc = Math.max(1, Math.round(upc ?? 1));

    const pc = numero(f.precio_caja), pu = numero(f.precio_unidad);
    if (pc !== undefined && Number.isNaN(pc)) return err(`precio de venta «${texto(f.precio_caja)}» no es un número`);
    if (pu !== undefined && Number.isNaN(pu)) return err(`precio por unidad «${texto(f.precio_unidad)}» no es un número`);
    let precioCaja = pc !== undefined && pc > 0 ? Math.round(pc) : 0;
    let precioUnidad = pu !== undefined && pu > 0 ? Math.round(pu) : null;
    const puArchivo = precioUnidad;
    if (!precioCaja && precioUnidad) { precioCaja = precioUnidad * upc; if (upc > 1) avisos.push({ fila: n, texto: `sin precio de caja: se calcula ${upc} × precio por unidad` }); }
    if (!precioCaja) return err("falta el precio de venta");
    if (precioCaja > 100_000_000) return err("el precio de venta es demasiado alto: revisa que no tenga decimales de más");
    if (upc === 1) precioUnidad = null;
    else if (precioUnidad && precioUnidad > precioCaja) { avisos.push({ fila: n, texto: "el precio por unidad era mayor que el de la caja: se deja sin venta por unidad" }); precioUnidad = null; }

    const minimo = numero(f.stock_minimo);
    const cant = numero(f.cantidad_unidades);
    if (cant !== undefined && Number.isNaN(cant)) return err(`existencias «${texto(f.cantidad_unidades)}» no es un número`);
    if (cant !== undefined && cant > 1_000_000) return err("existencias demasiado altas: revisa la cantidad");
    if (cant !== undefined && !Number.isInteger(cant)) return err(`existencias «${texto(f.cantidad_unidades)}»: van en unidades enteras`);
    const vence = fecha(f.vence);
    if (vence === null) return err(`vencimiento «${texto(f.vence)}» no se entiende: escríbelo como 31/08/2027`);
    const costo = numero(f.costo_unidad);
    if (costo !== undefined && (Number.isNaN(costo) || costo < 0)) return err(`costo «${texto(f.costo_unidad)}» no válido`);

    const marcas = marcasDispensacion(f.requiere_formula, f.control_especial);
    if (marcas.error) return err(marcas.error);

    const clave = ean ? `e:${ean}` : `n:${claveNombre(nombre, laboratorio)}`;
    let p = porClave.get(clave);
    if (!p) {
      p = { clave, fila: n, nombre, ean, laboratorio, iva: t, unidades_por_caja: upc, precio_caja: precioCaja, precio_unidad: precioUnidad, pu_archivo: puArchivo,
        stock_minimo: minimo !== undefined && !Number.isNaN(minimo) && minimo > 0 ? Math.min(100000, Math.round(minimo)) : 0,
        registro_sanitario: texto(f.registro_sanitario).toUpperCase().slice(0, 60), lotes: [],
        ...(marcas.requiere_formula !== undefined ? { requiere_formula: marcas.requiere_formula } : {}),
        ...(marcas.control_especial !== undefined ? { control_especial: marcas.control_especial } : {}) };
      porClave.set(clave, p); productos.push(p);
    } else if (!(cant && cant > 0)) {
      avisos.push({ fila: n, texto: `repite el producto de la fila ${p.fila}: se omite` });
      return;
    } else if (p.precio_caja !== precioCaja) {
      avisos.push({ fila: n, texto: `mismo producto que la fila ${p.fila} con otro precio: queda el de la fila ${p.fila} y se suman sus existencias` });
    }

    if (cant === undefined || cant === 0) return;
    if (cant < 0) { avisos.push({ fila: n, texto: "existencia negativa en el sistema anterior: se carga en 0" }); return; }
    if (vence && vence < hoy) { avisos.push({ fila: n, texto: `lote vencido (${vence.split("-").reverse().join("/")}): no se cargan sus ${cant} unidades. Sepáralas para devolución o destrucción` }); return; }
    let lote = texto(f.lote).toUpperCase().slice(0, 40);
    if (!lote) { lote = "INICIAL"; avisos.push({ fila: n, texto: "sin lote: se carga como lote «INICIAL»" }); }
    const existente = p.lotes.find((l) => l.lote === lote);
    if (existente) {
      if ((existente.vence ?? "") !== (vence ?? "") && existente.vence && vence) return err(`el lote ${lote} aparece en la fila ${existente.filas[0]} con otro vencimiento`);
      existente.unidades += cant; existente.vence ??= vence ?? null; existente.filas.push(n);
      avisos.push({ fila: n, texto: `mismo lote ${lote} que la fila ${existente.filas[0]}: se suman las cantidades` });
    } else p.lotes.push({ lote, vence: vence ?? null, unidades: cant, ...(costo !== undefined ? { costo } : {}), filas: [n] });
  });
  // Mismo producto escrito con código de barras en unas filas y sin él en otras (mismo nombre y laboratorio): uno solo.
  const conEan = new Map<string, Producto>();
  for (const x of productos) if (x.ean) { const k = claveNombre(x.nombre, x.laboratorio); if (!conEan.has(k)) conEan.set(k, x); }
  const unidos = productos.filter((x) => {
    if (x.ean) return true;
    const destino = conEan.get(claveNombre(x.nombre, x.laboratorio));
    if (!destino) return true;
    avisos.push({ fila: x.fila, texto: `es el mismo producto de la fila ${destino.fila} (allí con código de barras): se unen` });
    for (const l of x.lotes) {
      const y = destino.lotes.find((z) => z.lote === l.lote);
      if (!y) destino.lotes.push(l);
      else if (y.vence && l.vence && y.vence !== l.vence) errores.push({ fila: l.filas[0], texto: `el lote ${l.lote} aparece en la fila ${y.filas[0]} con otro vencimiento` });
      else { y.unidades += l.unidades; y.vence ??= l.vence; y.filas.push(...l.filas); }
    }
    return false;
  });
  return { productos: unidos, errores, avisos, columnas };
}
