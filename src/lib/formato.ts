// Formatos compartidos entre servidor y navegador.
export const pesos = (n: number) => { const v = Math.round(Number(n)); return (v < 0 ? "−$" : "$") + Math.abs(v).toLocaleString("es-CO"); }; // negativos: «−$6.000», no «$-6.000»
export const MEDIO: Record<string, string> = { efectivo: "Efectivo", nequi: "Nequi", daviplata: "Daviplata", bre_b: "Bre-B", transferencia: "Transferencia", tarjeta: "Tarjeta", qr: "QR" };
export const existenciasTexto = (unidades: number, upc: number) => {
  if (unidades <= 0) return "Agotado";
  if (upc <= 1) return `${unidades} und`;
  const c = Math.floor(unidades / upc), u = unidades % upc;
  return `${c} caja${c === 1 ? "" : "s"}${u ? ` + ${u} und` : ""}`;
};

/** Cómo se nombra la presentación vendida en tiquetes y documentos: «caja» solo si la caja trae varias unidades; una
 *  «caja» de 1 unidad es una unidad (igual que la muestra la caja). */
export const presentacionTexto = (presentacion: string, unidadesPorCaja?: number | null) =>
  presentacion === "caja" && Number(unidadesPorCaja ?? 2) > 1 ? "caja" : "und";
