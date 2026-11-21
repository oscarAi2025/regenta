// «Te falta X → pídelo a Farmagenéricos»: el texto del pedido que la droguería le manda a Farmagenéricos Colombia por
// WhatsApp desde el pedido sugerido. Puro (sin base de datos) para poder probarlo.

/** WhatsApp de pedidos de Farmagenéricos Colombia. */
export const WHATSAPP_FARMAGENERICOS = "573212141970";

export type LineaPedidoFG = { nombre: string; laboratorio: string | null; cajas: number };

/** Pedido escrito para WhatsApp: quién pide (para que Farmagenéricos identifique la droguería) y una línea por producto. */
export function textoPedidoFarmagenericos(d: { drogueria: string; nit: string; ciudad: string | null; lineas: LineaPedidoFG[] }) {
  const cajas = d.lineas.reduce((a, l) => a + l.cajas, 0);
  return [
    `Hola, Farmagenéricos. Pedido desde Regenta de ${d.drogueria} (NIT ${d.nit}${d.ciudad ? `, ${d.ciudad}` : ""}):`,
    "",
    ...d.lineas.map((l) => `• ${l.cajas} × ${l.nombre}${l.laboratorio ? ` (${l.laboratorio})` : ""}`),
    "",
    `${d.lineas.length} ${d.lineas.length === 1 ? "producto" : "productos"} · ${cajas} ${cajas === 1 ? "caja" : "cajas"}. ¿Me confirman disponibilidad y precio?`,
  ].join("\n");
}

export const enlaceWhatsAppFarmagenericos = (texto: string) => `https://wa.me/${WHATSAPP_FARMAGENERICOS}?text=${encodeURIComponent(texto)}`;
