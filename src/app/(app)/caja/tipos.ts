import type { VentaEnCola } from "@/lib/sin-conexion";
import type { TipoPedido, EstadoPedido } from "@/lib/pedidos";

export type Producto = {
  id: string; nombre: string; laboratorio: string | null; ean: string | null; iva: number; unidades_por_caja: number;
  precio_caja: number; precio_unidad: number | null; stock_minimo: number; unidades: number; proximo_vence: string | null; exacto: boolean;
  requiere_formula?: boolean; control_especial?: boolean;
};
/** Línea de la venta. `antes`: precio que se le dijo al cliente en el pedido, si cambió desde entonces. */
export type Linea = { key: string; p: Producto; presentacion: "caja" | "unidad"; cantidad: number; descuento: number /* % */; antes?: number };
export type Medio = "efectivo" | "transferencia" | "nequi" | "daviplata" | "tarjeta" | "bre_b" | "qr";
export type Resultado = { provisional?: VentaEnCola; /** Tipo de documento de la venta (por si la respuesta no trae el documento DIAN). */ tipo?: "pos" | "factura"; venta: { venta_id: string; prefijo: string; numero: number; total: number; cambio: number; base: number; iva: number; credito?: boolean; vence_pago?: string | null; repetida?: boolean }; documento: { tipo: "pos" | "factura"; estado: string; cufe: string | null; simulado: boolean; ultimo_error: string | null } };
/** Pedido del servidor (espera, domicilio, cotización) que está abierto en la caja. */
export type PedidoVinculado = { id: string; tipo: TipoPedido; numero: number; contacto: string | null; estado: EstadoPedido; telefono?: string | null; direccion?: string | null; nota?: string | null };

export const precioDe = (l: Pick<Linea, "p" | "presentacion">) => (l.presentacion === "caja" ? l.p.precio_caja : l.p.precio_unidad ?? 0);
/** Unidades base de una línea (cajas × unidades por caja). */
export const unidadesDe = (l: Pick<Linea, "p" | "presentacion" | "cantidad">) => l.cantidad * (l.presentacion === "caja" ? l.p.unidades_por_caja : 1);
