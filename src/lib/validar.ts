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
});
export type ProductoEntrada = z.infer<typeof ProductoEntrada>;

export const primerError = (e: z.ZodError) => e.issues[0]?.message ?? "Datos no válidos";
