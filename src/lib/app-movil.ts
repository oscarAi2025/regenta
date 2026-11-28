// App de Android de Regenta (Trusted Web Activity en Google Play), 28/11/2026. La app abre /app?plataforma=android,
// que marca la cookie y lleva a la consola. En la app no se venden planes ni renovaciones: Google Play exige su propio
// sistema de cobro (Play Billing) para bienes digitales, así que las compras quedan fuera de la app (ocultas y
// bloqueadas en el servidor). El cliente contrata y renueva en regenta.pro desde el navegador.
export const COOKIE_APP = "regenta_app";
export const PLATAFORMAS_APP = ["android"] as const;
export type PlataformaApp = (typeof PLATAFORMAS_APP)[number];
export const esPlataformaApp = (v: unknown): v is PlataformaApp => typeof v === "string" && (PLATAFORMAS_APP as readonly string[]).includes(v);

/** ¿La petición viene de la app? (cabecera Cookie de una petición). */
export function esPeticionApp(req: Request) {
  return new RegExp(`(?:^|;\\s*)${COOKIE_APP}=(android)(?:;|$)`).test(req.headers.get("cookie") ?? "");
}

/** Respuesta de las rutas de pago cuando la petición viene de la app. */
export const respuestaSinCompras = () =>
  Response.json({ error: "Los pagos de Regenta se hacen en regenta.pro desde el navegador, no desde la app." }, { status: 403 });

/** Web de venta (con precios y botones de compra): en la app lleva a la consola. */
export const RUTAS_VENTA = ["/precios", "/contratar", "/funciones", "/guias", "/para", "/por-que-regenta", "/software"];

/** Se ejecuta antes de pintar: marca <html data-app> (el CSS oculta las compras) y saca de la web de venta. */
export const scriptApp = `try{var m=document.cookie.match(/(?:^|;\\s*)${COOKIE_APP}=(android)(?:;|$)/);if(m){var d=document.documentElement;d.dataset.app=m[1];var p=location.pathname,v=p==="/"||${JSON.stringify(RUTAS_VENTA)}.some(function(r){return p===r||p.indexOf(r+"/")===0});if(v)location.replace("/inicio")}}catch(e){}`;

/** Registra el service worker (web instalable y página sin conexión). */
export const scriptSw = `try{if("serviceWorker"in navigator)addEventListener("load",function(){navigator.serviceWorker.register("/sw.js").catch(function(){})})}catch(e){}`;
