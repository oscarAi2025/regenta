// Nombres de los tipos de numeración DIAN (compartido entre la consola y sus componentes de cliente).
export const NOMBRE_NUMERACION = {
  pos: "POS electrónico", factura: "Factura electrónica", nota_credito: "Nota crédito", nota_debito: "Nota débito",
  soporte: "Documento soporte", ajuste_soporte: "Nota de ajuste del documento soporte",
} as const;
export type TipoNumeracion = keyof typeof NOMBRE_NUMERACION;
