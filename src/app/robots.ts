import type { MetadataRoute } from "next";
import { SITIO } from "@/lib/sitio";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", // La app y la consola no se rastrean. /entrar y /activar no se bloquean: llevan «noindex» y Google tiene que poder
    // leerlo para no listarlas.
    disallow: ["/api/", "/demo", "/inicio", "/caja", "/ventas", "/productos", "/inventario", "/prediccion", "/alertas", "/cartera", "/reportes", "/turno", "/equipo", "/tiquete", "/baja", "/contratar/resultado", "/admin", "/clientes", "/cuenta", "/recibo", "/control-especial"] }],
    sitemap: `${SITIO}/sitemap.xml`,
  };
}
