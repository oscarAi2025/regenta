import { NextResponse, type NextRequest } from "next/server";

/** Antes de cada pantalla:
 *  1) Un parámetro repetido en la URL (?q=a&q=b) llega a las pantallas como lista y las rompe: se deja el primero de cada
 *     uno (rewrite: la dirección del navegador no cambia).
 *  2) La ruta viaja en la cabecera x-ruta: el layout de la consola decide el acceso antes del límite de carga (loading),
 *     así las redirecciones siguen siendo 307 del servidor. */
export function middleware(req: NextRequest) {
  const cabeceras = new Headers(req.headers);
  cabeceras.set("x-ruta", req.nextUrl.pathname);
  const sp = req.nextUrl.searchParams;
  const claves = [...sp.keys()];
  if (new Set(claves).size === claves.length) return NextResponse.next({ request: { headers: cabeceras } });
  const url = req.nextUrl.clone();
  const limpio = new URLSearchParams();
  for (const [k, v] of sp) if (!limpio.has(k)) limpio.set(k, v);
  url.search = limpio.toString();
  return NextResponse.rewrite(url, { request: { headers: cabeceras } });
}

// Solo pantallas: ni la API (valida sus parámetros con zod) ni archivos estáticos, ni las páginas públicas estáticas
// (portada, precios, funciones, guías, perfiles, legales): no leen parámetros ni la cabecera x-ruta, y sin middleware el CDN
// las sirve sin pasar por una función que arranca en frío (primera visita de 3 a 5 s, 21/11/2026).
export const config = { matcher: ["/((?!$|api/|_next/|(?:funciones|guias|para|por-que-regenta|precios|privacidad|software|terminos)(?:/|$)|.*\\.[a-z0-9]+$).*)"] };
