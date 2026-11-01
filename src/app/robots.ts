import type { MetadataRoute } from "next";
import { SITIO } from "@/lib/sitio";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: "*", allow: "/", disallow: ["/api/", "/demo", "/inicio", "/caja", "/ventas", "/productos", "/inventario", "/prediccion", "/alertas"] }],
    sitemap: `${SITIO}/sitemap.xml`,
  };
}
