// Factura del proveedor → compra (08/11/2026). Lógica pura, sin dependencias ni red: se prueba en
// tests/factura-proveedor.test.mjs con el ZIP real de un proveedor y facturas de prueba.
//  · ZIP de la DIAN (contenedor .zip con el AttachedDocument y, a veces, el PDF): se abre con zlib de Node.
//  · AttachedDocument → el documento de adentro (Invoice, CreditNote o DebitNote, en CDATA) con su CUFE/CUDE.
//  · Lote y vencimiento: de los campos UBL (LotIdentification) o, como hacen muchos programas de facturación,
//    de la descripción del producto («(FECHA VENCIMIENTO: 18/04/2029)(LOTE: 26312018)»).
// Lo mismo devuelve la lectura de una foto o PDF con Regenta IA, así el resto del flujo es uno solo.
import { inflateRawSync } from "node:zlib";

export type TipoDocumento = "factura" | "nota_credito" | "nota_debito";
export type LineaLeida = {
  n: number; codigo: string | null; ean: string | null; descripcion: string; nombre: string;
  cantidad: number; precio: number | null; descuento_pct: number; iva_pct: number; base: number | null;
  lote: string | null; vence: string | null; bonificada: boolean;
};
export type DocumentoLeido = {
  tipo: TipoDocumento; numero: string; fecha: string | null; cufe: string | null; vence_pago: string | null;
  proveedor: { nombre: string; nit: string | null; dv: string | null };
  comprador: { nombre: string | null; nit: string | null };
  referencia: string | null; // factura que corrige una nota
  lineas: LineaLeida[];
  totales: { base: number | null; iva: number | null; descuentos: number | null; total: number | null };
  origen: "xml" | "ia";
};

// ── ZIP ───────────────────────────────────────────────────────────────────────────────────────────────────────
/** Archivos de un ZIP (solo «guardado» y «deflate», que es lo que usan los proveedores). Tope: 40 archivos de 15 MB. */
export function abrirZip(zip: Uint8Array): { nombre: string; datos: Uint8Array }[] {
  const b = Buffer.from(zip.buffer, zip.byteOffset, zip.byteLength);
  let fin = -1;
  for (let i = b.length - 22; i >= Math.max(0, b.length - 65557); i--) if (b.readUInt32LE(i) === 0x06054b50) { fin = i; break; }
  if (fin < 0) throw new Error("El archivo no es un ZIP válido");
  const total = b.readUInt16LE(fin + 10);
  let p = b.readUInt32LE(fin + 16);
  const salida: { nombre: string; datos: Uint8Array }[] = [];
  for (let k = 0; k < total && k < 40; k++) {
    if (b.readUInt32LE(p) !== 0x02014b50) throw new Error("El ZIP está dañado");
    const metodo = b.readUInt16LE(p + 10), comprimido = b.readUInt32LE(p + 20), tamano = b.readUInt32LE(p + 24);
    const ln = b.readUInt16LE(p + 28), le = b.readUInt16LE(p + 30), lc = b.readUInt16LE(p + 32), local = b.readUInt32LE(p + 42);
    const nombre = b.toString("utf8", p + 46, p + 46 + ln);
    p += 46 + ln + le + lc;
    if (nombre.endsWith("/")) continue;
    if (tamano > 15 * 1024 * 1024) throw new Error("Un archivo dentro del ZIP es demasiado grande");
    const ini = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
    const crudo = b.subarray(ini, ini + comprimido);
    if (metodo === 0) salida.push({ nombre, datos: new Uint8Array(crudo) });
    else if (metodo === 8) salida.push({ nombre, datos: new Uint8Array(inflateRawSync(crudo, { maxOutputLength: 15 * 1024 * 1024 })) });
  }
  return salida;
}

// ── XML mínimo (UBL de la DIAN) ──────────────────────────────────────────────────────────────────────────────
type Nodo = { n: string; a: Record<string, string>; c: Nodo[]; t: string };
const ENT: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'" };
const entidades = (s: string) => s.replace(/&(#x[0-9a-f]+|#\d+|\w+);/gi, (m, e: string) =>
  e[0] === "#" ? String.fromCodePoint(e[1] === "x" || e[1] === "X" ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10)) : ENT[e] ?? m);
const local = (n: string) => n.slice(n.indexOf(":") + 1);

/** Árbol del XML con nombres sin prefijo. No ejecuta ni descarga nada (sin DTD ni entidades externas). */
export function leerXml(xml: string): Nodo {
  const raiz: Nodo = { n: "#", a: {}, c: [], t: "" };
  const pila = [raiz];
  let i = 0;
  while (i < xml.length) {
    const lt = xml.indexOf("<", i);
    if (lt < 0) break;
    if (lt > i) pila[pila.length - 1].t += entidades(xml.slice(i, lt));
    if (xml.startsWith("<![CDATA[", lt)) { const f = xml.indexOf("]]>", lt); pila[pila.length - 1].t += xml.slice(lt + 9, f < 0 ? xml.length : f); i = f < 0 ? xml.length : f + 3; continue; }
    if (xml.startsWith("<!--", lt)) { const f = xml.indexOf("-->", lt); i = f < 0 ? xml.length : f + 3; continue; }
    if (xml[lt + 1] === "?" || xml[lt + 1] === "!") { const f = xml.indexOf(">", lt); i = f < 0 ? xml.length : f + 1; continue; }
    const gt = xml.indexOf(">", lt);
    if (gt < 0) break;
    const cuerpo = xml.slice(lt + 1, gt);
    i = gt + 1;
    if (cuerpo[0] === "/") { if (pila.length > 1) pila.pop(); continue; }
    const vacio = cuerpo.endsWith("/");
    const m = /^([^\s/>]+)/.exec(cuerpo);
    if (!m) continue;
    const nodo: Nodo = { n: local(m[1]), a: {}, c: [], t: "" };
    for (const at of cuerpo.slice(m[1].length).matchAll(/([^\s=/]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) nodo.a[local(at[1])] = entidades(at[3] ?? at[4] ?? "");
    pila[pila.length - 1].c.push(nodo);
    if (!vacio) pila.push(nodo);
  }
  return raiz;
}
const hijo = (n: Nodo | undefined, ...ruta: string[]): Nodo | undefined => ruta.reduce<Nodo | undefined>((x, k) => x?.c.find((y) => y.n === k), n);
const hijos = (n: Nodo | undefined, k: string) => n?.c.filter((y) => y.n === k) ?? [];
const texto = (n: Nodo | undefined, ...ruta: string[]) => { const v = hijo(n, ...ruta)?.t.trim(); return v ? v : null; };
const num = (v: string | null | undefined) => { if (v === null || v === undefined || v === "") return null; const x = Number(v); return Number.isFinite(x) ? x : null; };
const r2 = (n: number) => Math.round(n * 100) / 100;

// ── Lote y vencimiento dentro de la descripción ─────────────────────────────────────────────────────────────
const RE_LOTE = /\b(?:LOTE|LOT)\b\.?\s*(?:N[O°º.]*\s*)?[:#]?\s*([A-Z0-9][A-Z0-9\-/]{0,29})/i;
const RE_VENCE = /\b(?:F\.?\s*V\.?|FECHA\s+(?:DE\s+)?VENC(?:IMIENTO|E)?|VENC(?:IMIENTO|E)?|VTO|EXP)\b\.?\s*:?\s*(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{1,4})/i;

/** dd/mm/aaaa, aaaa-mm-dd o dd/mm/aa → aaaa-mm-dd (null si no es una fecha real). */
export function fechaIso(a: string, b: string, c: string): string | null {
  let d: number, m: number, y: number;
  if (a.length === 4) { y = +a; m = +b; d = +c; } else { d = +a; m = +b; y = c.length === 2 ? 2000 + +c : +c; }
  if (!(y >= 2000 && y <= 2100 && m >= 1 && m <= 12 && d >= 1 && d <= 31)) return null;
  const f = new Date(Date.UTC(y, m - 1, d));
  return f.getUTCMonth() === m - 1 ? f.toISOString().slice(0, 10) : null;
}

/** Saca el lote y el vencimiento de la descripción y deja el nombre limpio para buscarlo en el catálogo. */
export function loteEnDescripcion(desc: string) {
  const lote = RE_LOTE.exec(desc)?.[1]?.replace(/[\-/]+$/, "").toUpperCase() ?? null;
  const v = RE_VENCE.exec(desc);
  const vence = v ? fechaIso(v[1], v[2], v[3]) : null;
  const nombre = desc
    .replace(/\(\s*(?:FECHA\s+(?:DE\s+)?)?VENC[^)]*\)/gi, " ").replace(/\(\s*(?:LOTE|LOT)[^)]*\)/gi, " ")
    .replace(RE_VENCE, " ").replace(RE_LOTE, " ")
    .replace(/\(\s*\)/g, " ").replace(/\s+/g, " ").trim();
  return { lote: lote && lote.length >= 2 ? lote : null, vence, nombre: nombre || desc.trim() };
}

// ── Precio, descuento y lote de cada línea ──────────────────────────────────────────────────────────────────
/** «9.370,00», «8,808.00», «6,00» o «44039» → número (null si no es un número). */
export function numeroLocal(v: string): number | null {
  const t = v.replace(/[$\s]/g, "");
  if (!/^\d{1,3}([.,]\d{3})*([.,]\d{1,4})?$|^\d+([.,]\d{1,4})?$/.test(t)) return null;
  const coma = t.lastIndexOf(","), punto = t.lastIndexOf(".");
  const dec = Math.max(coma, punto);
  const decimales = dec >= 0 && t.length - dec - 1 !== 3 ? t[dec] : null; // un separador seguido de 3 cifras es de miles
  const limpio = decimales ? t.slice(0, dec).replace(/[.,]/g, "") + "." + t.slice(dec + 1) : t.replace(/[.,]/g, "");
  const n = Number(limpio);
  return Number.isFinite(n) ? n : null;
}
const cuadra = (a: number, b: number) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * 0.0005);

/**
 * Precio unitario sin IVA y descuento %, comprobados contra el valor de la línea (LineExtensionAmount):
 *  1. descuento explícito (AllowanceCharge) sobre el precio;  2. precio de lista y descuento en campos adicionales del
 *  proveedor (p. ej. «9.370,00» y «6,00» → 8.808 × 5 = 44.039);  3. PriceAmount por unidad o por la cantidad base
 *  (hay emisores que repiten la cantidad en BaseQuantity);  4. si nada cuadra, el valor de la línea entre la cantidad.
 */
export function precioDeLinea(x: { cantidad: number; base: number | null; precioXml: number | null; bq: number; desc: number; conDescuento: boolean; props: { nombre: string; valor: string }[] }) {
  const { cantidad: q, base, precioXml, bq } = x;
  if (!q || base === null) return { precio: precioXml === null ? null : r2(precioXml / bq), descuento: x.desc };
  if (base === 0) return { precio: 0, descuento: 0 };
  const opciones = precioXml === null ? [] : [precioXml, precioXml / bq];
  if (x.conDescuento) for (const p of opciones) if (cuadra(p * q * (1 - x.desc / 100), base)) return { precio: r2(p), descuento: x.desc };
  const nums = x.props.map((p) => numeroLocal(p.valor)).filter((n): n is number => n !== null && n > 0);
  for (const p of nums) for (const d of nums) if (d < 100 && p > d && cuadra(p * q * (1 - d / 100), base)) return { precio: r2(p), descuento: r2(d) };
  for (const p of opciones) if (cuadra(p * q, base)) return { precio: r2(p), descuento: 0 };
  return { precio: r2(base / q), descuento: 0 };
}

// Campos adicionales con el lote o el vencimiento: por su nombre («Lote», «Fecha vencimiento») o, en proveedores
// conocidos que usan campos numerados, por el campo que su factura impresa muestra como LOTE.
const CAMPOS_PROVEEDOR: Record<string, { lote?: string; vence?: string }> = {
  "890941663": { lote: "Opcional32" }, // Distribuidora Pasteur: comprobado con su PDF (columna LOTE), 08/11/2026
};
export function loteEnPropiedades(props: { nombre: string; valor: string }[], nit: string | null) {
  const conocido = nit ? CAMPOS_PROVEEDOR[nit] : undefined;
  const por = (re: RegExp, exacto?: string) => props.find((p) => (exacto && p.nombre === exacto) || re.test(sinTildes(p.nombre)))?.valor ?? null;
  const lote = por(/^(n(o|umero)?\.?\s*(de\s*)?)?lote|^lot(e)?\b|batch/, conocido?.lote);
  const v = por(/venc|expir|caduc|\bf\.?\s*v\b/, conocido?.vence);
  const m = v ? /(\d{1,4})[/\-.](\d{1,2})[/\-.](\d{1,4})/.exec(v) : null;
  return { lote: lote && /^[A-Z0-9][A-Z0-9\-/]{1,29}$/i.test(lote) ? lote.toUpperCase() : null, vence: m ? fechaIso(m[1], m[2], m[3]) : null };
}

// ── Documento UBL ───────────────────────────────────────────────────────────────────────────────────────────
const TIPOS: Record<string, { tipo: TipoDocumento; linea: string; cantidad: string }> = {
  Invoice: { tipo: "factura", linea: "InvoiceLine", cantidad: "InvoicedQuantity" },
  CreditNote: { tipo: "nota_credito", linea: "CreditNoteLine", cantidad: "CreditedQuantity" },
  DebitNote: { tipo: "nota_debito", linea: "DebitNoteLine", cantidad: "DebitedQuantity" },
};

function tercero(parte: Nodo | undefined) {
  const p = hijo(parte, "Party");
  const esquema = hijo(p, "PartyTaxScheme"), legal = hijo(p, "PartyLegalEntity");
  const idNodo = hijo(esquema, "CompanyID") ?? hijo(legal, "CompanyID");
  const nombre = texto(esquema, "RegistrationName") ?? texto(legal, "RegistrationName") ?? texto(p, "PartyName", "Name");
  const nit = idNodo?.t.trim().replace(/\D/g, "") || null;
  return { nombre, nit, dv: idNodo?.a.schemeID?.trim() || null };
}

/** Lee el XML de la DIAN (AttachedDocument o el documento suelto). Error claro si no es una factura electrónica. */
export function leerDocumento(xml: string): DocumentoLeido {
  let raiz = leerXml(xml).c[0];
  if (!raiz) throw new Error("El archivo no es un XML legible");
  let cufeContenedor: string | null = null;
  if (raiz.n === "AttachedDocument") {
    const desc = hijo(raiz, "Attachment", "ExternalReference", "Description")?.t ?? "";
    cufeContenedor = texto(hijo(raiz, "ParentDocumentLineReference"), "DocumentReference", "UUID");
    const interior = desc.trim();
    if (!/<(?:\w+:)?(Invoice|CreditNote|DebitNote)\b/.test(interior)) throw new Error("El contenedor de la DIAN no trae la factura adentro");
    raiz = leerXml(interior).c[0];
  }
  const def = TIPOS[raiz?.n ?? ""];
  if (!def) throw new Error("Este XML no es una factura electrónica (ni nota crédito o débito)");
  const prov = tercero(hijo(raiz, "AccountingSupplierParty"));
  const nitProveedor = prov.nit;
  const lineas: LineaLeida[] = hijos(raiz, def.linea).map((l, k) => {
    const item = hijo(l, "Item");
    const descripcion = (texto(item, "Description") ?? texto(item, "Name") ?? "").replace(/\s+/g, " ").trim();
    const std = hijo(item, "StandardItemIdentification", "ID");
    const vendedor = texto(item, "SellersItemIdentification", "ID");
    const codigoStd = std?.t.trim() || null;
    // GTIN (schemeID 010) o un código de 8 a 14 dígitos: código de barras.
    const ean = codigoStd && (std?.a.schemeID === "010" || /^\d{8,14}$/.test(codigoStd)) ? codigoStd : vendedor && /^\d{8,14}$/.test(vendedor) ? vendedor : null;
    const cantidad = num(texto(l, def.cantidad)) ?? 0;
    const base = num(texto(l, "LineExtensionAmount"));
    const precioNodo = hijo(l, "Price");
    const bq = num(texto(precioNodo, "BaseQuantity")) || 1;
    const precioXml = num(texto(precioNodo, "PriceAmount"));
    const props = hijos(item, "AdditionalItemProperty").map((x) => ({ nombre: (texto(x, "Name") ?? "").trim(), valor: (texto(x, "Value") ?? "").trim() })).filter((x) => x.valor);
    let desc = 0, conDescuento = false;
    for (const ac of hijos(l, "AllowanceCharge")) {
      if (texto(ac, "ChargeIndicator") !== "false") continue;
      const pct = num(texto(ac, "MultiplierFactorNumeric")), monto = num(texto(ac, "Amount")), sobre = num(texto(ac, "BaseAmount"));
      const pBruto = precioXml === null ? 0 : precioXml / bq;
      desc += pct ?? (monto && (sobre || (pBruto && cantidad ? pBruto * cantidad : 0)) ? (monto / (sobre || pBruto * cantidad)) * 100 : 0);
      conDescuento = true;
    }
    const { precio, descuento } = precioDeLinea({ cantidad, base, precioXml, bq, desc, conDescuento, props });    let iva = 0;
    for (const tt of hijos(l, "TaxTotal")) for (const st of hijos(tt, "TaxSubtotal")) {
      const cat = hijo(st, "TaxCategory");
      if (texto(cat, "TaxScheme", "ID") === "01") iva = num(texto(cat, "Percent")) ?? num(texto(st, "Percent")) ?? 0;
    }
    const instancia = hijo(item, "ItemInstance", "LotIdentification");
    const enDesc = loteEnDescripcion(descripcion);
    const extra = loteEnPropiedades(props, nitProveedor);
    const venceUbl = texto(instancia, "ExpiryDate");
    return {
      n: k + 1, codigo: vendedor ?? codigoStd, ean, descripcion, nombre: enDesc.nombre, cantidad,
      precio, descuento_pct: r2(Math.min(99.99, Math.max(0, descuento))), iva_pct: iva, base,
      lote: texto(instancia, "LotNumberID")?.toUpperCase() ?? extra.lote ?? enDesc.lote,
      vence: (venceUbl && /^\d{4}-\d{2}-\d{2}/.test(venceUbl) ? venceUbl.slice(0, 10) : null) ?? extra.vence ?? enDesc.vence,
      bonificada: texto(hijo(l, "PricingReference"), "AlternativeConditionPrice", "PriceTypeCode") === "01" || (base === 0 && cantidad > 0),
    };
  });
  const tot = hijo(raiz, "LegalMonetaryTotal");
  const ivaTotal = hijos(raiz, "TaxTotal").reduce((a, t) => a + (hijos(t, "TaxSubtotal").some((s) => texto(hijo(s, "TaxCategory"), "TaxScheme", "ID") === "01") ? num(texto(t, "TaxAmount")) ?? 0 : 0), 0);
  return {
    tipo: def.tipo,
    numero: texto(raiz, "ID") ?? "",
    fecha: texto(raiz, "IssueDate"),
    cufe: texto(raiz, "UUID") ?? cufeContenedor,
    vence_pago: texto(raiz, "PaymentMeans", "PaymentDueDate") ?? texto(raiz, "DueDate"),
    proveedor: { nombre: prov.nombre ?? "Proveedor sin nombre", nit: prov.nit, dv: prov.dv },
    comprador: (() => { const t = tercero(hijo(raiz, "AccountingCustomerParty")); return { nombre: t.nombre, nit: t.nit }; })(),
    referencia: texto(raiz, "BillingReference", "InvoiceDocumentReference", "ID") ?? texto(raiz, "DiscrepancyResponse", "ReferenceID"),
    lineas,
    totales: { base: num(texto(tot, "LineExtensionAmount")), iva: r2(ivaTotal), descuentos: num(texto(tot, "AllowanceTotalAmount")), total: num(texto(tot, "PayableAmount")) },
    origen: "xml",
  };
}

/** Del archivo subido (ZIP o XML) al documento. Un ZIP puede traer varias facturas: se devuelven todas. */
export function leerArchivoXml(nombre: string, datos: Uint8Array): DocumentoLeido[] {
  const xmls = /\.zip$/i.test(nombre) || (datos[0] === 0x50 && datos[1] === 0x4b)
    ? abrirZip(datos).filter((f) => /\.xml$/i.test(f.nombre)).map((f) => Buffer.from(f.datos).toString("utf8"))
    : [Buffer.from(datos).toString("utf8")];
  if (!xmls.length) throw new Error("El ZIP no trae el XML de la factura (solo PDF). Sube el XML, o el PDF/foto para leerlo con Regenta IA");
  const docs: DocumentoLeido[] = [];
  let ultimo: unknown = null;
  for (const x of xmls) { try { docs.push(leerDocumento(x.replace(/^﻿/, ""))); } catch (e) { ultimo = e; } }
  if (!docs.length) throw ultimo instanceof Error ? ultimo : new Error("No se pudo leer la factura");
  return docs;
}

// ── Emparejar con el catálogo ──────────────────────────────────────────────────────────────────────────────
export type ProductoCatalogo = { id: string; nombre: string; laboratorio: string | null; ean: string | null; codigos: string[] };
const VACIAS = new Set("x de del la el en con por para y caja cajas cj cja und unid unidad unidades frasco fco sobre sobres blister uso via oral topico topica gr g mg ml mcg lote fecha vencimiento vence f v rx".split(" "));
// Formas farmacéuticas: distinguen (jarabe ≠ tabletas), con sus abreviaturas de factura.
const FORMAS: Record<string, string> = { tab: "tableta", tabs: "tableta", tbl: "tableta", tabletas: "tableta", comp: "tableta", comprimido: "tableta", comprimidos: "tableta",
  cap: "capsula", caps: "capsula", capsulas: "capsula", sol: "solucion", soluc: "solucion", susp: "suspension", jbe: "jarabe", crm: "crema", ung: "unguento", amp: "ampolla", ampollas: "ampolla", grageas: "gragea" };
// Palabras que dicen la forma, no el producto: por sí solas no hacen que dos productos sean el mismo.
const SOLO_FORMA = new Set([...Object.values(FORMAS), "crema", "gel", "gotas", "polvo", "inyectable", "locion", "shampoo", "ovulos", "parches", "spray", "tableta", "capsula", "jarabe", "suspension", "solucion"]);
export const sinTildes = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
/** Palabras con significado (sin tildes, sin relleno) y las cantidades pegadas a su unidad («500mg», «120ml», «x30»). */
export function fichas(s: string): string[] {
  const t = sinTildes(s).replace(/(\d)[.,](\d)/g, "$1$2").replace(/(\d+)\s*(mg|ml|g|gr|mcg|ui|%)\b/g, "$1$2").replace(/\bx\s*(\d+)/g, "x$1");
  return [...new Set(t.split(/[^a-z0-9%]+/).map((w) => FORMAS[w] ?? w).filter((w) => w.length >= 2 && !VACIAS.has(w)))];
}
/** Puntaje 0–1 entre la descripción de la factura y un producto del catálogo. */
export function parecido(desc: string, p: Pick<ProductoCatalogo, "nombre" | "laboratorio">): number {
  const a = fichas(desc), b = fichas(`${p.nombre} ${p.laboratorio ?? ""}`);
  if (!a.length || !b.length) return 0;
  const bs = new Set(b);
  const pesa = (w: string) => (/\d/.test(w) ? 1.5 : w.length >= 5 ? 1.2 : 1);
  const comun = a.filter((w) => bs.has(w) || [...bs].some((x) => x.length >= 5 && w.length >= 5 && (x.startsWith(w) || w.startsWith(x))));
  // Sin ninguna palabra del nombre en común (solo cifras como «500mg» o la forma, «tableta») no es el mismo producto.
  if (!comun.some((w) => !/\d/.test(w) && !SOLO_FORMA.has(w))) return 0;
  const total = a.reduce((s, w) => s + pesa(w), 0), hay = comun.reduce((s, w) => s + pesa(w), 0);
  // Cantidades distintas (500mg vs 1g, x10 vs x30) bajan mucho: es otro producto.
  const numA = a.filter((w) => /\d/.test(w)), numB = b.filter((w) => /\d/.test(w));
  const choque = numA.length && numB.length && !numA.some((w) => bs.has(w)) ? 0.5 : 1;
  const nb = Math.min(1, hay / Math.max(1, b.reduce((s, w) => s + pesa(w), 0)));
  return r2(((hay / total) * 0.6 + nb * 0.4) * choque);
}
