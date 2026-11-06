// Pedidos del mostrador (ventas en espera, domicilios y cotizaciones): permisos, nombres y cálculos compartidos por la
// caja, la pantalla de pedidos y la API. Módulo puro: sin base de datos ni React.
import type { Rol } from "./sesion";

export const TIPOS = { espera: "En espera", domicilio: "Domicilio", cotizacion: "Cotización" } as const;
export type TipoPedido = keyof typeof TIPOS;
export const ESTADOS = { abierto: "Abierto", en_camino: "En camino", cobrado: "Cobrado", cancelado: "Cancelado", vencido: "Vencida" } as const;
export type EstadoPedido = keyof typeof ESTADOS;

/** Permisos de los pedidos. El vendedor arma pedidos y cotizaciones pero no cobra (ni entra a la caja) ni ve costos;
 *  la base de datos vuelve a comprobarlo en guardar_pedido y cobrar_pedido. */
export const puedePedidos = {
  /** Ver la lista, armar, editar, marcar en camino y cancelar. */
  armar: (r: Rol) => r === "dueno" || r === "admin" || r === "cajero" || r === "vendedor",
  /** Cobrar un pedido (convertirlo en venta): los mismos que venden en la caja. */
  cobrar: (r: Rol) => r === "dueno" || r === "admin" || r === "cajero",
};

/** Máximo que se acepta al escribir una cantidad en la caja (el lector o un dedo de más no deben vender 3000 cajas). */
export const MAX_CANTIDAD = 1000;

/** Valida una cantidad escrita: entero mayor que cero y hasta el máximo. */
export function leerCantidad(texto: string): { n: number } | { error: string } {
  const t = texto.trim();
  if (!t) return { error: "Escribe la cantidad" };
  if (!/^\d+$/.test(t)) return { error: "La cantidad es un número entero (sin decimales)" };
  const n = Number(t);
  if (n < 1) return { error: "La cantidad debe ser mayor que cero" };
  if (n > MAX_CANTIDAD) return { error: `Máximo ${MAX_CANTIDAD.toLocaleString("es-CO")} por producto` };
  return { n };
}

/** «12*» al empezar la búsqueda: la cantidad para el siguiente producto que se escanee o elija. Devuelve la cantidad (o
 *  el error) y el resto del texto, que sigue siendo la búsqueda (el lector puede escribir el código pegado: «12*7702…»). */
export function prefijoCantidad(q: string): { cantidad: number | null; error?: string; resto: string } | null {
  const m = /^\s*(\d{1,6})\s*\*\s*(.*)$/.exec(q);
  if (!m) return null;
  const c = leerCantidad(m[1]);
  return "n" in c ? { cantidad: c.n, resto: m[2] } : { cantidad: null, error: c.error, resto: m[2] };
}

/** Valor de una línea igual que la base de datos: el descuento general se suma encima del de la línea y, con descuento,
 *  se redondea a pesos enteros. */
export function netoLinea(precio: number, cantidad: number, descuento: number, general: number) {
  const bruto = precio * cantidad;
  const pct = 100 - (100 - descuento) * (100 - general) / 100;
  return { bruto, neto: pct > 0 ? Math.round(bruto * (100 - pct) / 100) : bruto };
}

export const etiquetaPedido = (p: { tipo: TipoPedido; numero: number }) => `${TIPOS[p.tipo]} N.º ${p.numero}`;

/** Fecha AAAA-MM-DD a «6 nov 2026» (hecha a mano: igual en servidor y navegador). */
const MESES = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sept", "oct", "nov", "dic"];
export const fechaCorta = (f: string | null | undefined) => {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(f ?? "");
  return m ? `${Number(m[3])} ${MESES[Number(m[2]) - 1]} ${m[1]}` : "";
};
const miles = (n: number) => String(Math.round(n)).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
export const pesosTexto = (n: number) => "$" + miles(n);

/** Texto de la cotización para WhatsApp. */
export function textoCotizacion(p: {
  empresa: string; numero: number; vence: string | null; contacto: string | null; descuento_pct: number;
  lineas: { nombre: string; presentacion: "caja" | "unidad"; cantidad: number; precio: number; descuento_pct: number; upc: number }[];
}) {
  let total = 0;
  const filas = p.lineas.map((l) => {
    const { neto } = netoLinea(l.precio, l.cantidad, l.descuento_pct, p.descuento_pct);
    total += neto;
    const pres = l.presentacion === "caja" ? (l.upc > 1 ? `caja x${l.upc}` : "und") : "unidad";
    return `• ${l.cantidad} ${pres} ${l.nombre}: ${pesosTexto(neto)}`;
  });
  return [
    `${p.empresa} · Cotización N.º ${p.numero}`,
    p.contacto ? `Para: ${p.contacto}` : null,
    "",
    ...filas,
    "",
    `Total: ${pesosTexto(total)} (IVA incluido cuando aplica)`,
    p.vence ? `Válida hasta el ${fechaCorta(p.vence)}. Precios sujetos a cambio y a existencias.` : "Precios sujetos a cambio y a existencias.",
  ].filter((x) => x !== null).join("\n");
}
