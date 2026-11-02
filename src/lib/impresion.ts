// Impresión de la tirilla desde el navegador de la caja (impresora térmica instalada en el computador).
// La preferencia es de cada equipo (cada caja tiene su impresora): se guarda en este navegador.
export type Impresora = { auto: boolean; ancho: "80" | "58" };
const CLAVE = "regenta.impresora";
const POR_DEFECTO: Impresora = { auto: true, ancho: "80" };

export function leerImpresora(): Impresora {
  try { return { ...POR_DEFECTO, ...JSON.parse(localStorage.getItem(CLAVE) ?? "{}") }; } catch { return POR_DEFECTO; }
}
export function guardarImpresora(i: Impresora) {
  try { localStorage.setItem(CLAVE, JSON.stringify(i)); } catch { /* navegador sin almacenamiento: queda la de por defecto */ }
}

/** Manda la tirilla de una venta a la impresora sin salir de la caja (iframe oculto que se imprime solo). */
export function imprimirTiquete(ventaId: string, ancho = leerImpresora().ancho) {
  const f = document.createElement("iframe");
  f.title = "Tiquete";
  f.setAttribute("aria-hidden", "true");
  Object.assign(f.style, { position: "fixed", right: "0", bottom: "0", width: "0", height: "0", border: "0" });
  f.src = `/tiquete/${ventaId}?ancho=${ancho}&auto=1`;
  document.body.appendChild(f);
  setTimeout(() => f.remove(), 120000);
}
