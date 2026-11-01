import type { MetadataRoute } from "next";
import { SITIO } from "@/lib/sitio";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/demo", "/inicio", "/caja", "/ventas", "/productos", "/inventario", "/prediccion", "/alertas", "/cartera", "/entrar", "/contratar/resultado"] }],
    sitemap: `${SITIO}/sitemap.xml`,
  };
}
