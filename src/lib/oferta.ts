// La oferta comercial en un solo lugar: garantía, precio de lanzamiento y lo que trae el plan (con su valor aparte).
// Cambiar aquí cambia la portada, la demo, Contratar y los términos.
import { PLANES } from "./planes";

export const GARANTIA_DIAS = 30;
export const GARANTIA = `Garantía de ${GARANTIA_DIAS} días: si en tu primer mes Regenta no le sirve a tu droguería, te devolvemos lo que pagaste.`;
export const PRECIO_CONGELADO = "Precio de lanzamiento congelado: lo conservas mientras mantengas tu plan.";
export const PRECIO_DESDE = PLANES[0].precio!;

/** Lo que recibes al contratar. `aparte` = lo que cuesta por separado cuando no viene incluido (null = no se vende aparte). */
export const PILA_VALOR: { que: string; detalle: string; aparte: string | null }[] = [
  { que: "Caja POS y factura electrónica", detalle: "Tiquete POS y factura de venta, de contado o a crédito, con tu resolución DIAN.", aparte: null },
  { que: "Certificado digital de firma", detalle: "El que firma cada documento ante la DIAN. Lo tramitamos nosotros.", aparte: "desde $104.000 al año" },
  { que: "Habilitación ante la DIAN", detalle: "Hacemos el set de pruebas y dejamos tu NIT listo para facturar.", aparte: null },
  { que: "Inventario por lote y vencimiento", detalle: "Sale primero lo que vence antes y la caja bloquea lo vencido.", aparte: null },
  { que: "IA predictiva y Regenta IA", detalle: "Qué pedir, qué se vence y un asistente que responde con tus datos.", aparte: null },
  { que: "Alertas del INVIMA cruzadas con tus lotes", detalle: "Solo te avisa cuando algo te toca, con constancia para la visita.", aparte: null },
  { que: "Capacitación a tu equipo", detalle: "Gente del sector enseñándole a tu cajera y a tu regente.", aparte: null },
];
