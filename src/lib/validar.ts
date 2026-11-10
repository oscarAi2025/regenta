import "./zod-es";
import { z } from "zod";

/** Producto tal como lo crea o edita la droguería. Precios con IVA, en pesos. */
export const ProductoEntrada = z.object({
  maestro_id: z.string().uuid().nullish(),
  nombre: z.string().trim().min(3, "Escribe el nombre del producto").max(200),
  laboratorio: z.string().trim().max(120).nullish(),
  ean: z.string().trim().regex(/^\d{8,14}$/, "El código de barras debe tener de 8 a 14 dígitos").nullish().or(z.literal("")),
  iva: z.union([z.literal(0), z.literal(5), z.literal(19)]),
  categoria: z.string().trim().max(80).nullish(),
  unidades_por_caja: z.number().int("Las unidades por caja van en número entero").min(1, "Una caja trae al menos 1 unidad").max(100000, "Revisa las unidades por caja"),
  precio_caja: z.number().int("El precio va en pesos, sin centavos").positive("Pon el precio de venta").max(100_000_000),
  precio_unidad: z.number().int("El precio va en pesos, sin centavos").positive().max(100_000_000).nullish(),
  stock_minimo: z.number().int().min(0).max(100000).default(0),
  registro_sanitario: z.string().trim().max(60).nullish(),
  // Marcas de dispensación (sin enviar = no se cambian). Control especial implica fórmula.
  requiere_formula: z.boolean().optional(),
  control_especial: z.boolean().optional(),
}).refine((p) => !p.precio_unidad || p.precio_unidad <= p.precio_caja, { message: "El precio por unidad no puede ser mayor que el de la caja completa", path: ["precio_unidad"] });
export type ProductoEntrada = z.infer<typeof ProductoEntrada>;

/** Existencias con que entra un producto nuevo: un lote con su fecha de vencimiento (lo que más le importa a una
 *  droguería), la cantidad en unidades y, si quiere, el costo por unidad sin IVA. La fecha la vuelve a revisar la base
 *  (un lote vencido no entra a la venta). */
export const ExistenciaInicial = z.object({
  lote: z.string().trim().min(1, "Escribe el lote").max(60, "El código del lote es muy largo")
    .refine((v) => !/[\p{C}]/u.test(v), "El código del lote tiene caracteres invisibles o saltos de línea"),
  vence: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Escribe la fecha de vencimiento del lote").refine((v) => fechaReal(v), "Esa fecha de vencimiento no existe"),
  unidades: z.number({ invalid_type_error: "Escribe cuántas unidades entran" }).int("Las existencias van en unidades enteras").positive("Escribe cuántas unidades entran").max(1_000_000, "Revisa la cantidad"),
  costo_unidad: z.number().nonnegative("El costo no puede ser negativo").max(100_000_000, "Revisa el costo").nullish(),
});

/** Fecha AAAA-MM-DD que existe de verdad (no 2027-02-31). */
export const fechaReal = (s: string) => { const d = new Date(s + "T00:00:00Z"); return !isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s; };

export const primerError = (e: z.ZodError) => e.issues[0]?.message ?? "Datos no válidos";

/** Dígito de verificación del NIT (algoritmo de la DIAN: módulo 11 con los pesos 3, 7, 13, 17, 19… de derecha a izquierda). */
export function dvNit(nit: string) {
  const pesos = [3, 7, 13, 17, 19, 23, 29, 37, 41, 43, 47, 53, 59, 67, 71];
  const d = nit.replace(/\D/g, "").split("").reverse();
  const s = d.reduce((a, x, i) => a + Number(x) * pesos[i], 0) % 11;
  return String(s > 1 ? 11 - s : s);
}

/** Cliente para factura electrónica. El DV del NIT lo calcula Regenta. */
export const ClienteEntrada = z.object({
  tipo_doc: z.enum(["NIT", "CC", "CE", "PP", "PEP"]),
  numero_doc: z.string().trim().regex(/^[0-9A-Za-z]{3,15}$/, "Escribe el número de documento sin puntos ni guiones"),
  nombre: z.string().trim().min(3, "Escribe el nombre o la razón social").max(200),
  email: z.string().trim().email("El correo no es válido: la DIAN envía la factura a ese correo").max(120).nullish().or(z.literal("")),
  telefono: z.string().trim().max(30).nullish(),
  autoriza_datos: z.boolean().default(false),
}).refine((c) => c.tipo_doc !== "NIT" || /^\d{6,10}$/.test(c.numero_doc), { message: "El NIT va sin dígito de verificación: de 6 a 10 números", path: ["numero_doc"] });

/** NIT sin dígito de verificación, como sea que lo escriban: 900.123.456-7 · 900123456 7 · 9001234567 (si el último dígito
 *  es justo su DV) · 900123456. */
export function nitSinDv(v: unknown): string {
  const s = String(v ?? "").trim();
  const sep = s.match(/^([\d.\s]+?)\s*[-\s]\s*(\d)$/);
  if (sep) { const base = sep[1].replace(/\D/g, ""); if (base.length >= 6) return base; }
  const d = s.replace(/\D/g, "");
  if (d.length === 10 && dvNit(d.slice(0, 9)) === d[9]) return d.slice(0, 9);
  return d;
}
