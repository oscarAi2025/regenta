/** Cabeceras de seguridad en todas las respuestas. La tirilla (/tiquete) se deja enmarcar solo por el propio sitio:
 *  la caja la imprime desde un iframe oculto sin salir de la venta. La factura del proveedor de una compra, igual. */
const csp = (marco) => ["default-src 'self'", `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "development" ? " 'unsafe-eval'" : ""}`, "style-src 'self' 'unsafe-inline'", "img-src 'self' data: blob:", "font-src 'self' data:", "connect-src 'self'", `frame-ancestors ${marco}`, "base-uri 'self'", "form-action 'self'", "object-src 'none'"].join("; ");
const comunes = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "same-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
];
export default {
  poweredByHeader: false,
  reactStrictMode: true,
  async redirects() {
    return [
      { source: "/para/droguerias", destination: "/", permanent: true },
      { source: "/para/distribuidoras", destination: "/software/distribuidoras-medicamentos", permanent: true },
    ];
  },
  async headers() {
    return [
      { source: "/((?!tiquete/|api/compras/[^/]+/factura$).*)", headers: [{ key: "Content-Security-Policy", value: csp("'none'") }, { key: "X-Frame-Options", value: "DENY" }, ...comunes] },
      { source: "/tiquete/:path*", headers: [{ key: "Content-Security-Policy", value: csp("'self'") }, { key: "X-Frame-Options", value: "SAMEORIGIN" }, ...comunes] },
      // La factura del proveedor (PDF o foto, verificada por su contenido) se muestra dentro de la compra: se deja enmarcar
      // solo por el propio sitio y sin object-src 'none', que en Chrome impide abrir el PDF.
      { source: "/api/compras/:id/factura", headers: [{ key: "Content-Security-Policy", value: "frame-ancestors 'self'" }, { key: "X-Frame-Options", value: "SAMEORIGIN" }, ...comunes] },
    ];
  },
};
