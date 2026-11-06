// Gastos de la droguería y permisos del frente de resultados (compartido entre servidor y navegador).
// La base de datos vuelve a comprobar cada permiso (registrar_gasto, anular_gasto y la seguridad por fila).
import type { Rol } from "./sesion";

/** Resultados, auxiliar de IVA, cierre del día, gastos y bitácora: solo el dueño y el administrador. La cajera no registra
 *  gastos (decisión del frente 3-A): una salida de caja de la cajera sigue siendo un egreso del turno, con su tope. */
export const puedeResultados = (r: Rol) => r === "dueno" || r === "admin";

export const CATEGORIAS = [
  ["arriendo", "Arriendo"], ["servicios", "Servicios públicos"], ["nomina", "Nómina"], ["transporte", "Transporte"],
  ["impuestos", "Impuestos"], ["mantenimiento", "Mantenimiento"], ["otros", "Otros"],
] as const;
export type Categoria = (typeof CATEGORIAS)[number][0];
export const CATEGORIA_IDS = CATEGORIAS.map(([k]) => k) as [Categoria, ...Categoria[]];
export const nombreCategoria = (c: string) => CATEGORIAS.find(([k]) => k === c)?.[1] ?? c;
export const AYUDA_CATEGORIA: Record<string, string> = { nomina: "Valor total pagado (no liquida la nómina)" };

export type FilaGasto = {
  id: string; numero: number; fecha: string; categoria: string; descripcion: string; medio: string; valor: number; referencia: string | null;
  caja: string | null; anulado: boolean; motivo: string | null; usuario: string | null; anula: string | null; creado: string;
};
