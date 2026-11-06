// La venta en curso se guarda en este navegador (sessionStorage, por droguería y caja) para que una recarga o un cierre
// accidental de la pestaña no la pierda. Se borra al cobrar o al empezar una venta nueva. Incluye la clave de
// idempotencia: si la recarga ocurrió mientras se registraba, volver a cobrar no duplica la venta.
import type { DatosFormula } from "@/lib/control-especial";
import type { Cliente } from "./ClienteFactura";
import type { Linea, PedidoVinculado } from "./tipos";

export type VentaLocal = {
  v: 1; idem: string; lineas: Linea[]; tipoDoc: "pos" | "factura"; cliente: Cliente | null; credito: boolean; plazo: number;
  descGeneral: number; formula: DatosFormula; pedido: PedidoVinculado | null; guardada: number;
};

const clave = (empresa: string, caja: string | null) => `regenta.venta.${empresa}.${caja ?? "sin-caja"}`;
const DOCE_HORAS = 12 * 3600 * 1000;

export function leerVentaLocal(empresa: string, caja: string | null): VentaLocal | null {
  try {
    const t = sessionStorage.getItem(clave(empresa, caja));
    if (!t) return null;
    const v = JSON.parse(t) as VentaLocal;
    if (v?.v !== 1 || !Array.isArray(v.lineas) || (!v.lineas.length && !v.pedido) || Date.now() - v.guardada > DOCE_HORAS) { borrarVentaLocal(empresa, caja); return null; }
    return v;
  } catch { return null; }
}
export function guardarVentaLocal(empresa: string, caja: string | null, v: Omit<VentaLocal, "v" | "guardada">) {
  try {
    if (!v.lineas.length && !v.pedido) sessionStorage.removeItem(clave(empresa, caja));
    else sessionStorage.setItem(clave(empresa, caja), JSON.stringify({ ...v, v: 1, guardada: Date.now() }));
  } catch { /* navegador sin almacenamiento: la venta sigue en pantalla */ }
}
export function borrarVentaLocal(empresa: string, caja: string | null) {
  try { sessionStorage.removeItem(clave(empresa, caja)); } catch { /* sin almacenamiento */ }
}
