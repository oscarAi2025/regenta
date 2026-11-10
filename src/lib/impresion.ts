// Impresión de la tirilla desde el navegador de la caja (impresora térmica instalada en el computador).
// La preferencia es de cada equipo (cada caja tiene su impresora): se guarda en este navegador.
/** factura: cómo sale la factura electrónica al cobrar (carta para empresas y droguerías, o la tirilla de la térmica).
 *  El tiquete POS siempre sale en la tirilla. */
export type Impresora = { auto: boolean; ancho: "80" | "58"; factura: "carta" | "tirilla" };
const CLAVE = "regenta.impresora";
const POR_DEFECTO: Impresora = { auto: true, ancho: "80", factura: "carta" };

/** La preferencia de este equipo. Si la caja nunca eligió el formato de la factura, manda el de la droguería. */
export function leerImpresora(facturaDroguería: Impresora["factura"] = POR_DEFECTO.factura): Impresora {
  try { return { ...POR_DEFECTO, factura: facturaDroguería, ...JSON.parse(localStorage.getItem(CLAVE) ?? "{}") }; } catch { return { ...POR_DEFECTO, factura: facturaDroguería }; }
}
export function guardarImpresora(i: Impresora) {
  try { localStorage.setItem(CLAVE, JSON.stringify(i)); } catch { /* navegador sin almacenamiento: queda la de por defecto */ }
}

/** Manda a la impresora una página de /tiquete sin salir de la pantalla (iframe oculto que se imprime solo). */
export function imprimirRuta(ruta: string, ancho = leerImpresora().ancho) {
  const f = document.createElement("iframe");
  f.title = "Tiquete";
  f.setAttribute("aria-hidden", "true");
  Object.assign(f.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" });
  f.src = `${ruta}${ruta.includes("?") ? "&" : "?"}ancho=${ancho}&auto=1`;
  document.body.appendChild(f);
  setTimeout(() => f.remove(), 120000);
}

/** Tirilla de una venta. */
export const imprimirTiquete = (ventaId: string, ancho = leerImpresora().ancho) => imprimirRuta(`/tiquete/${ventaId}`, ancho);

/** Factura en tamaño carta (con logo, datos completos del cliente, lote y vencimiento). */
export const imprimirFactura = (ventaId: string) => imprimirRuta(`/tiquete/factura/${ventaId}`);

/** Lo que sale al cobrar o con F8: la factura según la preferencia de esta caja; el tiquete POS, en la tirilla. */
export const imprimirVenta = (ventaId: string, tipo: string | null | undefined, i: Impresora = leerImpresora()) =>
  tipo === "factura" && i.factura === "carta" ? imprimirFactura(ventaId) : imprimirTiquete(ventaId, i.ancho);
