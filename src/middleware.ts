import { NextResponse, type NextRequest } from "next/server";

/** Un parámetro repetido en la URL (?q=a&q=b) llega a las pantallas como lista y las rompe. Aquí se deja el primero de
 *  cada uno (rewrite: la dirección del navegador no cambia). Si no hay repetidos, no hace nada. */
export function middleware(req: NextRequest) {
  const sp = req.nextUrl.searchParams;
  const claves = [...sp.keys()];
  if (new Set(claves).size === claves.length) return NextResponse.next();
  const url = req.nextUrl.clone();
  const limpio = new URLSearchParams();
  for (const [k, v] of sp) if (!limpio.has(k)) limpio.set(k, v);
  url.search = limpio.toString();
  return NextResponse.rewrite(url);
}

// Solo pantallas: ni la API (valida sus parámetros con zod) ni archivos estáticos.
export const config = { matcher: ["/((?!api/|_next/|.*\\.[a-z0-9]+$).*)"] };
