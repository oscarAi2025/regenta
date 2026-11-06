// Precios masivos, códigos alternos, etiquetas y cuarentena: permisos y textos (compartido entre servidor y navegador).
// La base de datos vuelve a comprobar todo (036_precios_lotes.sql).
import type { Rol } from "./sesion";

export const puedePrecios = {
  /** Cambiar precios en bloque y revertir (también ver el historial, que trae costos). */
  cambiar: (r: Rol) => r === "dueno" || r === "admin",
  /** Poner en cuarentena, liberar y dar de baja desde la cuarentena. */
  cuarentena: (r: Rol) => r === "dueno" || r === "admin" || r === "bodeguero",
  /** Configurar a dónde van las devoluciones de clientes por defecto. */
  configurar: (r: Rol) => r === "dueno" || r === "admin",
  /** Imprimir etiquetas de góndola. */
  etiquetas: (r: Rol) => r === "dueno" || r === "admin" || r === "bodeguero",
  /** Agregar o quitar códigos alternos de un producto. */
  codigos: (r: Rol) => r === "dueno" || r === "admin" || r === "bodeguero",
};

export const FILTROS = [
  ["laboratorio", "Un laboratorio"], ["categoria", "Una categoría"], ["proveedor", "Un proveedor"], ["iva", "Una tarifa de IVA"], ["productos", "Productos que elijo"],
] as const;
export type TipoFiltro = (typeof FILTROS)[number][0];
export const FILTRO_IDS = FILTROS.map(([k]) => k) as [TipoFiltro, ...TipoFiltro[]];

export const BLOQUEOS: Record<string, string> = { invima: "Alerta del INVIMA", cuarentena: "Cuarentena", devolucion: "Devolución de cliente" };

/** Código alterno como se guarda en la base: sin espacios y en mayúsculas. */
export const normalizarCodigo = (s: string) => String(s ?? "").replace(/\s/g, "").toUpperCase();
export const CODIGO_VALIDO = /^[0-9A-Z.-]{3,40}$/;

/** Porcentaje con coma decimal («5», «2,5»), con signo si se pide. */
export function pct(v: number | null | undefined, signo = false) {
  if (v === null || v === undefined || !isFinite(Number(v))) return "—";
  const n = Math.round(Number(v) * 10) / 10, t = String(Math.abs(n)).replace(".", ",");
  return `${n < 0 ? "−" : signo && n > 0 ? "+" : ""}${t} %`;
}

/** Pesos sin centavos con puntos de miles, hecho a mano (igual en servidor y navegador: sin diferencias al hidratar). */
export const pesosMano = (v: number) => (v < 0 ? "−" : "") + "$" + Math.abs(Math.round(Number(v))).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ".");
