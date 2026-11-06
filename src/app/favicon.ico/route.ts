/** Algunos navegadores piden /favicon.ico aunque la página declare su icono: se les manda el icono real (sin 404). */
export function GET(req: Request) {
  return Response.redirect(new URL("/icon.svg", req.url), 308);
}
