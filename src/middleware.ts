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

// Solo pantallas: ni la API (valida sus parámetros con zod) ni archivos estáticos.
export const config = { matcher: ["/((?!api/|_next/|.*\\.[a-z0-9]+$).*)"] };
