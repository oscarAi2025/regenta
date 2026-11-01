// Formatos compartidos entre servidor y navegador.
export const pesos = (n: number) => "$" + Math.round(Number(n)).toLocaleString("es-CO");
export const MEDIO: Record<string, string> = { efectivo: "Efectivo", nequi: "Nequi", daviplata: "Daviplata", bre_b: "Bre-B", transferencia: "Transferencia", tarjeta: "Tarjeta" };
export const existenciasTexto = (unidades: number, upc: number) => {
  if (unidades <= 0) return "Agotado";
  if (upc <= 1) return `${unidades} und`;
  const c = Math.floor(unidades / upc), u = unidades % upc;
  return `${c} caja${c === 1 ? "" : "s"}${u ? ` + ${u} und` : ""}`;
};
