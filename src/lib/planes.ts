// Planes y precios publicados en la portada (COP al mes). Un solo lugar para cambiarlos.
export const PLANES = [
  { id: "esencial", nombre: "Esencial", precio: 89900, para: "Droguería de una caja", destacado: false,
    incluye: ["1 caja", "Hasta 3 usuarios", "2.000 documentos electrónicos al mes", "Pedido sugerido y riesgo de vencimiento", "Alertas INVIMA cruzadas con tu inventario", "Carga de productos desde Excel"] },
  { id: "pro", nombre: "Pro", precio: 139900, para: "Droguería con más movimiento", destacado: true,
    incluye: ["Hasta 3 cajas", "Usuarios ilimitados", "5.000 documentos electrónicos al mes", "Todo lo de Esencial", "Soporte prioritario por WhatsApp", "Te cargamos los productos"] },
  { id: "cadena", nombre: "Cadena", precio: null, para: "Varias sedes o distribuidor", destacado: false,
    incluye: ["Precio por sede", "Documentos según volumen", "Todo lo de Pro", "Acompañamiento en la puesta en marcha"] },
] as const;
export const DOC_EXTRA = 20; // COP por documento adicional
export const NOTA_PRECIOS = "Precios de lanzamiento, mensuales. Pagando el año completo, 2 meses gratis. La emisión electrónica ante la DIAN se activa en tu cuenta al terminar la integración con el proveedor tecnológico autorizado.";

// Plan Socio Farmagenéricos: Regenta como beneficio para las droguerías que compran a Farmagenéricos Colombia.
export const SOCIO = {
  nombre: "Plan Socio Farmagenéricos",
  resumen: "Si tu droguería le compra a Farmagenéricos Colombia, Regenta te sale con descuento o gratis.",
  escalones: [
    { desde: 1_000_000, beneficio: "50 % de descuento en Regenta Esencial" },
    { desde: 2_000_000, beneficio: "Regenta Esencial gratis" },
    { desde: 4_000_000, beneficio: "Regenta Pro gratis" },
  ],
  nota: "Compras del mes anterior a Farmagenéricos Colombia, antes de IVA. El beneficio se aplica en la factura de Regenta del mes siguiente.",
} as const;
