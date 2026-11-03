// Planes y precios publicados en la portada (COP al mes). Un solo lugar para cambiarlos.
export const PLANES = [
  { id: "esencial", nombre: "Esencial", precio: 89900, para: "Droguería de una caja", destacado: false,
    incluye: ["Certificado digital y habilitación DIAN incluidos", "IA predictiva: qué pedir, qué se vence y tu día fuerte de la semana", "Regenta IA: tu asistente responde con tus datos", "Apoyo en ventas: qué ofrecer primero y alternativas a lo agotado", "Gestión completa: inventario por lote, cartera, roles y auditoría", "Formación: capacitación inicial a tu equipo", "1 caja y hasta 3 usuarios", "2.000 documentos al mes (POS y factura), unas 65 ventas al día"] },
  { id: "pro", nombre: "Pro", precio: 139900, para: "Droguería con más movimiento", destacado: true,
    incluye: ["Todo lo de Esencial", "Formación a todo tu equipo y acompañamiento el primer mes", "Hasta 3 cajas y usuarios ilimitados", "5.000 documentos al mes (POS y factura)", "Soporte prioritario por WhatsApp", "Te cargamos los productos"] },
  { id: "cadena", nombre: "Cadena", precio: null, para: "Distribuidoras y varias sedes", destacado: false,
    incluye: ["Todo lo de Pro", "Certificado digital y habilitación DIAN por cada NIT", "Plan de formación por sede", "Precio por sede y documentos según volumen", "Acompañamiento en la puesta en marcha"] },
] as const;
export const DOC_EXTRA = 20; // COP por documento adicional
export const NOTA_PRECIOS = "Precios de lanzamiento, mensuales. Pagando el año completo, 2 meses gratis. Certificado digital y habilitación ante la DIAN incluidos en todos los planes. La emisión electrónica ante la DIAN se activa en tu cuenta al terminar su integración.";
/** Lo que se paga al mes si se paga el año completo (10 meses repartidos en 12). */
export const mesAnual = (precio: number) => Math.round((precio * 10) / 12);

// Plan Socio Farmagenéricos: Regenta como beneficio para las droguerías que compran a Farmagenéricos Colombia.
// Precio final mensual de cada plan según las compras del mes anterior (antes de IVA). 0 = gratis.
export const SOCIO = {
  nombre: "Plan Socio Farmagenéricos",
  resumen: "Si tu droguería le compra a Farmagenéricos Colombia, Regenta te sale a mitad de precio o gratis.",
  escalones: [
    { desde: 1_000_000, esencial: 44_950, pro: 69_950, etiqueta: "50 % en cualquier plan" },
    { desde: 2_000_000, esencial: 0, pro: 69_950, etiqueta: "Esencial gratis" },
    { desde: 4_000_000, esencial: 0, pro: 0, etiqueta: "Esencial y Pro gratis" },
  ],
  nota: "Se toman las compras del mes anterior a Farmagenéricos Colombia, antes de IVA, y el precio se aplica en la factura de Regenta del mes siguiente. Si un mes compras menos, ese mes pagas según el escalón que alcances.",
} as const;

/** Precio mensual de un plan para una droguería según sus compras a Farmagenéricos (sin asociarse: compras = 0). */
export function precioSocio(plan: "esencial" | "pro", compras: number) {
  const base = PLANES.find((p) => p.id === plan)!.precio!;
  const e = [...SOCIO.escalones].reverse().find((x) => compras >= x.desde);
  return e ? e[plan] : base;
}

/** Lo que incluye cada plan en cajas y usuarios activos (null = sin tope). Es lo que se vende arriba: un solo lugar. */
export const LIMITES: Record<string, { cajas: number | null; usuarios: number | null }> = {
  esencial: { cajas: 1, usuarios: 3 },
  pro: { cajas: 3, usuarios: null },
  cadena: { cajas: null, usuarios: null },
  socio: { cajas: null, usuarios: null },
};
export const limite = (plan: string) => LIMITES[plan] ?? LIMITES.esencial;
