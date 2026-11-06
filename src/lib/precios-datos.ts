import "server-only";
import { z } from "zod";
import type { Tx } from "./db";
import { FILTRO_IDS } from "./precios";

/** Petición de un cambio masivo (vista previa o aplicar). La base de datos vuelve a validar todo. */
export const CambioPrecios = z.object({
  filtro: z.discriminatedUnion("tipo", [
    z.object({ tipo: z.literal("laboratorio"), valor: z.string().trim().min(1, "Elige el laboratorio").max(120) }),
    z.object({ tipo: z.literal("categoria"), valor: z.string().trim().min(1, "Elige la categoría").max(120) }),
    z.object({ tipo: z.literal("proveedor"), valor: z.string().uuid("Elige el proveedor") }),
    z.object({ tipo: z.literal("iva"), valor: z.enum(["0", "5", "19"], { errorMap: () => ({ message: "Elige la tarifa de IVA" }) }) }),
    z.object({ tipo: z.literal("productos"), valor: z.array(z.string().uuid()).min(1, "Elige al menos un producto").max(2000, "Máximo 2.000 productos por cambio") }),
  ], { errorMap: () => ({ message: "Elige a qué productos aplicar el cambio" }) }),
  regla: z.object({
    tipo: z.enum(["porcentaje", "margen"], { errorMap: () => ({ message: "Elige la regla" }) }),
    valor: z.number({ invalid_type_error: "Escribe el porcentaje" }).finite(),
  }).refine((r) => r.tipo !== "porcentaje" || (r.valor !== 0 && r.valor >= -90 && r.valor <= 300), { message: "El porcentaje debe estar entre −90 % y +300 % (distinto de cero)" })
    .refine((r) => r.tipo !== "margen" || (r.valor >= 1 && r.valor <= 90), { message: "El margen objetivo debe estar entre 1 % y 90 %" }),
  redondeo: z.union([z.literal(50), z.literal(100)], { errorMap: () => ({ message: "El redondeo debe ser a $50 o a $100" }) }),
  excluir: z.array(z.string().uuid()).max(2000).default([]),
  firma: z.string().max(64).optional(),
  idem_key: z.string().max(80).optional(),
});
export type CambioPrecios = z.infer<typeof CambioPrecios>;
export { FILTRO_IDS };

export type FilaHistorial = { id: string; numero: number; descripcion: string; productos: number; fecha: string; responsable: string | null;
  revertido: string | null; revertidos: number | null; revertido_por: string | null };

export async function historialPrecios(c: Tx, empresa: string): Promise<FilaHistorial[]> {
  return (await c.query(`select k.id, k.numero, k.descripcion, k.productos, to_char(k.creado at time zone 'America/Bogota', 'DD/MM/YYYY HH24:MI') fecha,
      split_part(m.nombre, ' (', 1) responsable, to_char(k.revertido at time zone 'America/Bogota', 'DD/MM/YYYY HH24:MI') revertido, k.revertidos,
      split_part(r.nombre, ' (', 1) revertido_por
    from cambios_precio k left join miembros m on m.empresa_id = k.empresa_id and m.user_id = k.usuario_id
    left join miembros r on r.empresa_id = k.empresa_id and r.user_id = k.revertido_por
    where k.empresa_id = $1 order by k.creado desc limit 100`, [empresa])).rows;
}

export type LineaCambio = { producto_id: string; nombre: string; laboratorio: string | null; iva: number; upc: number; caja_antes: number; unidad_antes: number | null;
  caja_despues: number; unidad_despues: number | null; caja_hoy: number; unidad_hoy: number | null; costo: number | null; heredado: boolean; revertida: boolean };

export async function detallePrecios(c: Tx, empresa: string, id: string) {
  const k = (await c.query(`select k.id, k.numero, k.descripcion, k.productos, k.regla, k.redondeo, to_char(k.creado at time zone 'America/Bogota', 'DD/MM/YYYY HH24:MI') fecha,
      split_part(m.nombre, ' (', 1) responsable, to_char(k.revertido at time zone 'America/Bogota', 'DD/MM/YYYY HH24:MI') revertido, k.revertidos
    from cambios_precio k left join miembros m on m.empresa_id = k.empresa_id and m.user_id = k.usuario_id
    where k.id = $1 and k.empresa_id = $2`, [id, empresa])).rows[0];
  if (!k) return null;
  const lineas: LineaCambio[] = (await c.query(`select l.producto_id, p.nombre, p.laboratorio, p.iva::float, p.unidades_por_caja upc, l.caja_antes::float, l.unidad_antes::float,
      l.caja_despues::float, l.unidad_despues::float, p.precio_caja::float caja_hoy, p.precio_unidad::float unidad_hoy, l.costo_unidad::float costo, l.costo_heredado heredado, l.revertida
    from cambio_precio_lineas l join productos p on p.id = l.producto_id where l.cambio_id = $1 order by p.nombre limit 3000`, [id])).rows;
  return { ...k, lineas };
}
