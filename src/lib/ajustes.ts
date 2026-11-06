// Motivos de ajuste y baja de inventario (compartido entre servidor y navegador). La base de datos valida la misma lista.
export const MOTIVOS = [
  { id: "vencido", nombre: "Vencido", baja: true, acta: true },
  { id: "averia", nombre: "Avería o rotura", baja: true, acta: true },
  { id: "perdida", nombre: "Pérdida o robo", baja: true, acta: false },
  { id: "conteo", nombre: "Diferencia de conteo", baja: false, acta: false },
  { id: "devolucion_proveedor", nombre: "Devolución a proveedor", baja: true, acta: false },
  { id: "otro", nombre: "Otro", baja: true, acta: false },
] as const;
export type Motivo = (typeof MOTIVOS)[number]["id"];
export const MOTIVO_IDS = MOTIVOS.map((m) => m.id) as [Motivo, ...Motivo[]];
export const nombreMotivo = (m: string) => MOTIVOS.find((x) => x.id === m)?.nombre ?? m;
/** Las bajas por vencido o por avería generan acta de baja (para entregar al gestor de residuos). */
export const llevaActa = (m: string) => m === "vencido" || m === "averia";

/** Unidades en cajas + sueltas, como en el resto de Regenta («3 cajas + 2 und»). Admite negativos. */
export function unidadesTexto(u: number, upc: number) {
  const signo = u < 0 ? "−" : "", a = Math.abs(u);
  if (upc <= 1 || a < upc) return `${signo}${a.toLocaleString("es-CO")} und`;
  const c = Math.floor(a / upc), r = a % upc;
  return `${signo}${c.toLocaleString("es-CO")} caja${c === 1 ? "" : "s"}${r ? ` + ${r} und` : ""}`;
}

/** Pesos con signo tipográfico («−$12.300»). */
export const pesosConSigno = (v: number) => (Math.round(v) < 0 ? "−" : "") + "$" + Math.abs(Math.round(v)).toLocaleString("es-CO");
