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
  unidades_por_caja: z.number().int().min(1).max(1000),
  precio_caja: z.number().int("El precio va en pesos, sin centavos").positive("Pon el precio de venta").max(100_000_000),
  precio_unidad: z.number().int("El precio va en pesos, sin centavos").positive().max(100_000_000).nullish(),
  stock_minimo: z.number().int().min(0).max(100000).default(0),
  registro_sanitario: z.string().trim().max(60).nullish(),
}).refine((p) => !p.precio_unidad || p.precio_unidad <= p.precio_caja, { message: "El precio por unidad no puede ser mayor que el de la caja completa", path: ["precio_unidad"] });
export type ProductoEntrada = z.infer<typeof ProductoEntrada>;

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
