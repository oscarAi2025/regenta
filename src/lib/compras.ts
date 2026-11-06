// Compras, proveedores y cuentas por pagar: permisos, textos y cálculo (compartido entre servidor y navegador).
// La base de datos vuelve a validar y calcular todo; aquí se calcula igual para mostrar el cuadre antes de guardar.
import type { Rol } from "./sesion";

/** Permisos del frente de compras (la base de datos los vuelve a comprobar). */
export const puedeCompras = {
  /** Registrar la recepción de mercancía y ver la lista de compras (la bodega, sin dinero). */
  ver: (r: Rol) => r === "dueno" || r === "admin" || r === "bodeguero",
  /** Costos, totales, pagos, devoluciones, anular y cuentas por pagar. */
  dinero: (r: Rol) => r === "dueno" || r === "admin",
};

export const MEDIOS_PAGO = [
  ["transferencia", "Transferencia"], ["efectivo", "Efectivo"], ["consignacion", "Consignación"], ["cheque", "Cheque"],
  ["nequi", "Nequi"], ["daviplata", "Daviplata"], ["bre_b", "Bre-B"], ["tarjeta", "Tarjeta"],
] as const;
export type MedioPago = (typeof MEDIOS_PAGO)[number][0];
export const MEDIO_IDS = MEDIOS_PAGO.map(([k]) => k) as [MedioPago, ...MedioPago[]];
export const nombreMedio = (m: string) => MEDIOS_PAGO.find(([k]) => k === m)?.[1] ?? m;

export const ESTADOS: Record<string, string> = { por_costear: "Por costear", registrada: "Registrada", anulada: "Anulada" };

/** Número con coma decimal como lo escribe un droguista («12.345,67» o «12345,67» o «12345.67») → número o null. */
export function leerNumero(s: string): number | null {
  let t = String(s ?? "").trim().replace(/\s|\$/g, "");
  if (!t) return null;
  if (t.includes(",")) t = t.replace(/\./g, "").replace(",", ".");
  else if (/^\d{1,3}(\.\d{3})+$/.test(t)) t = t.replace(/\./g, ""); // 12.345 = doce mil
  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  return Number(t);
}

/** Pesos con centavos solo si los hay: $12.345 · $12.345,67 (formato hecho a mano: igual en servidor y navegador). */
export function pesosExactos(v: number) {
  const n = Math.round(Number(v) * 100), neg = n < 0, a = Math.abs(n);
  const ent = Math.floor(a / 100).toString().replace(/\B(?=(\d{3})+(?!\d))/g, "."), cen = a % 100;
  return `${neg ? "−" : ""}$${ent}${cen ? "," + String(cen).padStart(2, "0") : ""}`;
}
/** Entero con puntos de miles, hecho a mano (igual en servidor y navegador: sin diferencias de ICU al hidratar). */
export const miles = (v: number) => (v < 0 ? "−" : "") + Math.abs(Math.round(v)).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
/** Número con coma decimal (sin símbolo), para devolverlo a un campo. */
export const numeroTexto = (v: number) => pesosExactos(v).replace("$", "");

/** División entera redondeada «mitad hacia arriba» (como round() de Postgres para positivos). */
const div = (a: bigint, b: bigint) => (a * 2n + b) / (b * 2n);

/** Cálculo exacto de una línea (en centavos, con enteros): igual que compra_calcular_linea en la base de datos.
 *  costo = sin IVA por caja o por unidad; factor = unidades por caja si el costo es por caja (si no, 1). */
export function calcularLinea(costo: number, factor: number, unidades: number, descuentoPct: number, ivaPct: number) {
  const c = BigInt(Math.round(costo * 100)), u = BigInt(unidades), f = BigInt(factor), d = BigInt(Math.round(descuentoPct * 100)), i = BigInt(Math.round(ivaPct));
  const bruto = div(c * u, f), base = div(c * u * (10000n - d), f * 10000n), iva = div(base * i, 100n);
  return { bruto: Number(bruto) / 100, base: Number(base) / 100, iva: Number(iva) / 100, total: Number(base + iva) / 100 };
}

/** Margen sobre el precio de venta sin IVA: (precio − costo) ÷ precio. */
export function margen(costoUnidad: number, precioCajaConIva: number, ivaVentaPct: number, upc: number) {
  const precio = precioCajaConIva / (1 + ivaVentaPct / 100) / Math.max(upc, 1);
  return precio > 0 ? Math.round(((precio - costoUnidad) / precio) * 1000) / 10 : null;
}
